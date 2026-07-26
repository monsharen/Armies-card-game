/* Four Banners — game page UI. Renders the engine state and wires up input.
 * The engine is pure; everything DOM lives here. */

let game = null;
const ui = {
  mode: null,          // null | {type:'march'|'raid'|'jack'|'camp', ...}
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
  if (card.suit === army.suit) {
    if (card.rank === 'J' && raidTargetsExist()) {
      ui.mode = { type: 'jack', handIdx: i };
      render();
      return;
    }
    const res = deploy(game, i);
    if (!res.ok) { toast(res.msg); return; }
    afterEngineCall();
  } else {
    if (!computeMarchMoves(game, army.suit).length) {
      toast('No unit can march — muster a soldier first.');
      return;
    }
    ui.mode = { type: 'march', supplyIdx: i };
    render();
  }
}

function chooseJackRaid() {
  ui.mode = { type: 'raid', handIdx: ui.mode.handIdx };
  render();
}

function chooseJackDeploy() {
  const idx = ui.mode.handIdx;
  ui.mode = null;
  const res = deploy(game, idx);
  if (!res.ok) toast(res.msg);
  afterEngineCall();
}

function onCellClick(zone, suit, idx) {
  if (!myTurn() || !ui.mode) return;
  const army = currentArmy(game);
  if (ui.mode.type === 'raid') {
    if (suit === army.suit || zone !== 'road' || !game.armies[suit].road[idx]) return;
    const res = raid(game, ui.mode.handIdx, suit, idx);
    ui.mode = null;
    if (!res.ok) toast(res.msg);
    afterEngineCall();
    return;
  }
  if (ui.mode.type === 'march') {
    const dest = zone === 'citadel' ? { zone: 'citadel' } : { zone: 'road', idx };
    if (zone === 'road' && suit !== army.suit) return;
    const move = computeMarchMoves(game, army.suit).find(m =>
      m.dest.zone === dest.zone && (dest.zone === 'citadel' || m.dest.idx === dest.idx));
    if (!move) return;
    if (move.from.zone === 'camp' && army.camp.length > 1) {
      ui.mode = { type: 'camp', supplyIdx: ui.mode.supplyIdx, dest };
      render();
      return;
    }
    const res = marchTo(game, ui.mode.supplyIdx, dest);
    ui.mode = null;
    if (!res.ok) toast(res.msg);
    afterEngineCall();
  }
}

function pickCampUnit(campIdx) {
  const res = marchTo(game, ui.mode.supplyIdx, ui.mode.dest, campIdx);
  ui.mode = null;
  if (!res.ok) toast(res.msg);
  afterEngineCall();
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

function marchDestsForRender() {
  if (!ui.mode || (ui.mode.type !== 'march' && ui.mode.type !== 'camp')) return null;
  const suit = currentArmy(game).suit;
  const dests = { citadel: false, road: {} };
  for (const m of computeMarchMoves(game, suit)) {
    if (m.dest.zone === 'citadel') dests.citadel = true;
    else dests.road[m.dest.idx] = true;
  }
  return { suit, dests };
}

function renderBoard() {
  const raidMode = ui.mode && ui.mode.type === 'raid';
  const march = marchDestsForRender();
  const mySuit = game && currentArmy(game).suit;
  let html = '';

  for (const suit of SUITS) {
    const army = game.armies[suit];
    const pos = BOARD_POS[suit];
    const meta = SUIT_META[suit];

    // Camp
    const campStack = army.camp.slice(-4).map(c => pcardHTML(c, 'mini')).join('');
    const posts = (army.posts.queen ? '<span class="post" title="Banner: units fight at +2">Q</span>' : '') +
      (army.posts.king ? '<span class="post" title="General: marches move up to 2">K</span>' : '');
    html += '<div class="cell camp suit-' + suit + '" style="grid-row:' + pos.camp[0] + ';grid-column:' + pos.camp[1] + '"' +
      ' title="' + armyName(suit) + ' camp — ' + army.camp.length + ' unit(s) mustered">' +
      '<div class="camp-head">' + meta.symbol + (army.camp.length ? ' ×' + army.camp.length : '') + posts + '</div>' +
      '<div class="camp-stack">' + campStack + '</div></div>';

    // Road spaces
    for (let i = 0; i < ROAD_LEN; i++) {
      const [row, col] = pos.road[i];
      const unit = army.road[i];
      const classes = ['cell', 'road', 'suit-' + suit];
      let click = '';
      if (raidMode && unit && suit !== mySuit) {
        classes.push('targetable');
        click = ' onclick="onCellClick(\'road\',\'' + suit + '\',' + i + ')"';
      } else if (march && suit === march.suit && !unit && march.dests.road[i]) {
        classes.push('targetable');
        click = ' onclick="onCellClick(\'road\',\'' + suit + '\',' + i + ')"';
      }
      html += '<div class="' + classes.join(' ') + '" style="grid-row:' + row + ';grid-column:' + col + '"' + click + '>' +
        (unit ? pcardHTML(unit, 'mini') : '') + '</div>';
    }
  }

  // Citadel
  const g = game.garrison;
  const citClasses = ['cell', 'citadel'];
  let citClick = '';
  if (march && march.dests.citadel) {
    citClasses.push('targetable');
    citClick = ' onclick="onCellClick(\'citadel\',null,0)"';
  }
  if (g.owner) citClasses.push('owner-' + g.owner);
  const defStr = strength(g.card) + (g.owner ? qBonus(game.armies[g.owner]) : 0);
  html += '<div class="' + citClasses.join(' ') + '" style="grid-row:5;grid-column:5"' + citClick +
    ' title="Citadel — held by ' + (g.owner ? armyName(g.owner) : 'mercenaries') + ', defends at ' + defStr + '">' +
    '<span class="crown">👑</span>' + pcardHTML(g.card, 'mini') + '</div>';

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
  const army = game.armies[handSuit];
  const active = myTurn() && handSuit === cur.suit;
  const discarding = active && game.pendingDiscard > 0;
  let html = '<h3>' + armyName(handSuit) + ' — your hand' +
    (discarding ? ' <span class="bad">(discard ' + game.pendingDiscard + ')</span>' : '') + '</h3>' +
    '<div class="hand-cards">';
  html += army.hand.map((card, i) => {
    const own = card.suit === handSuit;
    const classes = [];
    if (active) classes.push('playable');
    if (!own) classes.push('supply');
    if (ui.mode && (ui.mode.type === 'march' || ui.mode.type === 'camp') && ui.mode.supplyIdx === i) classes.push('selected');
    if (ui.mode && (ui.mode.type === 'jack' || ui.mode.type === 'raid') && ui.mode.handIdx === i) classes.push('selected');
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
  if (game.pendingDiscard > 0) {
    html += '<p class="prompt bad">Hand over limit — click ' + game.pendingDiscard + ' card(s) to discard.</p>';
  } else if (ui.mode && ui.mode.type === 'jack') {
    html += '<p class="prompt">Your Jack can raid or fight in the ranks:</p>' +
      '<button class="btn" onclick="chooseJackRaid()">🗡️ Raid an enemy unit</button> ' +
      '<button class="btn" onclick="chooseJackDeploy()">🛡️ Deploy as soldier (11)</button> ' +
      '<button class="btn" onclick="cancelMode()">Cancel</button>';
  } else if (ui.mode && ui.mode.type === 'raid') {
    html += '<p class="prompt">Click an enemy unit on a road to raid it (you strike at ' +
      (11 + qBonus(cur)) + ').</p><button class="btn" onclick="cancelMode()">Cancel</button>';
  } else if (ui.mode && ui.mode.type === 'march') {
    html += '<p class="prompt">Click a highlighted space (or the Citadel) to march there.</p>' +
      '<button class="btn" onclick="cancelMode()">Cancel</button>';
  } else if (ui.mode && ui.mode.type === 'camp') {
    html += '<p class="prompt">Which camp unit marches?</p>' +
      cur.camp.map((c, i) => '<button class="btn camp-pick" onclick="pickCampUnit(' + i + ')">' +
        cardLabel(c) + ' (' + strength(c) + ')</button>').join(' ') +
      ' <button class="btn" onclick="cancelMode()">Cancel</button>';
  } else {
    html += '<p class="prompt">Click a card: your suit deploys · other suits supply a march.</p>' +
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
