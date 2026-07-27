/* Four Banners — game page UI. Renders the engine state and wires up input.
 * The engine is pure; everything DOM lives here.
 *
 * Interaction model:
 *  - Click a card of your suit  → deploy mode (pick an army to reinforce, or
 *    found a new one). Q/K post instantly; the Jack offers raid-or-deploy.
 *  - Click one of your armies   → march mode (its forward destination lights
 *    up with the move/merge/assault and the supply cost). Supply cards are
 *    spent from your hand automatically.
 */

let game = null;
const ui = {
  mode: null,          // null | {type:'deploy'|'jack'|'raid', handIdx} | {type:'march', from}
  revealedSuit: null,  // hot-seat: which human's hand is currently shown
  npcTimer: null,
  numHumans: 1,
};

const BOARD_POS = {
  spades:   { camp: [1, 5], road: [[2, 5], [3, 5], [4, 5]] },
  hearts:   { camp: [5, 1], road: [[5, 2], [5, 3], [5, 4]] },
  diamonds: { camp: [5, 9], road: [[5, 8], [5, 7], [5, 6]] },
  clubs:    { camp: [9, 5], road: [[8, 5], [7, 5], [6, 5]] },
};

function humanSuits() {
  return SUITS.filter(s => game.armies[s].isHuman);
}

function playerLabel(suit) {
  const humans = HUMAN_SEATS[ui.numHumans];
  const i = humans.indexOf(suit);
  return i === -1 ? 'Automated' : 'Player ' + (i + 1);
}

/* ── Game lifecycle ───────────────────────────────────────────────────── */

function newGame(numHumans) {
  ui.numHumans = numHumans;
  clearTimeout(ui.npcTimer);
  ui.npcTimer = null;
  ui.mode = null;
  ui.revealedSuit = null;
  game = createGame(numHumans);
  document.getElementById('setup').classList.add('hidden');
  document.getElementById('gameArea').classList.remove('hidden');
  document.getElementById('endModal').classList.add('hidden');
  render();
  maybeScheduleNpc();
}

function backToSetup() {
  clearTimeout(ui.npcTimer);
  ui.npcTimer = null;
  game = null;
  document.getElementById('endModal').classList.add('hidden');
  document.getElementById('gameArea').classList.add('hidden');
  document.getElementById('setup').classList.remove('hidden');
}

function afterEngineCall() {
  render();
  if (game.over) { showEndModal(); return; }
  maybeScheduleNpc();
}

function maybeScheduleNpc() {
  if (!game || game.over || currentArmy(game).isHuman || ui.npcTimer) return;
  ui.npcTimer = setTimeout(() => {
    ui.npcTimer = null;
    npcFlip(game);
    afterEngineCall();
  }, 900);
}

/* ── Input ────────────────────────────────────────────────────────────── */

function myTurn() {
  return game && !game.over && currentArmy(game).isHuman &&
    (humanSuits().length <= 1 || ui.revealedSuit === currentArmy(game).suit);
}

function raidTargetsExist() {
  const suit = currentArmy(game).suit;
  return SUITS.some(s => s !== suit && game.armies[s].road.some(Boolean));
}

function myPlans() {
  return computeMarchPlans(game, currentArmy(game).suit);
}

function onHandClick(i) {
  if (!myTurn()) return;
  const army = currentArmy(game);
  const card = army.hand[i];
  if (!card) return;
  if (game.pendingDiscard > 0) {
    discardFromHand(game, i);
    afterEngineCall();
    return;
  }
  ui.mode = null;
  if (card.suit !== army.suit) {
    toast('Off-suit cards are supply — click one of your armies to march it.');
    render();
    return;
  }
  if (card.rank === 'Q' || card.rank === 'K') {
    const res = deployCard(game, i, null);
    if (!res.ok) { toast(res.msg); return; }
    afterEngineCall();
    return;
  }
  if (card.rank === 'J' && raidTargetsExist()) {
    ui.mode = { type: 'jack', handIdx: i };
  } else {
    ui.mode = { type: 'deploy', handIdx: i };
  }
  render();
}

function chooseJackRaid() {
  ui.mode = { type: 'raid', handIdx: ui.mode.handIdx };
  render();
}

function chooseJackDeploy() {
  ui.mode = { type: 'deploy', handIdx: ui.mode.handIdx };
  render();
}

function deployTo(targetJson) {
  if (!myTurn() || !ui.mode || ui.mode.type !== 'deploy') return;
  const res = deployCard(game, ui.mode.handIdx, JSON.parse(targetJson));
  ui.mode = null;
  if (!res.ok) toast(res.msg);
  afterEngineCall();
}

function startMarch(zone, idx) {
  if (!myTurn()) return;
  const army = currentArmy(game);
  const plan = myPlans().find(p => p.from.zone === zone && p.from.idx === idx);
  if (!plan) { toast('That army has nowhere to march.'); return; }
  if (supplyIndices(army).length < plan.cost) {
    toast('Marching that army costs ' + plan.cost + ' supply — you have ' +
      supplyIndices(army).length + '.');
    return;
  }
  ui.mode = { type: 'march', from: { zone, idx } };
  render();
}

function confirmMarch() {
  if (!myTurn() || !ui.mode || ui.mode.type !== 'march') return;
  const res = march(game, ui.mode.from);
  ui.mode = null;
  if (!res.ok) toast(res.msg);
  afterEngineCall();
}

function onCellClick(zone, suit, idx) {
  if (!myTurn()) return;
  const army = currentArmy(game);
  if (ui.mode && ui.mode.type === 'raid') {
    if (zone !== 'road' || suit === army.suit || !game.armies[suit].road[idx]) return;
    const res = raid(game, ui.mode.handIdx, suit, idx);
    ui.mode = null;
    if (!res.ok) toast(res.msg);
    afterEngineCall();
    return;
  }
  if (ui.mode && ui.mode.type === 'deploy') {
    if (zone === 'citadel') { deployTo(JSON.stringify({ zone: 'garrison' })); return; }
    if (zone === 'road' && suit === army.suit) { deployTo(JSON.stringify({ zone: 'road', idx })); return; }
    return;
  }
  if (ui.mode && ui.mode.type === 'march') {
    const plan = myPlans().find(p => p.from.zone === ui.mode.from.zone && p.from.idx === ui.mode.from.idx);
    if (!plan) { ui.mode = null; render(); return; }
    const hit = plan.dest.zone === 'citadel' ? zone === 'citadel'
      : zone === 'road' && suit === army.suit && idx === plan.dest.idx;
    if (hit) confirmMarch();
    return;
  }
  // No mode: clicking one of your road armies begins a march.
  if (zone === 'road' && suit === army.suit && game.armies[suit].road[idx]) startMarch('road', idx);
}

function cancelMode() {
  ui.mode = null;
  render();
}

function onEndTurn() {
  if (!myTurn() || game.pendingDiscard > 0) return;
  ui.mode = null;
  passTurn(game);
  afterEngineCall();
}

function revealTurn() {
  ui.revealedSuit = currentArmy(game).suit;
  render();
}

/* ── Rendering ────────────────────────────────────────────────────────── */

function render() {
  if (!game) return;
  renderBoard();
  renderHand();
  renderSidebar();
  renderLog();
  renderHandoff();
}

function pcardHTML(card, cls) {
  const meta = SUIT_META[card.suit];
  return '<div class="pcard ' + meta.color + (cls ? ' ' + cls : '') + '">' +
    '<span class="pc-rank">' + card.rank + '</span>' +
    '<span class="pc-suit">' + meta.symbol + '</span></div>';
}

function stackHTML(state, ownerSuit, cards) {
  const str = effStrength(state, ownerSuit, cards);
  return '<div class="stack" title="' + stackLabel(cards) + ' — strength ' + str +
    (ownerSuit && qBonus(state.armies[ownerSuit]) ? ' (incl. Banner +2)' : '') + '">' +
    cards.map(c => pcardHTML(c, 'mini')).join('') +
    '<span class="str-badge">' + str + '</span></div>';
}

function renderBoard() {
  const army = game ? currentArmy(game) : null;
  const mySuit = army ? army.suit : null;
  const mode = ui.mode ? ui.mode.type : null;
  const plans = myTurn() && army.isHuman ? myPlans() : [];
  const nSupply = army && army.isHuman ? supplyIndices(army).length : 0;
  const marchPlan = mode === 'march'
    ? plans.find(p => p.from.zone === ui.mode.from.zone && p.from.idx === ui.mode.from.idx) : null;
  let html = '';

  for (const suit of SUITS) {
    const a = game.armies[suit];
    const pos = BOARD_POS[suit];
    const meta = SUIT_META[suit];

    // Camp: summary chips (the acting player's camp is detailed below the board)
    const chips = a.camp.map(s =>
      '<span class="army-chip" title="' + stackLabel(s.cards) + '">' + stackSum(s.cards) + '</span>').join('');
    const posts = (a.posts.queen ? '<span class="post" title="Banner: armies fight at +2">Q</span>' : '') +
      (a.posts.king ? '<span class="post" title="General: marches cost 1 less">K</span>' : '');
    const supplyNote = !a.isHuman && a.supply ? '<span class="supply-note" title="Banked supply">⛽' + a.supply + '</span>' : '';
    html += '<div class="cell camp suit-' + suit + '" style="grid-row:' + pos.camp[0] + ';grid-column:' + pos.camp[1] + '"' +
      ' title="' + armyName(suit) + ' camp — ' + a.camp.length + ' army(ies)">' +
      '<div class="camp-head">' + meta.symbol + posts + supplyNote + '</div>' +
      '<div class="camp-chips">' + chips + '</div></div>';

    // Road spaces
    for (let i = 0; i < ROAD_LEN; i++) {
      const [row, col] = pos.road[i];
      const stack = a.road[i];
      const classes = ['cell', 'road', 'suit-' + suit];
      let click = ' onclick="onCellClick(\'road\',\'' + suit + '\',' + i + ')"';
      if (mode === 'raid' && stack && suit !== mySuit) classes.push('targetable');
      else if (mode === 'deploy' && stack && suit === mySuit && stack.cards.length < STACK_CAP) classes.push('targetable');
      else if (marchPlan && marchPlan.dest.zone === 'road' && suit === mySuit && i === marchPlan.dest.idx) classes.push('targetable');
      else if (!mode && stack && suit === mySuit &&
        plans.some(p => p.from.zone === 'road' && p.from.idx === i && p.cost <= nSupply)) classes.push('movable');
      html += '<div class="' + classes.join(' ') + '" style="grid-row:' + row + ';grid-column:' + col + '"' + click + '>' +
        (stack ? stackHTML(game, suit, stack.cards) : '') + '</div>';
    }
  }

  // Citadel
  const g = game.garrison;
  const citClasses = ['cell', 'citadel'];
  if (marchPlan && marchPlan.dest.zone === 'citadel') citClasses.push('targetable');
  else if (mode === 'deploy' && g.owner === mySuit && g.cards.length < STACK_CAP) citClasses.push('targetable');
  if (g.owner) citClasses.push('owner-' + g.owner);
  html += '<div class="' + citClasses.join(' ') + '" style="grid-row:5;grid-column:5"' +
    ' onclick="onCellClick(\'citadel\',null,0)"' +
    ' title="Citadel — held by ' + (g.owner ? armyName(g.owner) : 'mercenaries') +
    ', defends at ' + effStrength(game, g.owner, g.cards) + '. Pays ' + GLORY.tribute +
    ' glory per turn to its holder.">' +
    '<span class="crown">👑</span>' + stackHTML(game, g.owner, g.cards) + '</div>';

  document.getElementById('board').innerHTML = html;
}

function renderHand() {
  const area = document.getElementById('handArea');
  const cur = currentArmy(game);
  let handSuit = null;
  if (cur.isHuman && (humanSuits().length <= 1 || ui.revealedSuit === cur.suit)) handSuit = cur.suit;
  else if (humanSuits().length === 1) handSuit = humanSuits()[0];

  if (!handSuit) {
    area.innerHTML = '<p class="hint">' + (cur.isHuman ? 'Waiting for ' + armyName(cur.suit) + '…'
      : 'Automated armies are moving…') + '</p>';
    return;
  }
  const a = game.armies[handSuit];
  const active = myTurn() && handSuit === cur.suit;
  const discarding = active && game.pendingDiscard > 0;
  const mode = active && ui.mode ? ui.mode.type : null;
  const plans = active ? myPlans() : [];
  const nSupply = supplyIndices(a).length;

  // Camp strip: your armies at home, clickable to march or reinforce.
  let campHtml = '<div class="camp-strip"><h3>Your camp</h3><div class="camp-armies">';
  campHtml += a.camp.map((s, i) => {
    const cls = ['camp-army'];
    if (mode === 'deploy' && s.cards.length < STACK_CAP) cls.push('targetable');
    else if (!mode && plans.some(p => p.from.zone === 'camp' && p.from.idx === i && p.cost <= nSupply)) cls.push('movable');
    else if (mode === 'march' && ui.mode.from.zone === 'camp' && ui.mode.from.idx === i) cls.push('selected-army');
    const click = mode === 'deploy' ? 'deployTo(\'' + JSON.stringify({ zone: 'camp', idx: i }).replace(/"/g, '&quot;') + '\')'
      : 'startMarch(\'camp\',' + i + ')';
    return '<div class="' + cls.join(' ') + '" onclick="' + (active ? click : '') + '">' +
      stackHTML(game, handSuit, s.cards) + '</div>';
  }).join('');
  if (mode === 'deploy') {
    campHtml += '<div class="camp-army targetable new-army" onclick="deployTo(\'' +
      JSON.stringify({ zone: 'newcamp' }).replace(/"/g, '&quot;') + '\')">➕<br>new army</div>';
  }
  if (!a.camp.length && mode !== 'deploy') campHtml += '<p class="hint">No armies mustered.</p>';
  campHtml += '</div></div>';

  let html = campHtml + '<h3>' + armyName(handSuit) + ' — your hand' +
    (discarding ? ' <span class="bad">(discard ' + game.pendingDiscard + ')</span>' : '') +
    ' <span class="supply-count">⛽ ' + nSupply + ' supply</span></h3>' +
    '<div class="hand-cards">';
  html += a.hand.map((card, i) => {
    const own = card.suit === handSuit;
    const classes = [];
    if (active && (own || discarding)) classes.push('playable');
    if (!own) classes.push('supply');
    if (ui.mode && ui.mode.handIdx === i && (mode === 'deploy' || mode === 'jack' || mode === 'raid')) classes.push('selected');
    const tag = own ? (card.rank === 'J' ? 'raider' : card.rank === 'Q' ? 'banner' :
      card.rank === 'K' ? 'general' : card.rank === 'A' ? 'champion' : 'soldier') : 'supply';
    return '<div class="hand-slot"' + (active ? ' onclick="onHandClick(' + i + ')"' : '') + '>' +
      pcardHTML(card, classes.join(' ')) + '<span class="hand-tag">' + tag + '</span></div>';
  }).join('') || '<p class="hint">Empty hand.</p>';
  html += '</div>';
  area.innerHTML = html;
}

function renderSidebar() {
  const cur = currentArmy(game);

  // Scoreboard
  let rows = '';
  for (const suit of SUITS) {
    const a = game.armies[suit];
    rows += '<div class="score-row' + (suit === cur.suit && !game.over ? ' current' : '') + '">' +
      '<span class="dot" style="background:' + SUIT_META[suit].tint + '"></span>' +
      '<span class="score-name">' + armyName(suit) + '</span>' +
      '<span class="score-who">' + (a.isHuman ? playerLabel(suit) : 'Auto') + '</span>' +
      '<span class="score-glory">' + (game.garrison.owner === suit ? '👑 ' : '') + a.glory + ' 🏅</span>' +
      '</div>';
  }
  rows += '<div class="deck-info">Season ' + game.season + ' of ' + SEASONS +
    ' · Deck ' + game.deck.length + ' · Discard ' + game.discard.length + '</div>';
  document.getElementById('scoreboard').innerHTML = rows;

  // Turn panel
  const panel = document.getElementById('turnPanel');
  if (game.over) {
    panel.innerHTML = '<p>The war is over. <a href="#" onclick="showEndModal();return false;">View results</a></p>';
    return;
  }
  if (!cur.isHuman) {
    panel.innerHTML = '<p>' + armyName(cur.suit) + ' (automated) is flipping cards… ' +
      '(' + game.flipsLeft + ' flip' + (game.flipsLeft === 1 ? '' : 's') + ' left)</p>';
    return;
  }
  if (!myTurn()) {
    panel.innerHTML = '<p>Waiting for ' + playerLabel(cur.suit) + '…</p>';
    return;
  }
  let html = '<p><strong>' + armyName(cur.suit) + '</strong> — ' + game.actionsLeft +
    ' action' + (game.actionsLeft === 1 ? '' : 's') + ' left.</p>';
  const mode = ui.mode ? ui.mode.type : null;
  if (game.pendingDiscard > 0) {
    html += '<p class="prompt bad">Hand over limit — click ' + game.pendingDiscard + ' card(s) to discard.</p>';
  } else if (mode === 'jack') {
    html += '<p class="prompt">Your Jack can raid or fight in the ranks:</p>' +
      '<button class="btn" onclick="chooseJackRaid()">🗡️ Raid an enemy army</button> ' +
      '<button class="btn" onclick="chooseJackDeploy()">🛡️ Deploy as soldier (11)</button> ' +
      '<button class="btn" onclick="cancelMode()">Cancel</button>';
  } else if (mode === 'raid') {
    html += '<p class="prompt">Click an enemy army — your raiders (' + (11 + qBonus(cur)) +
      ') strike its weakest card.</p><button class="btn" onclick="cancelMode()">Cancel</button>';
  } else if (mode === 'deploy') {
    html += '<p class="prompt">Reinforce a highlighted army (max ' + STACK_CAP +
      ' cards), or found a new one in camp.</p><button class="btn" onclick="cancelMode()">Cancel</button>';
  } else if (mode === 'march') {
    const plan = myPlans().find(p => p.from.zone === ui.mode.from.zone && p.from.idx === ui.mode.from.idx);
    if (plan) {
      const what = plan.kind === 'assault' ? 'assault the Citadel' :
        plan.kind === 'merge' ? 'merge with your army ahead' : 'advance one space';
      html += '<p class="prompt">This army will <strong>' + what + '</strong> for ' +
        plan.cost + ' supply (you have ' + supplyIndices(cur).length +
        '). Click the highlighted space.</p>';
    }
    html += '<button class="btn" onclick="cancelMode()">Cancel</button>';
  } else {
    html += '<p class="prompt">Click a card of your suit to deploy · click one of your armies to march it.</p>' +
      '<button class="btn" onclick="onEndTurn()">Hold position (end turn)</button>';
  }
  panel.innerHTML = html;
}

function renderHandoff() {
  const overlay = document.getElementById('handoff');
  const cur = currentArmy(game);
  const need = !game.over && cur.isHuman && humanSuits().length > 1 && ui.revealedSuit !== cur.suit;
  overlay.classList.toggle('hidden', !need);
  if (need) {
    document.getElementById('handoffText').innerHTML =
      'Pass the device to <strong>' + playerLabel(cur.suit) + '</strong><br>' + armyName(cur.suit);
  }
}

function renderLog() {
  document.getElementById('log').innerHTML = game.log.slice(-45).reverse().map(e =>
    '<p class="log-' + e.kind + '">' + e.msg + '</p>').join('');
}

/* ── End of game ──────────────────────────────────────────────────────── */

function showEndModal() {
  const rows = SUITS.slice().sort((a, b) => game.armies[b].glory - game.armies[a].glory);
  document.getElementById('endVerdict').innerHTML = '🏆 ' +
    game.winners.map(armyName).join(' & ') + ' — victorious with ' +
    game.armies[game.winners[0]].glory + ' glory!';
  document.getElementById('endTable').innerHTML =
    '<tr><th>Army</th><th>Controller</th><th>Glory</th></tr>' +
    rows.map(s => '<tr' + (game.winners.indexOf(s) !== -1 ? ' class="winner-row"' : '') + '><td>' + armyName(s) + '</td><td>' +
      (game.armies[s].isHuman ? playerLabel(s) : 'Automated') + '</td><td>' +
      game.armies[s].glory + '</td></tr>').join('');
  document.getElementById('endModal').classList.remove('hidden');
}

function hideEndModal() {
  document.getElementById('endModal').classList.add('hidden');
}

/* ── Toast ────────────────────────────────────────────────────────────── */

let toastTimer = null;
function toast(msg) {
  const el = document.getElementById('toast');
  el.textContent = msg;
  el.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => el.classList.remove('show'), 2400);
}
