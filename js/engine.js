/* Four Banners — pure game engine. No DOM access, so it can be unit-tested in
 * Node and driven by either the UI or headless simulations.
 *
 * Board: a central Citadel with four roads of ROAD_LEN spaces, one per suit.
 * road[0] is nearest the camp, road[ROAD_LEN-1] is the gate before the Citadel.
 * One card per road space; camps hold any number of units.
 */

const ROAD_LEN = 3;
const HAND_LIMIT = 7;
const ACTIONS_PER_TURN = 2;
const NPC_FLIPS = 2;
const SEASONS = 2;
const GLORY = { battle: 1, capture: 5, season: 3 };

// Which suits are human-controlled for a given player count. Chosen so that
// with 2 humans, turn order alternates human / automated army.
const HUMAN_SEATS = {
  0: [],
  1: ['hearts'],
  2: ['hearts', 'diamonds'],
  3: ['hearts', 'spades', 'diamonds'],
  4: ['hearts', 'spades', 'diamonds', 'clubs'],
};

// In Node (tests/simulations) pull the card helpers into globals; in the
// browser cards.js has already declared them, so nothing to do.
if (typeof require !== 'undefined' && typeof SUITS === 'undefined') {
  Object.assign(globalThis, require('./cards.js'));
}

function shuffle(arr) {
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function createGame(numHumans) {
  const humans = HUMAN_SEATS[numHumans] === undefined ? HUMAN_SEATS[1] : HUMAN_SEATS[numHumans];
  const state = {
    season: 1,
    deck: shuffle(makeDeck()),
    discard: [],
    garrison: null,
    armies: {},
    orderIdx: 0,
    actionsLeft: 0,
    flipsLeft: 0,
    pendingDiscard: 0,
    over: false,
    winners: null,
    log: [],
  };
  for (const suit of SUITS) {
    state.armies[suit] = {
      suit,
      isHuman: humans.indexOf(suit) !== -1,
      hand: [],
      camp: [],
      road: new Array(ROAD_LEN).fill(null),
      posts: { queen: null, king: null },
      glory: 0,
    };
  }
  for (const suit of humans) {
    for (let i = 0; i < 4; i++) state.armies[suit].hand.push(state.deck.pop());
  }
  const g = state.deck.pop();
  state.garrison = { card: g, owner: null };
  addLog(state, 'system', 'The war for the Citadel begins. Mercenaries hold it: ' +
    cardLabel(g) + ' (strength ' + strength(g) + ').');
  beginTurn(state);
  return state;
}

function addLog(state, kind, msg) {
  state.log.push({ kind, msg, season: state.season });
}

function currentArmy(state) {
  return state.armies[SUITS[state.orderIdx]];
}

function qBonus(army) {
  return army.posts.queen ? 2 : 0;
}

function unitsOnBoard(army) {
  return army.camp.length + army.road.filter(Boolean).length;
}

/* ── Deck, seasons, game end ──────────────────────────────────────────── */

function drawCard(state) {
  if (state.over) return null;
  if (!state.deck.length) endSeason(state);
  if (state.over || !state.deck.length) return null;
  return state.deck.pop();
}

function endSeason(state) {
  if (state.garrison.owner) {
    state.armies[state.garrison.owner].glory += GLORY.season;
    addLog(state, 'system', '🍂 The season ends. ' + armyName(state.garrison.owner) +
      ' holds the Citadel: +' + GLORY.season + ' glory.');
  } else {
    addLog(state, 'system', '🍂 The season ends with mercenaries still holding the Citadel.');
  }
  if (state.season >= SEASONS) {
    finishGame(state);
    return;
  }
  state.season++;
  state.deck = shuffle(state.discard);
  state.discard = [];
  addLog(state, 'system', '🌱 Season ' + state.season + ' begins — the fallen return to the deck (' +
    state.deck.length + ' cards).');
  if (!state.deck.length) finishGame(state);
}

function finishGame(state) {
  state.over = true;
  const best = Math.max.apply(null, SUITS.map(s => state.armies[s].glory));
  state.winners = SUITS.filter(s => state.armies[s].glory === best);
  addLog(state, 'system', '🏁 The war is over. ' +
    state.winners.map(armyName).join(' and ') + ' claim' +
    (state.winners.length === 1 ? 's' : '') + ' victory with ' + best + ' glory!');
}

/* ── Turn flow ────────────────────────────────────────────────────────── */

function beginTurn(state) {
  if (state.over) return;
  const army = currentArmy(state);
  if (army.isHuman) {
    let drawn = 0;
    while (drawn < 2) {
      const card = drawCard(state);
      if (!card) break;
      army.hand.push(card);
      drawn++;
    }
    state.pendingDiscard = Math.max(0, army.hand.length - HAND_LIMIT);
    if (state.over) return;
    addLog(state, 'turn', '— ' + armyName(army.suit) + ' takes the field (draws ' + drawn + ').' +
      (state.pendingDiscard ? ' Hand over ' + HAND_LIMIT + ' — must discard ' + state.pendingDiscard + '.' : ''));
    state.actionsLeft = ACTIONS_PER_TURN;
  } else {
    addLog(state, 'turn', '— ' + armyName(army.suit) + ' (automated) takes the field.');
    state.flipsLeft = NPC_FLIPS;
  }
}

function nextTurn(state) {
  if (state.over) return;
  state.orderIdx = (state.orderIdx + 1) % SUITS.length;
  beginTurn(state);
}

function spendAction(state) {
  state.actionsLeft--;
  if (state.over) return;
  if (state.actionsLeft <= 0) nextTurn(state);
}

function passTurn(state) {
  const army = currentArmy(state);
  if (!army.isHuman || state.over || state.pendingDiscard > 0) return;
  addLog(state, 'player', armyName(army.suit) + ' holds position.');
  state.actionsLeft = 0;
  nextTurn(state);
}

/* ── Battles ──────────────────────────────────────────────────────────── */

function resolveAssault(state, suit, unit) {
  const army = state.armies[suit];
  const g = state.garrison;
  const attStr = strength(unit) + qBonus(army);
  const defStr = strength(g.card) + (g.owner ? qBonus(state.armies[g.owner]) : 0);
  const defName = g.owner ? armyName(g.owner) : 'the mercenaries';
  if (attStr > defStr) {
    state.discard.push(g.card);
    const oldOwner = g.owner;
    state.garrison = { card: unit, owner: suit };
    army.glory += GLORY.capture;
    addLog(state, 'battle', '🏰 ' + armyName(suit) + '\'s ' + cardLabel(unit) + ' (' + attStr +
      ') storms the Citadel, defeating ' + defName + ' (' + defStr + ')! +' + GLORY.capture + ' glory.' +
      (oldOwner ? '' : ''));
  } else {
    state.discard.push(unit);
    if (g.owner) state.armies[g.owner].glory += GLORY.battle;
    addLog(state, 'battle', '🛡️ Assault repelled! ' + armyName(suit) + '\'s ' + cardLabel(unit) +
      ' (' + attStr + ') falls to ' + defName + ' (' + defStr + ').' +
      (g.owner ? ' +' + GLORY.battle + ' glory to ' + armyName(g.owner) + '.' : ''));
  }
}

function resolveRaid(state, attackerSuit, jack, targetSuit, roadIdx) {
  const att = state.armies[attackerSuit];
  const def = state.armies[targetSuit];
  const target = def.road[roadIdx];
  const attStr = strength(jack) + qBonus(att);
  const defStr = strength(target) + qBonus(def);
  if (attStr > defStr) {
    def.road[roadIdx] = null;
    state.discard.push(target);
    att.glory += GLORY.battle;
    addLog(state, 'battle', '🗡️ ' + armyName(attackerSuit) + '\'s raiders (' + attStr +
      ') cut down ' + armyName(targetSuit) + '\'s ' + cardLabel(target) + ' (' + defStr +
      ')! +' + GLORY.battle + ' glory.');
  } else {
    def.glory += GLORY.battle;
    addLog(state, 'battle', '🛡️ ' + armyName(targetSuit) + '\'s ' + cardLabel(target) + ' (' + defStr +
      ') drives off ' + armyName(attackerSuit) + '\'s raiders (' + attStr + '). +' +
      GLORY.battle + ' glory to the defender.');
  }
  state.discard.push(jack); // raiders always withdraw
}

/* ── Marching ─────────────────────────────────────────────────────────── */

/* All legal marches for a suit: {from: {zone:'camp'}|{zone:'road',idx},
 * dest: {zone:'road',idx}|{zone:'citadel'}, steps}. One card per road space,
 * no jumping over occupied spaces; assaulting your own garrison is illegal. */
function computeMarchMoves(state, suit) {
  const army = state.armies[suit];
  const maxSteps = army.posts.king ? 2 : 1;
  const moves = [];
  for (let i = ROAD_LEN - 1; i >= 0; i--) {
    if (!army.road[i]) continue;
    let pos = i;
    for (let s = 0; s < maxSteps; s++) {
      if (pos === ROAD_LEN - 1) {
        if (state.garrison.owner !== suit) {
          moves.push({ from: { zone: 'road', idx: i }, dest: { zone: 'citadel' }, steps: s + 1 });
        }
        break;
      }
      if (army.road[pos + 1]) break;
      pos++;
      moves.push({ from: { zone: 'road', idx: i }, dest: { zone: 'road', idx: pos }, steps: s + 1 });
    }
  }
  if (army.camp.length && !army.road[0]) {
    moves.push({ from: { zone: 'camp' }, dest: { zone: 'road', idx: 0 }, steps: 1 });
    if (maxSteps === 2 && !army.road[1]) {
      moves.push({ from: { zone: 'camp' }, dest: { zone: 'road', idx: 1 }, steps: 2 });
    }
  }
  return moves;
}

/* Move a unit along a chosen march. campIdx picks which camp unit marches
 * (defaults to the strongest). Returns the moved unit. */
function executeMove(state, suit, move, campIdx) {
  const army = state.armies[suit];
  let unit;
  if (move.from.zone === 'camp') {
    let idx = campIdx;
    if (idx === undefined || idx === null || !army.camp[idx]) {
      idx = 0;
      for (let i = 1; i < army.camp.length; i++) {
        if (strength(army.camp[i]) > strength(army.camp[idx])) idx = i;
      }
    }
    unit = army.camp.splice(idx, 1)[0];
  } else {
    unit = army.road[move.from.idx];
    army.road[move.from.idx] = null;
  }
  if (move.dest.zone === 'citadel') {
    addLog(state, 'player', armyName(suit) + '\'s ' + cardLabel(unit) + ' marches on the Citadel!');
    resolveAssault(state, suit, unit);
  } else {
    army.road[move.dest.idx] = unit;
    addLog(state, 'player', armyName(suit) + '\'s ' + cardLabel(unit) + ' marches to road space ' +
      (move.dest.idx + 1) + '.');
  }
  return unit;
}

/* ── Human actions (act on the current army; validated) ───────────────── */

function humanGuard(state) {
  const army = currentArmy(state);
  if (state.over) return { ok: false, msg: 'The war is over.' };
  if (!army.isHuman) return { ok: false, msg: 'Not a player turn.' };
  if (state.pendingDiscard > 0) return { ok: false, msg: 'Discard down to ' + HAND_LIMIT + ' cards first.' };
  if (state.actionsLeft <= 0) return { ok: false, msg: 'No actions left.' };
  return { ok: true, army };
}

/* Discard a card to satisfy the hand limit after drawing. */
function discardFromHand(state, handIdx) {
  const army = currentArmy(state);
  if (state.over || !army.isHuman) return { ok: false, msg: 'Not a player turn.' };
  if (state.pendingDiscard <= 0) return { ok: false, msg: 'No discard needed.' };
  const card = army.hand[handIdx];
  if (!card) return { ok: false, msg: 'No such card.' };
  army.hand.splice(handIdx, 1);
  state.discard.push(card);
  state.pendingDiscard--;
  addLog(state, 'player', armyName(army.suit) + ' discards ' + cardLabel(card) + '.');
  return { ok: true };
}

function deploy(state, handIdx) {
  const g = humanGuard(state);
  if (!g.ok) return g;
  const army = g.army;
  const card = army.hand[handIdx];
  if (!card) return { ok: false, msg: 'No such card.' };
  if (card.suit !== army.suit) return { ok: false, msg: 'Only cards of your own suit can be deployed. Off-suit cards are supply for marching.' };
  if (card.rank === 'Q') {
    if (army.posts.queen) return { ok: false, msg: 'Your Banner is already raised.' };
    army.posts.queen = card;
    addLog(state, 'player', armyName(army.suit) + ' raises the Banner (Q): all their units now fight at +2.');
  } else if (card.rank === 'K') {
    if (army.posts.king) return { ok: false, msg: 'Your General is already in camp.' };
    army.posts.king = card;
    addLog(state, 'player', armyName(army.suit) + '\'s General (K) takes command: marches now move up to 2 spaces.');
  } else {
    army.camp.push(card);
    addLog(state, 'player', armyName(army.suit) + ' musters ' + cardLabel(card) +
      ' (strength ' + strength(card) + ') in camp.');
  }
  army.hand.splice(handIdx, 1);
  spendAction(state);
  return { ok: true };
}

function raid(state, handIdx, targetSuit, roadIdx) {
  const g = humanGuard(state);
  if (!g.ok) return g;
  const army = g.army;
  const card = army.hand[handIdx];
  if (!card || card.suit !== army.suit || card.rank !== 'J') {
    return { ok: false, msg: 'Raiding requires the Jack of your own suit.' };
  }
  const defender = state.armies[targetSuit];
  if (!defender || targetSuit === army.suit || !defender.road[roadIdx]) {
    return { ok: false, msg: 'Pick an enemy unit on a road to raid.' };
  }
  army.hand.splice(handIdx, 1);
  resolveRaid(state, army.suit, card, targetSuit, roadIdx);
  spendAction(state);
  return { ok: true };
}

function marchTo(state, supplyIdx, dest, campIdx) {
  const g = humanGuard(state);
  if (!g.ok) return g;
  const army = g.army;
  const supply = army.hand[supplyIdx];
  if (!supply || supply.suit === army.suit) {
    return { ok: false, msg: 'Marching is paid with an off-suit (supply) card.' };
  }
  const moves = computeMarchMoves(state, army.suit);
  const move = moves.find(m =>
    m.dest.zone === dest.zone && (dest.zone === 'citadel' || m.dest.idx === dest.idx));
  if (!move) return { ok: false, msg: 'No unit can march there.' };
  army.hand.splice(supplyIdx, 1);
  state.discard.push(supply);
  executeMove(state, army.suit, move, campIdx);
  spendAction(state);
  return { ok: true };
}

/* ── The automated-army script ────────────────────────────────────────── *
 * One flip: own suit → deploy (Jack raids if it has a target; Q/K take their
 * posts). Any other suit → supply: the frontmost unit marches as far as it
 * can; with no unit able to move, the strongest camp unit steps out; with no
 * units at all, the supply is wasted. Fully deterministic. */

function npcRaidTarget(state, suit) {
  let best = null;
  // Clockwise from the acting army's seat for the final tiebreak.
  for (let d = 1; d < SUITS.length; d++) {
    const enemy = SUITS[(SUITS.indexOf(suit) + d) % SUITS.length];
    const road = state.armies[enemy].road;
    for (let i = 0; i < ROAD_LEN; i++) {
      if (!road[i]) continue;
      const cand = { suit: enemy, idx: i, str: strength(road[i]) };
      if (!best || cand.idx > best.idx || (cand.idx === best.idx && cand.str > best.str)) {
        best = cand;
      }
    }
  }
  return best;
}

function npcPickMove(moves) {
  // The frontmost unit (highest road index; camp last) moving its farthest.
  let best = null;
  for (const m of moves) {
    const fromRank = m.from.zone === 'camp' ? -1 : m.from.idx;
    const bestRank = best ? (best.from.zone === 'camp' ? -1 : best.from.idx) : -2;
    if (!best || fromRank > bestRank || (fromRank === bestRank && m.steps > best.steps)) best = m;
  }
  return best;
}

function npcFlip(state) {
  if (state.over) return;
  const army = currentArmy(state);
  if (army.isHuman || state.flipsLeft <= 0) return;
  const card = drawCard(state);
  if (state.over) return;
  if (!card) { state.flipsLeft = 0; nextTurn(state); return; }

  if (card.suit === army.suit) {
    if (card.rank === 'Q' && !army.posts.queen) {
      army.posts.queen = card;
      addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) +
        ' — raises its Banner: units fight at +2.');
    } else if (card.rank === 'K' && !army.posts.king) {
      army.posts.king = card;
      addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) +
        ' — its General takes command: marches move up to 2.');
    } else if (card.rank === 'J') {
      const target = npcRaidTarget(state, army.suit);
      if (target) {
        addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) + ' — raiders ride out!');
        resolveRaid(state, army.suit, card, target.suit, target.idx);
      } else {
        army.camp.push(card);
        addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) +
          ' — no one to raid; the Jack joins the camp (strength 11).');
      }
    } else {
      army.camp.push(card);
      addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) +
        ' — musters it in camp (strength ' + strength(card) + ').');
    }
  } else {
    const moves = computeMarchMoves(state, army.suit);
    state.discard.push(card);
    if (!moves.length) {
      addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) +
        ' — supplies, but no unit can move.');
    } else {
      addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) + ' — supplies a march.');
      executeMove(state, army.suit, npcPickMove(moves));
    }
  }
  if (state.over) return;
  state.flipsLeft--;
  if (state.flipsLeft <= 0) nextTurn(state);
}

if (typeof module !== 'undefined') {
  module.exports = {
    ROAD_LEN, HAND_LIMIT, ACTIONS_PER_TURN, NPC_FLIPS, SEASONS, GLORY, HUMAN_SEATS,
    createGame, currentArmy, qBonus, unitsOnBoard, computeMarchMoves,
    deploy, raid, marchTo, passTurn, npcFlip, discardFromHand,
  };
}
