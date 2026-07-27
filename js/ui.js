/* Kartenburg — game page UI. Renders the engine state and wires up input.
 * The engine is pure; everything DOM lives here.
 *
 * Interaction model — every choice goes through an explicit modal:
 *  - Hand over the limit        → forced discard modal (no other input works)
 *  - Click a card of your suit  → deploy modal (new army / reinforce which army);
 *                                 the Jack first offers raid-or-deploy
 *  - Click one of your armies   → march modal (destination, cost, and the
 *                                 predicted battle outcome before you commit)
 *  - Click a supply card        → pick which army to march
 */

let game = null;
const ui = {
  modal: null,         // null | {type:'jack'|'deploy'|'march'|'raid'|'pickArmy', ...}
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
  ui.modal = null;
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

function mustDiscard() {
  return myTurn() && game.pendingDiscard > 0;
}

function raidTargets() {
  const suit = currentArmy(game).suit;
  const targets = [];
  for (const enemy of SUITS) {
    if (enemy === suit) continue;
    game.armies[enemy].road.forEach((stack, idx) => {
      if (stack) targets.push({ suit: enemy, idx, stack });
    });
  }
  return targets;
}

function myPlans() {
  return computeMarchPlans(game, currentArmy(game).suit);
}

function onHandClick(i) {
  if (!myTurn() || mustDiscard() || ui.modal) return;
  const army = currentArmy(game);
  const card = army.hand[i];
  if (!card) return;
  if (card.suit !== army.suit) {
    openPickArmyModal();
    return;
  }
  if (card.rank === 'Q' || card.rank === 'K') {
    const res = deployCard(game, i, null);
    if (!res.ok) { toast(res.msg); return; }
    afterEngineCall();
    return;
  }
  if (card.rank === 'J' && raidTargets().length) {
    ui.modal = { type: 'jack', handIdx: i };
  } else {
    ui.modal = { type: 'deploy', handIdx: i };
  }
  render();
}

function jackChoose(what) {
  if (!ui.modal || ui.modal.type !== 'jack') return;
  ui.modal = { type: what === 'raid' ? 'raid' : 'deploy', handIdx: ui.modal.handIdx };
  render();
}

function modalDeploy(targetJson) {
  if (!myTurn() || !ui.modal || ui.modal.type !== 'deploy') return;
  const res = deployCard(game, ui.modal.handIdx, JSON.parse(targetJson));
  ui.modal = null;
  if (!res.ok) toast(res.msg);
  afterEngineCall();
}

function modalRaid(suit, idx) {
  if (!myTurn() || !ui.modal || ui.modal.type !== 'raid') return;
  const res = raid(game, ui.modal.handIdx, suit, idx);
  ui.modal = null;
  if (!res.ok) toast(res.msg);
  afterEngineCall();
}

function modalDiscard(i) {
  if (!mustDiscard()) return;
  discardFromHand(game, i);
  afterEngineCall();
}

function startMarch(zone, idx) {
  if (!myTurn() || mustDiscard()) return;
  const army = currentArmy(game);
  const plan = myPlans().find(p => p.from.zone === zone && p.from.idx === idx);
  if (!plan) { toast('That army has nowhere to march.'); return; }
  if (supplyIndices(army).length < plan.cost) {
    toast('Marching that army costs ' + plan.cost + ' supply — you have ' +
      supplyIndices(army).length + '.');
    return;
  }
  ui.modal = { type: 'march', from: { zone, idx } };
  render();
}

function confirmMarch() {
  if (!myTurn() || !ui.modal || ui.modal.type !== 'march') return;
  const res = march(game, ui.modal.from);
  ui.modal = null;
  if (!res.ok) toast(res.msg);
  afterEngineCall();
}

function openPickArmyModal() {
  if (!myTurn() || mustDiscard()) return;
  if (!myPlans().length) {
    toast('No army can march — deploy a card of your suit first.');
    return;
  }
  ui.modal = { type: 'pickArmy' };
  render();
}

function pickMarchArmy(zone, idx) {
  if (!ui.modal || ui.modal.type !== 'pickArmy') return;
  ui.modal = null;
  startMarch(zone, idx);
}

function cancelModal() {
  if (mustDiscard()) return; // discarding cannot be cancelled
  ui.modal = null;
  render();
}

function onCellClick(zone, suit, idx) {
  if (!myTurn() || mustDiscard() || ui.modal) return;
  if (zone === 'road' && suit === currentArmy(game).suit && game.armies[suit].road[idx]) {
    startMarch('road', idx);
  }
}

function onEndTurn() {
  if (!myTurn() || mustDiscard() || ui.modal) return;
  passTurn(game);
  afterEngineCall();
}

function revealTurn() {
  ui.revealedSuit = currentArmy(game).suit;
  render();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && game) cancelModal();
});

/* ── Rendering ────────────────────────────────────────────────────────── */

function render() {
  if (!game) return;
  renderBoard();
  renderHand();
  renderSidebar();
  renderLog();
  renderHandoff();
  renderActionModal();
}

function pcardHTML(card, cls, onclick) {
  const meta = SUIT_META[card.suit];
  return '<div class="pcard ' + meta.color + (cls ? ' ' + cls : '') + '"' +
    (onclick ? ' onclick="' + onclick + '"' : '') + '>' +
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
  const active = myTurn() && !mustDiscard() && !ui.modal;
  const mySuit = game ? currentArmy(game).suit : null;
  const plans = active ? myPlans() : [];
  const nSupply = active ? supplyIndices(currentArmy(game)).length : 0;
  let html = '';

  for (const suit of SUITS) {
    const a = game.armies[suit];
    const pos = BOARD_POS[suit];
    const meta = SUIT_META[suit];

    const chips = a.camp.map(s =>
      '<span class="army-chip" title="' + stackLabel(s.cards) + '">' + stackSum(s.cards) + '</span>').join('');
    const posts = (a.posts.queen ? '<span class="post" title="Banner: armies fight at +2">Q</span>' : '') +
      (a.posts.king ? '<span class="post" title="General: marches cost 1 less">K</span>' : '');
    const supplyNote = !a.isHuman && a.supply ? '<span class="supply-note" title="Banked supply">⛽' + a.supply + '</span>' : '';
    html += '<div class="cell camp suit-' + suit + '" style="grid-row:' + pos.camp[0] + ';grid-column:' + pos.camp[1] + '"' +
      ' title="' + armyName(suit) + ' camp — ' + a.camp.length + ' army(ies)">' +
      '<div class="camp-head">' + meta.symbol + posts + supplyNote + '</div>' +
      '<div class="camp-chips">' + chips + '</div></div>';

    for (let i = 0; i < ROAD_LEN; i++) {
      const [row, col] = pos.road[i];
      const stack = a.road[i];
      const classes = ['cell', 'road', 'suit-' + suit];
      if (active && stack && suit === mySuit &&
        plans.some(p => p.from.zone === 'road' && p.from.idx === i && p.cost <= nSupply)) {
        classes.push('movable');
      }
      html += '<div class="' + classes.join(' ') + '" style="grid-row:' + row + ';grid-column:' + col + '"' +
        ' onclick="onCellClick(\'road\',\'' + suit + '\',' + i + ')">' +
        (stack ? stackHTML(game, suit, stack.cards) : '') + '</div>';
    }
  }

  const g = game.garrison;
  const citClasses = ['cell', 'citadel'];
  if (g.owner) citClasses.push('owner-' + g.owner);
  html += '<div class="' + citClasses.join(' ') + '" style="grid-row:5;grid-column:5"' +
    ' title="Kartenburg — held by ' + (g.owner ? armyName(g.owner) : 'mercenaries') +
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
  const active = myTurn() && handSuit === cur.suit && !mustDiscard() && !ui.modal;
  const plans = active ? computeMarchPlans(game, handSuit) : [];
  const nSupply = supplyIndices(a).length;

  let campHtml = '<div class="camp-strip"><h3>Your camp</h3><div class="camp-armies">';
  campHtml += a.camp.map((s, i) => {
    const movable = plans.some(p => p.from.zone === 'camp' && p.from.idx === i && p.cost <= nSupply);
    return '<div class="camp-army' + (movable ? ' movable' : '') + '"' +
      (active ? ' onclick="startMarch(\'camp\',' + i + ')"' : '') + '>' +
      stackHTML(game, handSuit, s.cards) + '</div>';
  }).join('');
  if (!a.camp.length) campHtml += '<p class="hint">No armies mustered — deploy a card of your suit.</p>';
  campHtml += '</div></div>';

  let html = campHtml + '<h3>' + armyName(handSuit) + ' — your hand' +
    ' <span class="supply-count">⛽ ' + nSupply + ' supply</span></h3>' +
    '<div class="hand-cards">';
  html += a.hand.map((card, i) => {
    const own = card.suit === handSuit;
    const classes = [];
    if (active) classes.push('playable');
    if (!own) classes.push('supply');
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
  panel.innerHTML = '<p><strong>' + armyName(cur.suit) + '</strong> — ' + game.actionsLeft +
    ' action' + (game.actionsLeft === 1 ? '' : 's') + ' left.</p>' +
    '<p class="prompt">🛡️ Click a card of your suit to deploy it<br>' +
    '🥾 Click one of your armies to march it</p>' +
    '<button class="btn" onclick="onEndTurn()">Hold position (end turn)</button>';
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

/* ── The action modal ─────────────────────────────────────────────────── */

function amOption(onclick, inner, sub) {
  return '<button class="am-option" onclick="' + onclick + '">' +
    '<span class="am-main">' + inner + '</span>' +
    (sub ? '<span class="am-sub">' + sub + '</span>' : '') + '</button>';
}

function targetArg(target) {
  return JSON.stringify(target).replace(/"/g, '&quot;');
}

function battleForecast(attStr, defStr) {
  return attStr > defStr
    ? '<span class="good">victory (' + attStr + ' vs ' + defStr + ')</span>'
    : '<span class="bad">repelled (' + attStr + ' vs ' + defStr + ' — defender wins ties)</span>';
}

function renderActionModal() {
  const modal = document.getElementById('actionModal');
  const cur = currentArmy(game);
  const handoffNeeded = !game.over && cur.isHuman && humanSuits().length > 1 && ui.revealedSuit !== cur.suit;
  let title = '', body = '', cancelable = true, show = false;

  if (!handoffNeeded && mustDiscard()) {
    show = true;
    cancelable = false;
    title = '🃏 Hand over the limit';
    body = '<p>You hold more than ' + HAND_LIMIT + ' cards. Choose <strong>' + game.pendingDiscard +
      '</strong> card' + (game.pendingDiscard === 1 ? '' : 's') + ' to discard:</p><div class="am-cards">' +
      cur.hand.map((c, i) => pcardHTML(c, 'playable', 'modalDiscard(' + i + ')')).join('') + '</div>';
  } else if (!handoffNeeded && myTurn() && ui.modal) {
    const m = ui.modal;
    show = true;
    if (m.type === 'jack') {
      const card = cur.hand[m.handIdx];
      title = cardLabel(card) + ' — your raiders await orders';
      body = amOption("jackChoose('raid')", '🗡️ Raid an enemy army',
          'Strike the weakest card of any enemy army on a road, at strength ' + (11 + qBonus(cur)) + '. The Jack withdraws afterwards.') +
        amOption("jackChoose('deploy')", '🛡️ Deploy as a soldier',
          'Fights in your ranks with strength 11.');
    } else if (m.type === 'deploy') {
      const card = cur.hand[m.handIdx];
      title = 'Deploy ' + cardLabel(card) + ' (strength ' + strength(card) + ')';
      body = '<p>Recruits muster in camp — armies that have marched out are on their own.</p>' +
        amOption('modalDeploy(\'' + targetArg({ zone: 'newcamp' }) + '\')', '➕ Found a new army in camp', 'Starts a fresh 1-card army.');
      cur.camp.forEach((s, i) => {
        if (s.cards.length < STACK_CAP) {
          body += amOption('modalDeploy(\'' + targetArg({ zone: 'camp', idx: i }) + '\')',
            'Reinforce in camp: ' + stackLabel(s.cards),
            'Becomes strength ' + (stackSum(s.cards) + strength(card)) + ' of max ' + STACK_CAP + ' cards.');
        }
      });
    } else if (m.type === 'raid') {
      const attStr = 11 + qBonus(cur);
      title = '🗡️ Choose a raid target';
      body = '<p>Your raiders strike at ' + attStr + '. They hit the army\'s <strong>weakest card</strong>:</p>';
      for (const t of raidTargets()) {
        const weak = t.stack.cards[weakestOf(t.stack.cards)];
        const defStr = strength(weak) + qBonus(game.armies[t.suit]);
        body += amOption('modalRaid(\'' + t.suit + '\',' + t.idx + ')',
          armyName(t.suit) + ' on road space ' + (t.idx + 1) + ': ' + stackLabel(t.stack.cards),
          'Targets ' + cardLabel(weak) + ' → ' + battleForecast(attStr, defStr));
      }
    } else if (m.type === 'pickArmy') {
      const nSupply = supplyIndices(cur).length;
      title = '🥾 March which army?';
      body = '<p>Off-suit cards are supply: a march costs 1 per card in the stack. You have <strong>' +
        nSupply + '</strong> supply.</p>';
      for (const p of myPlans()) {
        const stack = p.from.zone === 'camp' ? cur.camp[p.from.idx] : cur.road[p.from.idx];
        const where = p.from.zone === 'camp' ? 'in camp' : 'on road space ' + (p.from.idx + 1);
        const affordable = p.cost <= nSupply;
        body += amOption(affordable ? 'pickMarchArmy(\'' + p.from.zone + '\',' + p.from.idx + ')' : '',
          stackLabel(stack.cards) + ' (' + where + ')',
          marchPlanText(p, stack) + ' — costs ' + p.cost + ' supply' + (affordable ? '' : ' <span class="bad">(not enough)</span>'));
      }
    } else if (m.type === 'march') {
      const plan = myPlans().find(p => p.from.zone === m.from.zone && p.from.idx === m.from.idx);
      if (plan) {
        const stack = m.from.zone === 'camp' ? cur.camp[m.from.idx] : cur.road[m.from.idx];
        title = '🥾 March ' + stackLabel(stack.cards);
        body = '<p>' + marchPlanText(plan, stack) + '</p>' +
          '<p>Costs <strong>' + plan.cost + '</strong> supply (you have ' +
          supplyIndices(cur).length + ').</p>' +
          '<button class="btn primary" onclick="confirmMarch()">Confirm march</button>';
      } else {
        show = false;
      }
    }
  }

  if (show && cancelable) {
    body += '<div class="am-cancel"><button class="btn" onclick="cancelModal()">Cancel</button></div>';
  }
  modal.classList.toggle('hidden', !show);
  if (show) {
    document.getElementById('amTitle').innerHTML = title;
    document.getElementById('amBody').innerHTML = body;
  }
}

function weakestOf(cards) {
  let idx = 0;
  for (let i = 1; i < cards.length; i++) {
    if (strength(cards[i]) < strength(cards[idx])) idx = i;
  }
  return idx;
}

function marchPlanText(plan, stack) {
  const cur = currentArmy(game);
  if (plan.kind === 'assault') {
    const attStr = effStrength(game, cur.suit, stack.cards);
    const defStr = effStrength(game, game.garrison.owner, game.garrison.cards);
    return '⚔️ Assault Kartenburg (garrison ' + stackLabel(game.garrison.cards) + ') → ' +
      battleForecast(attStr, defStr);
  }
  if (plan.kind === 'merge') {
    const ahead = cur.road[plan.dest.idx];
    return '🧩 Merge with ' + stackLabel(ahead.cards) + ' on road space ' + (plan.dest.idx + 1) +
      ' → combined strength ' + (stackSum(ahead.cards) + stackSum(stack.cards));
  }
  return '➡️ Advance to road space ' + (plan.dest.idx + 1);
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
