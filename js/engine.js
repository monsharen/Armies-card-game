/* Armies — pure game engine for the single-player campaign.
 * No DOM access, so it can be unit-tested in Node and driven by any UI. */

const ROW_CAP = 5;
const MAX_TURNS = 15;
// Invasions strike at the END of these turns. Their strength is rolled at
// campaign start within [min, max] and revealed to the player immediately.
const INVASIONS = [
  { turn: 5,  glory: 5,  min: 3,  max: 5  },
  { turn: 10, glory: 7,  min: 9,  max: 13 },
  { turn: 15, glory: 10, min: 16, max: 22 },
];

const RANKS = [
  { min: 55, title: 'Legendary Conqueror', icon: '👑' },
  { min: 45, title: 'Warlord',             icon: '⚔️' },
  { min: 35, title: 'Battle Captain',      icon: '🛡️' },
  { min: 25, title: 'Sergeant',            icon: '🗡️' },
  { min: 15, title: 'Footsoldier',         icon: '🥾' },
  { min: 0,  title: 'Camp Follower',       icon: '🍲' },
];

// In Node (tests/simulations) pull the card data into globals; in the browser
// cards.js has already declared them, so nothing to do.
if (typeof require !== 'undefined' && typeof CARD_TYPES === 'undefined') {
  Object.assign(globalThis, require('./cards.js'));
}

function randInt(min, max) {
  return min + Math.floor(Math.random() * (max - min + 1));
}

function createGame() {
  const state = {
    turn: 1,
    over: false,
    resources: { food: 2, ore: 1, gold: 0 },
    rows: { farm: [], mine: [], command: [] },
    stock: {},
    glory: 0,
    invasions: INVASIONS.map(inv => ({
      turn: inv.turn,
      glory: inv.glory,
      power: randInt(inv.min, inv.max),
      resolved: false,
      won: null,
    })),
    log: [],
  };
  for (const t of CARD_TYPES) state.stock[t.id] = t.stock;
  addLog(state, 'system', 'The campaign begins. You have ' + MAX_TURNS +
    ' turns; enemy armies will strike after turns ' +
    INVASIONS.map(i => i.turn).join(', ') + '.');
  const first = state.invasions[0];
  addLog(state, 'system', 'Scouts report the first enemy force: ' + first.power +
    ' strength, arriving after turn ' + first.turn + '.');
  return state;
}

function addLog(state, kind, msg) {
  state.log.push({ kind, msg, turn: state.turn });
}

function canAfford(resources, cost) {
  return ['food', 'ore', 'gold'].every(r => (resources[r] || 0) >= (cost[r] || 0));
}

function payCost(resources, cost) {
  for (const r of ['food', 'ore', 'gold']) resources[r] -= cost[r] || 0;
}

function totalPower(state) {
  return ROWS.reduce((sum, row) =>
    sum + state.rows[row].reduce((s, c) => s + c.power, 0), 0);
}

function resourceCount(state) {
  const r = state.resources;
  return r.food + r.ore + r.gold;
}

function nextInvasion(state) {
  return state.invasions.find(inv => !inv.resolved) || null;
}

function finalScore(state) {
  return {
    power: totalPower(state),
    glory: state.glory,
    supplies: Math.floor(resourceCount(state) / 3),
    get total() { return this.power + this.glory + this.supplies; },
  };
}

function rankFor(total) {
  return RANKS.find(r => total >= r.min);
}

/* ── Actions (each is one full turn; caller then calls endTurn) ───────── */

function build(state, typeId) {
  const type = cardById(typeId);
  if (!type) return { ok: false, msg: 'Unknown unit.' };
  if (!state.stock[typeId]) return { ok: false, msg: 'No ' + type.name + ' left in your supply.' };
  if (state.rows[type.row].length >= ROW_CAP)
    return { ok: false, msg: 'Your ' + ROW_INFO[type.row].label + ' row is full (' + ROW_CAP + ').' };
  if (!canAfford(state.resources, type.cost))
    return { ok: false, msg: 'Not enough resources for ' + type.name + '.' };
  payCost(state.resources, type.cost);
  state.stock[typeId]--;
  state.rows[type.row].push(Object.assign({}, type));
  addLog(state, 'player', 'You build ' + type.icon + ' ' + type.name + ' in the ' +
    ROW_INFO[type.row].label + (type.power ? ' (+' + type.power + ' power)' : '') + '.');
  return { ok: true };
}

function rowGains(state, row) {
  const gains = { food: 0, ore: 0, gold: 0 };
  for (const r in ROW_INFO[row].base) gains[r] += ROW_INFO[row].base[r];
  for (const card of state.rows[row]) {
    const e = card.effect || {};
    for (const r of ['food', 'ore', 'gold']) gains[r] += e[r] || 0;
  }
  return gains;
}

function activateRow(state, row) {
  const info = ROW_INFO[row];
  const gains = rowGains(state, row);
  state.resources.food += gains.food;
  state.resources.ore += gains.ore;
  state.resources.gold += gains.gold;
  const parts = [];
  for (const r of ['food', 'ore', 'gold']) {
    if (gains[r]) parts.push('+' + gains[r] + ' ' + RES_ICONS[r]);
  }
  addLog(state, 'player', 'You take ' + info.action + ': ' + parts.join(', ') + '.');
  return { ok: true, gains };
}

/* ── Turn flow ────────────────────────────────────────────────────────── */

function endTurn(state) {
  if (state.over) return;
  const invasion = state.invasions.find(inv => inv.turn === state.turn && !inv.resolved);
  if (invasion) resolveInvasion(state, invasion);
  if (state.turn >= MAX_TURNS) {
    state.over = true;
    const score = finalScore(state);
    const rank = rankFor(score.total);
    addLog(state, 'system', 'The campaign is over. Final score: ' + score.total +
      ' — you are remembered as a ' + rank.title + ' ' + rank.icon);
    return;
  }
  state.turn++;
  const next = nextInvasion(state);
  if (next && next.turn === state.turn) {
    addLog(state, 'system', '⚠️ The enemy army (' + next.power + ' strength) attacks at the end of THIS turn!');
  }
}

function resolveInvasion(state, invasion) {
  const power = totalPower(state);
  invasion.resolved = true;
  if (power >= invasion.power) {
    invasion.won = true;
    state.glory += invasion.glory;
    addLog(state, 'war', '⚔️ INVASION REPELLED! Your army (' + power +
      ') crushes the enemy force (' + invasion.power + ') and claims ' + invasion.glory + ' glory!');
  } else {
    invasion.won = false;
    const stolen = {};
    for (const r of ['food', 'ore', 'gold']) {
      stolen[r] = Math.ceil(state.resources[r] / 2);
      state.resources[r] -= stolen[r];
    }
    const parts = [];
    for (const r of ['food', 'ore', 'gold']) {
      if (stolen[r]) parts.push(stolen[r] + ' ' + RES_ICONS[r]);
    }
    addLog(state, 'war', '🔥 DEFEAT! The enemy (' + invasion.power + ') overwhelms your army (' +
      power + '). Raiders pillage half your stores' + (parts.length ? ': ' + parts.join(', ') : '') + '.');
  }
  const next = nextInvasion(state);
  if (next) {
    addLog(state, 'system', 'Scouts report the next enemy force: ' + next.power +
      ' strength, arriving after turn ' + next.turn + '.');
  }
}

if (typeof module !== 'undefined') {
  module.exports = {
    ROW_CAP, MAX_TURNS, INVASIONS, RANKS,
    createGame, canAfford, totalPower, resourceCount, finalScore, rankFor,
    nextInvasion, build, rowGains, activateRow, endTurn,
  };
}
