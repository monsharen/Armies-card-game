/* Armies — game page UI for the single-player campaign.
 * Renders the engine state and wires up player input. */

let state = null;

function startGame() {
  state = createGame();
  document.getElementById('endModal').classList.add('hidden');
  render();
}

/* ── Player input (each is one full turn) ─────────────────────────────── */

function canAct() {
  return state && !state.over;
}

function onBuild(typeId) {
  if (!canAct()) return;
  const result = build(state, typeId);
  if (!result.ok) { toast(result.msg); return; }
  endTurn(state);
  render();
  if (state.over) showEndModal();
}

function onActivate(row) {
  if (!canAct()) return;
  activateRow(state, row);
  endTurn(state);
  render();
  if (state.over) showEndModal();
}

/* ── Rendering ────────────────────────────────────────────────────────── */

function render() {
  renderStats();
  renderBoard();
  renderBuildMenu();
  renderSidebar();
}

function renderStats() {
  const r = state.resources;
  document.getElementById('statFood').textContent = r.food;
  document.getElementById('statOre').textContent = r.ore;
  document.getElementById('statGold').textContent = r.gold;
  document.getElementById('statPower').textContent = totalPower(state);
  document.getElementById('statGlory').textContent = state.glory;
}

function cardHTML(card, opts) {
  opts = opts || {};
  const effect = effectText(card);
  return '<div class="card row-' + card.row + (opts.classes ? ' ' + opts.classes : '') + '"' +
    (opts.onclick ? ' onclick="' + opts.onclick + '"' : '') +
    ' title="' + card.name + ' — ' + (effect || 'No effect, pure muscle') + '">' +
    '<div class="card-top"><span class="card-name">' + card.name + '</span>' +
    '<span class="power-badge">' + card.power + '</span></div>' +
    '<div class="card-icon">' + card.icon + '</div>' +
    (opts.showCost ? '<div class="card-cost">Cost: ' + costText(card.cost) + '</div>' : '') +
    '<div class="card-effect">' + (effect || '') + '</div>' +
    (opts.extra || '') +
    '</div>';
}

function renderBoard() {
  const el = document.getElementById('board');
  let html = '';
  for (const row of ROWS) {
    const info = ROW_INFO[row];
    const gains = rowGains(state, row);
    const yieldParts = [];
    for (const r of ['food', 'ore', 'gold']) {
      if (gains[r]) yieldParts.push(gains[r] + RES_ICONS[r]);
    }
    html += '<div class="play-row ' + row + '">' +
      '<div class="row-label">' + info.icon + ' ' + info.label + '</div>' +
      '<div class="row-slots">';
    for (const card of state.rows[row]) html += cardHTML(card);
    for (let i = state.rows[row].length; i < ROW_CAP; i++) html += '<div class="empty-slot">empty</div>';
    html += '</div>' +
      '<button class="btn row-action" onclick="onActivate(\'' + row + '\')"' + (state.over ? ' disabled' : '') + '>' +
      info.action + '<br><span class="yield">' + yieldParts.join(' ') + '</span></button>' +
      '</div>';
  }
  el.innerHTML = html;
}

function renderBuildMenu() {
  const el = document.getElementById('buildMenu');
  el.innerHTML = CARD_TYPES.map(type => {
    const inStock = state.stock[type.id] > 0;
    const roomInRow = state.rows[type.row].length < ROW_CAP;
    const affordable = canAfford(state.resources, type.cost);
    const buildable = inStock && roomInRow && affordable && !state.over;
    const note = !inStock ? 'Supply exhausted' : !roomInRow ? 'Row full' : '';
    const extra = '<span class="count-badge">' + (note || '×' + state.stock[type.id] + ' left') + '</span>';
    return cardHTML(type, {
      classes: buildable ? 'playable' : 'unaffordable',
      onclick: 'onBuild(\'' + type.id + '\')',
      showCost: true,
      extra,
    });
  }).join('');
}

function renderSidebar() {
  // Turn tracker
  const invasionTurns = {};
  for (const inv of state.invasions) invasionTurns[inv.turn] = inv;
  let pips = '';
  for (let i = 1; i <= MAX_TURNS; i++) {
    const cls = ['round-pip'];
    if (invasionTurns[i]) cls.push('war');
    if (i < state.turn || state.over) cls.push('done');
    if (i === state.turn && !state.over) cls.push('current');
    pips += '<span class="' + cls.join(' ') + '" title="Turn ' + i +
      (invasionTurns[i] ? ' — invasion (' + invasionTurns[i].power + ' strength)' : '') + '">' +
      (invasionTurns[i] ? '⚔' : i) + '</span>';
  }
  document.getElementById('roundTrack').innerHTML = pips;

  const banner = document.getElementById('turnBanner');
  banner.innerHTML = state.over
    ? 'The campaign is over. <a href="#" onclick="showEndModal();return false;">View results</a>'
    : 'Turn <span class="who">' + state.turn + '</span> of ' + MAX_TURNS +
      ' — build something, or activate a row.';

  // Next invasion panel
  const invEl = document.getElementById('invasionPanel');
  const next = nextInvasion(state);
  if (next) {
    const power = totalPower(state);
    const gap = next.power - power;
    const turnsAway = next.turn - state.turn;
    invEl.innerHTML =
      '<div class="invasion-strength">🏴 Enemy strength: <strong>' + next.power + '</strong></div>' +
      '<div>💪 Your power: <strong>' + power + '</strong> ' +
      (gap > 0 ? '<span class="bad">(' + gap + ' short!)</span>' : '<span class="good">(ready ✓)</span>') + '</div>' +
      '<div>🕰️ Strikes ' + (turnsAway === 0 ? '<strong class="bad">at the end of THIS turn</strong>'
        : 'after turn ' + next.turn + ' (' + turnsAway + ' turn' + (turnsAway === 1 ? '' : 's') + ' away)') + '</div>' +
      '<div>🏅 Worth ' + next.glory + ' glory if repelled — raiders pillage half your stores if not.</div>';
  } else {
    invEl.innerHTML = '<div>All invasions resolved.</div>';
  }

  // Log (newest first)
  document.getElementById('log').innerHTML = state.log.slice(-40).reverse().map(entry =>
    '<p class="log-' + entry.kind + '">' + entry.msg + '</p>').join('');
}

/* ── End of game ──────────────────────────────────────────────────────── */

function bestScore() {
  try { return parseInt(localStorage.getItem('armies-best') || '0', 10); }
  catch (e) { return 0; }
}

function saveBestScore(total) {
  try {
    if (total > bestScore()) localStorage.setItem('armies-best', String(total));
  } catch (e) { /* private browsing */ }
}

function showEndModal() {
  const score = finalScore(state);
  const rank = rankFor(score.total);
  const repelled = state.invasions.filter(i => i.won).length;
  saveBestScore(score.total);
  document.getElementById('endVerdict').innerHTML =
    rank.icon + ' You are remembered as a <strong>' + rank.title + '</strong>' +
    '<br><small>' + repelled + ' of ' + state.invasions.length + ' invasions repelled</small>';
  document.getElementById('endTable').innerHTML =
    '<tr><td>💪 Army power</td><td>' + score.power + '</td></tr>' +
    '<tr><td>🏅 War glory</td><td>' + score.glory + '</td></tr>' +
    '<tr><td>📦 Supplies (1 per 3 resources)</td><td>' + score.supplies + '</td></tr>' +
    '<tr><th>Final score</th><th>' + score.total + '</th></tr>' +
    '<tr><td>🏆 Personal best</td><td>' + bestScore() + '</td></tr>';
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
  toastTimer = setTimeout(() => el.classList.remove('show'), 2200);
}

document.addEventListener('DOMContentLoaded', startGame);
