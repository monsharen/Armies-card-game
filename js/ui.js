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
  pendingHide: {},     // suit -> drawn cards still in flight (hidden in hand)
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
  ui.bannerSuit = null;
  ui.glorySeen = null;
  ui.pendingHide = {};
  game = createGame(numHumans);
  sfx.startMusic();
  document.body.classList.add('playing');
  document.getElementById('setup').classList.add('hidden');
  document.getElementById('gameArea').classList.remove('hidden');
  document.getElementById('endModal').classList.add('hidden');
  document.getElementById('logDrawer').classList.add('hidden');
  document.getElementById('pauseMenu').classList.add('hidden');
  const events = game.events.splice(0);
  markPendingHides(events);
  cam.map = null;
  cam.turnKey = -1;
  cam.manual = false;
  render();
  measureBoard();
  initCameraInput();
  updateCamera(false);
  playFx(events);
  maybeScheduleNpc();
}

function backToSetup() {
  clearTimeout(ui.npcTimer);
  ui.npcTimer = null;
  sfx.stopMusic();
  game = null;
  document.body.classList.remove('playing');
  document.getElementById('endModal').classList.add('hidden');
  document.getElementById('pauseMenu').classList.add('hidden');
  document.getElementById('logDrawer').classList.add('hidden');
  document.getElementById('gameArea').classList.add('hidden');
  document.getElementById('setup').classList.remove('hidden');
}

function toggleLogDrawer() {
  document.getElementById('logDrawer').classList.toggle('hidden');
}

function togglePause(show) {
  const menu = document.getElementById('pauseMenu');
  menu.classList.toggle('hidden', show === false ? true : show === true ? false : undefined);
}

function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen();
  else document.documentElement.requestFullscreen().catch(() => {});
}

/* ── Board camera: pan / zoom / auto-focus ────────────────────────────
 * On screens too small to show the whole table readably, the camera follows
 * whoever is playing, punches in on battles, and zooms out on demand. Drag,
 * pinch and wheel give manual control until the next turn. */

const cam = {
  x: 0, y: 0, z: 1,
  w: 0, h: 0,           // unscaled board size
  map: null,            // board-space rects of every cell, keyed by data-cell
  manual: false,        // user drove the camera this turn
  turnKey: -1,
  punchT: null,
};
const CAM_MIN = 0.3;
const CAM_MAX = 2.4;

function camViewport() { return document.querySelector('.board-viewport'); }
function camScaler() { return document.querySelector('.board-scale'); }

function measureBoard() {
  const sc = camScaler();
  if (!sc) return;
  const t = sc.style.transform;
  sc.style.transition = 'none';
  sc.style.transform = 'none';
  const sr = sc.getBoundingClientRect();
  cam.w = sr.width;
  cam.h = sr.height;
  cam.map = {};
  sc.querySelectorAll('[data-cell], .cell.pile').forEach(el => {
    const key = el.dataset.cell || el.id;
    const r = el.getBoundingClientRect();
    cam.map[key] = { x: r.left - sr.left, y: r.top - sr.top, w: r.width, h: r.height };
  });
  sc.style.transform = t;
}

function applyCamera(animate) {
  const sc = camScaler();
  if (!sc) return;
  sc.style.transition = animate ? 'transform 0.55s cubic-bezier(0.25, 0.8, 0.35, 1)' : 'none';
  sc.style.transform = 'translate(' + cam.x.toFixed(1) + 'px,' + cam.y.toFixed(1) + 'px) scale(' + cam.z.toFixed(3) + ')';
}

function clampCam() {
  const vp = camViewport();
  if (!vp) return;
  const bw = cam.w * cam.z;
  const bh = cam.h * cam.z;
  if (bw <= vp.clientWidth) cam.x = (vp.clientWidth - bw) / 2;
  else cam.x = Math.min(48, Math.max(vp.clientWidth - bw - 48, cam.x));
  if (bh <= vp.clientHeight) cam.y = (vp.clientHeight - bh) / 2;
  else cam.y = Math.min(48, Math.max(vp.clientHeight - bh - 48, cam.y));
}

function frameRect(x, y, w, h, animate) {
  const vp = camViewport();
  if (!vp || !w || !h) return;
  cam.z = Math.min(CAM_MAX, Math.max(CAM_MIN,
    Math.min(vp.clientWidth / w, vp.clientHeight / h) * 0.93));
  cam.x = vp.clientWidth / 2 - cam.z * (x + w / 2);
  cam.y = vp.clientHeight / 2 - cam.z * (y + h / 2);
  clampCam();
  applyCamera(animate !== false);
}

function fitZ() {
  const vp = camViewport();
  if (!vp || !cam.w) return 1;
  return Math.min(vp.clientWidth / cam.w, vp.clientHeight / cam.h) * 0.97;
}

function camFitAll(animate) {
  frameRect(0, 0, cam.w, cam.h, animate);
}

function suitBBox(suit) {
  const keys = ['camp-' + suit, 'citadel'];
  for (let i = 0; i < ROAD_LEN; i++) keys.push('road-' + suit + '-' + i);
  let x1 = Infinity, y1 = Infinity, x2 = -Infinity, y2 = -Infinity;
  for (const k of keys) {
    const c = cam.map[k];
    if (!c) continue;
    x1 = Math.min(x1, c.x); y1 = Math.min(y1, c.y);
    x2 = Math.max(x2, c.x + c.w); y2 = Math.max(y2, c.y + c.h);
  }
  const pad = 30;
  return { x: x1 - pad, y: y1 - pad, w: x2 - x1 + pad * 2, h: y2 - y1 + pad * 2 };
}

function updateCamera(animate) {
  if (!game || !cam.map) return;
  if (cam.turnKey !== game.orderIdx) { cam.turnKey = game.orderIdx; cam.manual = false; }
  if (cam.manual) return;
  if (fitZ() >= 0.8) camFitAll(animate);
  else {
    const b = suitBBox(currentArmy(game).suit);
    frameRect(b.x, b.y, b.w, b.h, animate);
  }
}

/* Brief punch-in on a battle location, then back to the turn framing. */
function camPunch(key) {
  if (!cam.map || fitZ() >= 0.8) return;
  const c = cam.map[key];
  if (!c) return;
  frameRect(c.x - 110, c.y - 110, c.w + 220, c.h + 220, true);
  clearTimeout(cam.punchT);
  cam.punchT = setTimeout(() => { if (game && !game.over) updateCamera(true); }, 1800);
}

function camZoomAt(sx, sy, z2) {
  const vp = camViewport();
  if (!vp) return;
  const r = vp.getBoundingClientRect();
  z2 = Math.min(CAM_MAX, Math.max(CAM_MIN, z2));
  const px = (sx - r.left - cam.x) / cam.z;
  const py = (sy - r.top - cam.y) / cam.z;
  cam.z = z2;
  cam.x = sx - r.left - px * z2;
  cam.y = sy - r.top - py * z2;
  clampCam();
  applyCamera(false);
}

function camZoomBtn(dir) {
  const vp = camViewport();
  if (!vp) return;
  cam.manual = true;
  const r = vp.getBoundingClientRect();
  camZoomAt(r.left + r.width / 2, r.top + r.height / 2, cam.z * (dir > 0 ? 1.25 : 0.8));
}

function camFitBtn() {
  cam.manual = false;
  updateCamera(true);
}

/* Drag to pan, pinch to zoom, wheel to zoom, double-tap to toggle overview. */
function initCameraInput() {
  const vp = camViewport();
  if (!vp || vp.dataset.camReady) return;
  vp.dataset.camReady = '1';
  const pointers = new Map();
  let dragged = false;
  let pinchDist = 0;

  vp.addEventListener('pointerdown', e => {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    dragged = false;
    if (pointers.size === 2) {
      const p = Array.from(pointers.values());
      pinchDist = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
    }
  });
  vp.addEventListener('pointermove', e => {
    if (!pointers.has(e.pointerId)) return;
    const prev = pointers.get(e.pointerId);
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY });
    if (pointers.size === 1) {
      const dx = e.clientX - prev.x;
      const dy = e.clientY - prev.y;
      if (dragged || Math.abs(dx) + Math.abs(dy) > 3) {
        dragged = true;
        cam.manual = true;
        cam.x += dx;
        cam.y += dy;
        clampCam();
        applyCamera(false);
      }
    } else if (pointers.size === 2) {
      const p = Array.from(pointers.values());
      const d = Math.hypot(p[0].x - p[1].x, p[0].y - p[1].y);
      if (pinchDist > 0) {
        dragged = true;
        cam.manual = true;
        camZoomAt((p[0].x + p[1].x) / 2, (p[0].y + p[1].y) / 2, cam.z * (d / pinchDist));
      }
      pinchDist = d;
    }
  });
  const endPointer = e => {
    pointers.delete(e.pointerId);
    pinchDist = 0;
    if (dragged) {
      // swallow the click that follows a drag so cells don't get tapped
      window.addEventListener('click', ev => { ev.stopPropagation(); ev.preventDefault(); },
        { capture: true, once: true });
    }
  };
  vp.addEventListener('pointerup', endPointer);
  vp.addEventListener('pointercancel', endPointer);
  vp.addEventListener('wheel', e => {
    e.preventDefault();
    cam.manual = true;
    camZoomAt(e.clientX, e.clientY, cam.z * (e.deltaY < 0 ? 1.13 : 0.885));
  }, { passive: false });
  vp.addEventListener('dblclick', e => {
    e.preventDefault();
    cam.manual = true;
    if (cam.z > fitZ() * 1.05) camFitAll(true);
    else {
      const b = suitBBox(currentArmy(game).suit);
      frameRect(b.x, b.y, b.w, b.h, true);
    }
  });
}

window.addEventListener('resize', () => { if (game) updateCamera(false); });

function afterEngineCall() {
  const events = game.events.splice(0);
  markPendingHides(events);
  render();
  playFx(events);
  if (game.over) { setTimeout(showEndModal, Math.max(600, fxUntil - Date.now())); return; }
  maybeScheduleNpc();
}

/* Cards drawn or dealt this batch stay invisible in the hand until their
 * card-back flight from the deck lands on their slot. */
function markPendingHides(events) {
  for (const ev of events) {
    if (ev.type === 'draw' || ev.type === 'deal') {
      ui.pendingHide[ev.suit] = (ui.pendingHide[ev.suit] || 0) + ev.count;
    }
  }
}

function revealNextHandCard(suit) {
  const p = ui.pendingHide[suit] || 0;
  if (p <= 0) return;
  ui.pendingHide[suit] = p - 1;
  const idx = game.armies[suit].hand.length - p;
  const slot = document.querySelector('#handArea .hand-slot[data-slot="' + idx + '"]');
  if (slot) {
    slot.classList.remove('deal-hide');
    slot.classList.add('deal-pop');
    setTimeout(() => slot.classList.remove('deal-pop'), 450);
  }
}

/* Where the next drawn card should land: its future hand slot when that hand
 * is on screen, otherwise the player's camp corner. */
function drawDest(suit) {
  const p = ui.pendingHide[suit] || 0;
  if (p > 0) {
    const idx = game.armies[suit].hand.length - p;
    const slot = document.querySelector('#handArea .hand-slot[data-slot="' + idx + '"]');
    if (slot) return slot.getBoundingClientRect();
  }
  return rectOf(cellSel('camp', suit)) || rectOf('#handArea');
}

function maybeScheduleNpc() {
  if (!game || game.over || currentArmy(game).isHuman || ui.npcTimer) return;
  const delay = Math.max(950, fxUntil - Date.now() + 350);
  ui.npcTimer = setTimeout(() => {
    ui.npcTimer = null;
    npcFlip(game);
    afterEngineCall();
  }, delay);
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
  if (e.key !== 'Escape' || !game) return;
  if (mustDiscard()) return;
  if (ui.modal) { cancelModal(); return; }
  togglePause();
});

/* Balatro-style 3D tilt: hand cards lean toward the cursor. */
let tiltSlot = null;

function resetTilt(slot) {
  const c = slot && slot.querySelector('.pcard');
  if (!c) return;
  for (const p of ['--rx', '--ry', '--lift', '--sc']) c.style.removeProperty(p);
}

document.addEventListener('pointermove', e => {
  const slot = e.target.closest ? e.target.closest('#handArea .hand-slot') : null;
  if (tiltSlot && tiltSlot !== slot) resetTilt(tiltSlot);
  tiltSlot = slot;
  if (!slot) return;
  const c = slot.querySelector('.pcard');
  if (!c) return;
  const r = c.getBoundingClientRect();
  const rx = ((r.top + r.height / 2) - e.clientY) / r.height * 24;
  const ry = (e.clientX - (r.left + r.width / 2)) / r.width * 24;
  c.style.setProperty('--rx', rx.toFixed(1) + 'deg');
  c.style.setProperty('--ry', ry.toFixed(1) + 'deg');
  c.style.setProperty('--lift', '-12px');
  c.style.setProperty('--sc', '1.12');
});

document.addEventListener('pointerleave', () => { if (tiltSlot) { resetTilt(tiltSlot); tiltSlot = null; } });

/* ── Rendering ────────────────────────────────────────────────────────── */

function render() {
  if (!game) return;
  renderBoard();
  renderHand();
  renderSidebar();
  renderLog();
  renderHandoff();
  renderActionModal();
  renderTurnBanner();
  updateCamera(true);
}

function renderTurnBanner() {
  if (game.over) { ui.bannerSuit = null; return; }
  const cur = currentArmy(game);
  if (cur.isHuman && myTurn()) {
    if (ui.bannerSuit !== cur.suit) {
      ui.bannerSuit = cur.suit;
      showBanner(SUIT_META[cur.suit].army + ' - YOUR TURN', {
        tint: SUIT_META[cur.suit].tint, icon: SUIT_META[cur.suit].symbol, big: true,
      });
      sfx.draw();
    }
  } else if (!cur.isHuman) {
    ui.bannerSuit = null;
  }
}

/* Action announcements share the YOUR TURN style: queued so they never
 * overlap, pixel-lettered, themed per action (slash variant for damage). */
let bannerAt = 0;

function showBanner(text, opts) {
  opts = opts || {};
  const now = Date.now();
  const at = Math.max(now, bannerAt);
  bannerAt = at + (opts.big ? 1000 : 820);
  setTimeout(() => spawnBanner(text, opts), at - now);
}

function spawnBanner(text, opts) {
  const el = document.createElement('div');
  el.className = 'fx-banner ' + (opts.variant || 'sweep') + (opts.big ? ' big' : '');
  el.style.setProperty('--tint', opts.tint || '#d4a72c');
  el.innerHTML = (opts.variant === 'slash' ? '<div class="slash-line"></div>' : '') +
    '<span class="banner-inner">' +
    (opts.icon ? '<span class="b-icon">' + opts.icon + '</span>' : '') +
    pixelWordHTML(text, opts.big ? 4 : 3, '#ffffff') +
    (opts.icon ? '<span class="b-icon">' + opts.icon + '</span>' : '') +
    '</span>';
  fxRoot().appendChild(el);
  if (opts.variant === 'slash') sfx.slash();
  setTimeout(() => el.remove(), opts.big ? 1750 : 1500);
}

function suitOpts(suit, extra) {
  return Object.assign({ tint: SUIT_META[suit].tint, icon: SUIT_META[suit].symbol }, extra);
}

const COURT_EMBLEM = { J: '🗡️', Q: '🚩', K: '👑' };

/* ── Pixel mode: cards drawn on tiny canvases, upscaled nearest-neighbor ── */

const pixelMode = true; // pixel art is the game's one and only style

const spriteCache = new Map();

/* Pixel-perfect card sprites: no canvas text (it antialiases) — everything
 * is drawn from hand-made bitmaps with 1px fillRects, then displayed at an
 * exact integer upscale with image-rendering: pixelated. */

const PIX_EMBLEM = {
  K: { rows: ['10000100001', '11001110011', '11111111111', '01111111110', '01111111110'],
       colors: { 1: '#d4a72c' } },
  Q: { rows: ['211111111', '211111111', '211111110', '211111100', '200000000', '200000000', '200000000'],
       colors: { 1: '#c22b2b', 2: '#6b4a2c' } },
  J: { rows: ['0001000', '0011100', '0011100', '0011100', '0011100', '0011100', '2222222', '0002000', '0022200'],
       colors: { 1: '#8f9aa8', 2: '#6b4a2c' } },
};

function drawRank(ctx, rank, x, y, ink, rot) {
  const glyphs = rank === '10' ? ['1', '0'] : [rank];
  if (rot) glyphs.reverse();
  glyphs.forEach((g, i) => drawPix(ctx, PIX_FONT[g], x + i * 4, y, { 1: ink }, rot));
}

/* Draw a card sprite from bitmaps. size 'l' = 32x44 shown at 64x88 (2x),
 * size 's' = 16x22 shown at 32x44 (2x) or 16x22 (1x) in camp stacks. */
function cardSprite(card, size) {
  const key = (card ? card.id : 'back') + '@' + size;
  if (spriteCache.has(key)) return spriteCache.get(key);
  const large = size === 'l';
  const w = large ? 32 : 16;
  const h = large ? 44 : 22;
  const cv = document.createElement('canvas');
  cv.width = w;
  cv.height = h;
  const ctx = cv.getContext('2d');

  const frame = (fill, edge) => {
    ctx.fillStyle = edge;
    ctx.fillRect(0, 0, w, h);
    ctx.fillStyle = fill;
    ctx.fillRect(1, 1, w - 2, h - 2);
  };

  if (!card) {
    frame('#5d2020', '#2e0f0f');
    ctx.fillStyle = '#7b2f2f';
    for (let y = 1; y < h - 1; y++) {
      for (let x = 1; x < w - 1; x++) {
        if ((x + y) % 5 < 2) ctx.fillRect(x, y, 1, 1);
      }
    }
    drawPix(ctx, PIX_SUIT.diamonds, Math.floor(w / 2) - 2, Math.floor(h / 2) - 2, { 1: '#e8c76a' });
  } else {
    const meta = SUIT_META[card.suit];
    const ink = meta.color === 'red' ? '#c22b2b' : '#23252c';
    frame('#f4ecd8', '#2b2b33');
    if (large) {
      drawRank(ctx, card.rank, 3, 3, ink);
      drawPix(ctx, PIX_SUIT[card.suit], 3, 10, { 1: ink });
      drawRank(ctx, card.rank, card.rank === '10' ? w - 10 : w - 6, h - 8, ink, true);
      drawPix(ctx, PIX_SUIT[card.suit], w - 8, h - 16, { 1: ink }, true);
      const emblem = PIX_EMBLEM[card.rank];
      if (emblem) {
        drawPix(ctx, emblem.rows, Math.floor((w - emblem.rows[0].length) / 2),
          Math.floor((h - emblem.rows.length) / 2) + 1, emblem.colors);
      } else {
        // center suit at 2x, drawn as a scaled bitmap
        const rows = PIX_SUIT[card.suit];
        for (let j = 0; j < rows.length; j++) {
          for (let i = 0; i < rows[j].length; i++) {
            if (rows[j][i] === '1') {
              ctx.fillStyle = ink;
              ctx.fillRect(Math.floor(w / 2) - 5 + i * 2, Math.floor(h / 2) - 4 + j * 2, 2, 2);
            }
          }
        }
      }
    } else {
      const rw = card.rank === '10' ? 7 : 3;
      drawRank(ctx, card.rank, Math.floor((w - rw) / 2), 3, ink);
      drawPix(ctx, PIX_SUIT[card.suit], Math.floor((w - 5) / 2), 12, { 1: ink });
    }
  }
  const url = cv.toDataURL();
  spriteCache.set(key, url);
  return url;
}

function pcardHTML(card, cls, onclick) {
  const meta = SUIT_META[card.suit];
  const mini = cls && cls.indexOf('mini') !== -1;
  if (pixelMode) {
    const w = mini ? 32 : 64;
    const h = mini ? 44 : 88;
    return '<img class="pcard pix ' + meta.color + (cls ? ' ' + cls : '') + '" src="' +
      cardSprite(card, mini ? 's' : 'l') + '" width="' + w + '" height="' + h + '" alt="' + cardLabel(card) + '"' +
      (onclick ? ' onclick="' + onclick + '"' : '') + ' draggable="false">';
  }
  if (mini) {
    return '<div class="pcard ' + meta.color + (cls ? ' ' + cls : '') + '"' +
      (onclick ? ' onclick="' + onclick + '"' : '') + '>' +
      '<span class="pc-rank">' + card.rank + '</span>' +
      '<span class="pc-suit">' + meta.symbol + '</span></div>';
  }
  const emblem = COURT_EMBLEM[card.rank];
  const idx = '<b>' + card.rank + '</b><i>' + meta.symbol + '</i>';
  return '<div class="pcard fancy ' + meta.color + (cls ? ' ' + cls : '') + '"' +
    (onclick ? ' onclick="' + onclick + '"' : '') + '>' +
    '<span class="pc-idx tl">' + idx + '</span>' +
    '<span class="pc-mid">' + (emblem || meta.symbol) + '</span>' +
    '<span class="pc-idx br">' + idx + '</span></div>';
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
    html += '<div class="cell camp suit-' + suit + '" data-cell="camp-' + suit + '" style="grid-row:' + pos.camp[0] + ';grid-column:' + pos.camp[1] + '"' +
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
      html += '<div class="' + classes.join(' ') + '" data-cell="road-' + suit + '-' + i + '" style="grid-row:' + row + ';grid-column:' + col + '"' +
        ' onclick="onCellClick(\'road\',\'' + suit + '\',' + i + ')">' +
        (stack ? stackHTML(game, suit, stack.cards) : '') + '</div>';
    }
  }

  const g = game.garrison;
  const citClasses = ['cell', 'citadel'];
  if (g.owner) citClasses.push('owner-' + g.owner);
  html += '<div class="' + citClasses.join(' ') + '" data-cell="citadel" style="grid-row:5;grid-column:5"' +
    ' title="Kartenburg — held by ' + (g.owner ? armyName(g.owner) : 'mercenaries') +
    ', defends at ' + effStrength(game, g.owner, g.cards) + '. Pays ' + GLORY.tribute +
    ' glory per turn to its holder.">' +
    '<span class="crown">👑</span>' + stackHTML(game, g.owner, g.cards) + '</div>';

  // Draw deck and discard piles live on the table, top corners.
  html += '<div id="deckPile" class="cell pile" style="grid-row:1 / span 2;grid-column:1 / span 2"' +
    ' title="Draw deck — ' + game.deck.length + ' cards. Automated armies flip from here.">' +
    (game.deck.length
      ? '<div class="pile-stack">' + cardBackHTML('b3') + cardBackHTML('b2') + cardBackHTML() + '</div>'
      : '<div class="pile-empty">empty</div>') +
    '<span class="pile-count">Deck ' + game.deck.length + '</span></div>';
  const topDisc = game.discard[game.discard.length - 1];
  html += '<div id="discardPile" class="cell pile" style="grid-row:1 / span 2;grid-column:8 / span 2"' +
    ' title="Discard — ' + game.discard.length + ' cards. Reshuffled when the season turns.">' +
    (topDisc ? '<div class="pile-stack">' + pcardHTML(topDisc) + '</div>'
      : '<div class="pile-empty">discard</div>') +
    '<span class="pile-count">Discard ' + game.discard.length + '</span></div>';

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
  if (!a.camp.length) campHtml += '<p class="hint camp-hint">No armies yet</p>';
  campHtml += '</div></div>';

  let html = campHtml + '<div class="hand-block"><h3>' + armyName(handSuit) + ' — your hand' +
    ' <span class="supply-count">⛽ ' + nSupply + ' supply</span></h3>' +
    '<div class="hand-cards">';
  html += a.hand.map((card, i) => {
    const own = card.suit === handSuit;
    const classes = [];
    if (active) classes.push('playable');
    if (!own) classes.push('supply');
    const tag = own ? (card.rank === 'J' ? 'raider' : card.rank === 'Q' ? 'banner' :
      card.rank === 'K' ? 'general' : card.rank === 'A' ? 'champion' : 'soldier') : 'supply';
    const hiddenFrom = a.hand.length - (ui.pendingHide[handSuit] || 0);
    return '<div class="hand-slot' + (i >= hiddenFrom ? ' deal-hide' : '') + '" data-slot="' + i +
      '" style="--i:' + i + '"' + (active ? ' onclick="onHandClick(' + i + ')"' : '') + '>' +
      pcardHTML(card, classes.join(' ')) + '<span class="hand-tag">' + tag + '</span></div>';
  }).join('') || '<p class="hint">Empty hand.</p>';
  html += '</div></div>';
  area.innerHTML = html;
}

function renderSidebar() {
  const cur = currentArmy(game);

  // Top HUD: army chips + season/deck counters
  const prevGlory = ui.glorySeen || {};
  let chips = '';
  for (const suit of SUITS) {
    const a = game.armies[suit];
    const bumped = prevGlory[suit] !== undefined && prevGlory[suit] !== a.glory;
    chips += '<span class="hud-chip' + (suit === cur.suit && !game.over ? ' current' : '') +
      '" style="--tint:' + SUIT_META[suit].tint + '" title="' + armyName(suit) + ' — ' +
      (a.isHuman ? playerLabel(suit) : 'Automated') + '">' +
      '<b>' + SUIT_META[suit].symbol + '</b>' +
      (game.garrison.owner === suit ? '👑' : '') +
      '<span class="score-glory' + (bumped ? ' bump' : '') + '">' + a.glory + '</span>' +
      '</span>';
  }
  ui.glorySeen = {};
  for (const suit of SUITS) ui.glorySeen[suit] = game.armies[suit].glory;
  document.getElementById('hudScore').innerHTML = chips;
  document.getElementById('hudInfo').textContent =
    'S' + game.season + '/' + SEASONS + ' · deck ' + game.deck.length;

  // Contextual prompt line (lives in the bottom bar)
  const panel = document.getElementById('turnPanel');
  if (game.over) {
    panel.innerHTML = '<button class="btn primary" onclick="showEndModal()">Results</button>';
    return;
  }
  if (!cur.isHuman) {
    panel.innerHTML = '<p class="prompt">' + armyName(cur.suit) + ' is moving…</p>';
    return;
  }
  if (!myTurn()) {
    panel.innerHTML = '<p class="prompt">Waiting for ' + playerLabel(cur.suit) + '…</p>';
    return;
  }
  panel.innerHTML = '<p class="prompt"><strong>' + game.actionsLeft + '</strong> action' +
    (game.actionsLeft === 1 ? '' : 's') + ' left — tap a card to deploy, an army to march.</p>' +
    '<button class="btn" onclick="onEndTurn()">Hold position</button>';
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
      (game.armies[s].isHuman ? playerLabel(s) : 'Automated') + '</td><td class="glory-count" data-v="' +
      game.armies[s].glory + '">0</td></tr>').join('');
  document.getElementById('endModal').classList.remove('hidden');

  // Balatro-style scoring: each row counts up with ticks, winner shines last.
  const cells = document.querySelectorAll('#endTable .glory-count');
  let lastEnd = 0;
  cells.forEach((td, i) => {
    const target = +td.dataset.v;
    const begin = performance.now() + 380 + i * 300;
    lastEnd = Math.max(lastEnd, 380 + i * 300 + 700);
    let shown = 0;
    function step(now) {
      if (now < begin) return requestAnimationFrame(step);
      const p = Math.min(1, (now - begin) / 650);
      const v = Math.round(target * (1 - Math.pow(1 - p, 3)));
      if (v !== shown) {
        shown = v;
        td.textContent = v;
        td.classList.remove('bump');
        void td.offsetWidth;
        td.classList.add('bump');
        sfx.tick();
      }
      if (p < 1) requestAnimationFrame(step);
    }
    requestAnimationFrame(step);
  });
  setTimeout(() => {
    document.querySelectorAll('#endTable .winner-row').forEach(tr => tr.classList.add('winner-reveal'));
    sfx.fanfare();
  }, lastEnd + 150);
  for (let i = 0; i < 6; i++) {
    setTimeout(() => {
      const r = { left: Math.random() * window.innerWidth, top: Math.random() * window.innerHeight * 0.6, width: 0, height: 0 };
      sparks(r, GOLD_SPARKS, 16);
    }, i * 160);
  }
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

/* ── Juice: flights, flips, shakes, sparks, floats and sound ──────────── *
 * The engine emits events; playFx schedules one effect per event and keeps
 * fxUntil so NPC pacing and the end modal wait for the show to finish. */

let fxUntil = 0;

const FX_DUR = {
  draw: 420, flip: 950, deploy: 480, march: 520, assault: 700, capture: 700,
  raid: 750, tribute: 420, supply: 380, toss: 320, season: 950,
  deal: 780, garrison: 1550,
};

function playFx(events) {
  if (!events.length) return;
  let t = 0;
  const handSuits = [];
  for (const ev of events) {
    const at = t;
    setTimeout(() => { try { runFx(ev); } catch (e) { /* cosmetic only */ } }, at);
    t += FX_DUR[ev.type] || 300;
    if (ev.type === 'draw' || ev.type === 'deal') handSuits.push(ev.suit);
  }
  fxUntil = Math.max(fxUntil, Date.now() + t);
  if (handSuits.length) {
    setTimeout(() => {
      if (!game) return;
      let stuck = false;
      for (const suit of handSuits) {
        if (ui.pendingHide[suit] > 0) { ui.pendingHide[suit] = 0; stuck = true; }
      }
      if (stuck) render();
    }, t + 600);
  }
}

function fxRoot() { return document.getElementById('fx'); }

function rectOf(sel) {
  const el = document.querySelector(sel);
  return el ? el.getBoundingClientRect() : null;
}

function cellSel(zone, suit, idx) {
  if (zone === 'citadel') return '[data-cell="citadel"]';
  if (zone === 'camp') return '[data-cell="camp-' + suit + '"]';
  return '[data-cell="road-' + suit + '-' + idx + '"]';
}

function cardBackHTML(cls) {
  if (pixelMode) {
    return '<img class="pcard pix back' + (cls ? ' ' + cls : '') + '" src="' +
      cardSprite(null, 'l') + '" width="64" height="88" alt="" draggable="false">';
  }
  return '<div class="pcard back' + (cls ? ' ' + cls : '') + '"></div>';
}

function flyHTML(html, fromR, toR, ms, cls) {
  if (!fromR || !toR) return;
  const dx = (toR.left + toR.width / 2) - (fromR.left + fromR.width / 2);
  const dy = (toR.top + toR.height / 2) - (fromR.top + fromR.height / 2);
  const spawn = (delay, opacity, ghost) => {
    setTimeout(() => {
      const el = document.createElement('div');
      el.className = 'fx-fly' + (cls ? ' ' + cls : '') + (ghost ? ' fx-ghost' : '');
      el.style.left = (fromR.left + fromR.width / 2) + 'px';
      el.style.top = (fromR.top + fromR.height / 2) + 'px';
      el.style.transform = 'translate(-50%,-50%)';
      el.style.opacity = opacity;
      el.innerHTML = html;
      fxRoot().appendChild(el);
      requestAnimationFrame(() => {
        el.style.transition = 'transform ' + ms + 'ms cubic-bezier(.45,-0.25,.4,1.25)' +
          (ghost ? ', opacity ' + ms + 'ms linear' : '');
        el.style.transform = 'translate(-50%,-50%) translate(' + dx + 'px,' + dy + 'px)';
        if (ghost) el.style.opacity = '0';
      });
      setTimeout(() => el.remove(), ms + 140);
    }, delay);
  };
  spawn(0, '1', false);      // the card
  spawn(45, '0.30', true);   // trailing ghosts
  spawn(90, '0.15', true);
}

function floatText(text, r, cls) {
  if (!r) return;
  const el = document.createElement('div');
  el.className = 'fx-float' + (cls ? ' ' + cls : '');
  el.style.left = (r.left + r.width / 2) + 'px';
  el.style.top = (r.top + r.height / 2) + 'px';
  el.textContent = text;
  fxRoot().appendChild(el);
  setTimeout(() => el.remove(), 1100);
}

function shake(size) {
  const el = document.querySelector('.board-wrap');
  if (!el) return;
  const cls = 'shake-' + (size || 'md');
  el.classList.remove('shake-sm', 'shake-md', 'shake-lg');
  void el.offsetWidth; // restart animation
  el.classList.add(cls);
  setTimeout(() => el.classList.remove(cls), 650);
}

function flashAt(r) {
  if (!r) return;
  const el = document.createElement('div');
  el.className = 'fx-flash';
  el.style.left = (r.left + r.width / 2) + 'px';
  el.style.top = (r.top + r.height / 2) + 'px';
  fxRoot().appendChild(el);
  setTimeout(() => el.remove(), 450);
}

function sparks(r, colors, n) {
  if (!r) return;
  for (let i = 0; i < (n || 14); i++) {
    const el = document.createElement('div');
    el.className = 'fx-spark';
    el.style.left = (r.left + r.width / 2) + 'px';
    el.style.top = (r.top + r.height / 2) + 'px';
    el.style.background = colors[i % colors.length];
    const ang = Math.random() * Math.PI * 2;
    const dist = 30 + Math.random() * 55;
    el.style.setProperty('--dx', Math.cos(ang) * dist + 'px');
    el.style.setProperty('--dy', Math.sin(ang) * dist + 'px');
    fxRoot().appendChild(el);
    setTimeout(() => el.remove(), 700);
  }
}

function hitstop(ms) {
  document.body.classList.add('hitstop');
  setTimeout(() => document.body.classList.remove('hitstop'), ms);
}

function popSel(sel) {
  const el = document.querySelector(sel);
  if (!el) return;
  el.classList.remove('fx-pop');
  void el.offsetWidth;
  el.classList.add('fx-pop');
  setTimeout(() => el.classList.remove('fx-pop'), 400);
}

function revealFromDeck(card, destSel, holdMs, onLand) {
  let deckR = rectOf('#deckPile');
  const vp = camViewport();
  if (vp) {
    const vr = vp.getBoundingClientRect();
    if (!deckR || deckR.right < vr.left || deckR.left > vr.right ||
      deckR.bottom < vr.top || deckR.top > vr.bottom) {
      deckR = { left: vr.left + vr.width / 2 - 40, top: vr.top + 60, width: 80, height: 100 };
    }
  }
  if (!deckR) return;
  const rev = document.createElement('div');
  rev.className = 'fx-reveal';
  rev.style.left = (deckR.left + deckR.width / 2) + 'px';
  rev.style.top = (deckR.top + deckR.height / 2) + 'px';
  rev.innerHTML = '<div class="fx-flip3d"><div class="face back">' + cardBackHTML() +
    '</div><div class="face front">' + pcardHTML(card) + '</div></div>';
  fxRoot().appendChild(rev);
  popSel('#deckPile');
  sfx.flip();
  setTimeout(() => {
    flyHTML(pcardHTML(card, 'mini'), rev.getBoundingClientRect(), rectOf(destSel), 360);
    rev.remove();
    if (onLand) setTimeout(onLand, 360);
  }, holdMs || 620);
}

const GOLD_SPARKS = ['#d4a72c', '#f0cd6b', '#fff3c4'];
const BLOOD_SPARKS = ['#d06050', '#8a2f24', '#f0a08c'];

function runFx(ev) {
  const deckR = rectOf('#deckPile');
  const discR = rectOf('#discardPile');
  const handR = rectOf('#handArea .hand-cards') || rectOf('#handArea');
  switch (ev.type) {
    case 'draw': {
      showBanner('DRAWS ' + ev.count, suitOpts(ev.suit));
      for (let i = 0; i < ev.count; i++) {
        setTimeout(() => {
          flyHTML(cardBackHTML(), deckR, drawDest(ev.suit), 380);
          sfx.draw();
          setTimeout(() => revealNextHandCard(ev.suit), 370);
        }, i * 150);
      }
      break;
    }
    case 'flip': {
      const destSel = (ev.action === 'muster' || ev.action === 'post')
        ? cellSel('camp', ev.suit) : '#discardPile';
      revealFromDeck(ev.card, destSel, 620, () => {
        if (destSel !== '#discardPile') { popSel(destSel); sfx.place(); } else sfx.whoosh();
      });
      break;
    }
    case 'deal': {
      // Opening hands: card backs stream from the deck onto each hand slot
      // (or to that player's camp corner when their hand is hidden).
      for (let i = 0; i < ev.count; i++) {
        setTimeout(() => {
          flyHTML(cardBackHTML(), deckR, drawDest(ev.suit), 380);
          sfx.draw();
          setTimeout(() => revealNextHandCard(ev.suit), 370);
        }, i * 150);
      }
      break;
    }
    case 'garrison': {
      // The mercenaries take the city: flip each card off the deck onto it.
      ev.cards.forEach((card, i) => {
        setTimeout(() => {
          revealFromDeck(card, cellSel('citadel'), 520, i === ev.cards.length - 1 ? () => {
            popSel(cellSel('citadel'));
            sparks(rectOf(cellSel('citadel')), GOLD_SPARKS, 12);
            sfx.place();
          } : null);
        }, i * 700);
      });
      break;
    }
    case 'deploy': {
      if (ev.target === 'post') {
        showBanner(ev.card.rank === 'Q' ? 'THE BANNER IS RAISED' : 'THE GENERAL TAKES COMMAND',
          suitOpts(ev.suit, { icon: ev.card.rank === 'Q' ? '🚩' : '👑' }));
      } else if (ev.target === 'new') {
        showBanner('A NEW ARMY MUSTERS', suitOpts(ev.suit, { icon: '🚩' }));
      } else {
        showBanner('ARMY REINFORCED', suitOpts(ev.suit, { icon: '🛡️' }));
      }
      const destSel = cellSel('camp', ev.suit);
      if (!ev.npc) {
        flyHTML(pcardHTML(ev.card, 'mini'), handR || deckR, rectOf(destSel), 400);
        setTimeout(() => { popSel(destSel); sfx.place(); }, 380);
      }
      break;
    }
    case 'march': {
      if (ev.kind === 'merge') showBanner('ARMIES MERGE', suitOpts(ev.suit, { icon: '🧩' }));
      else if (ev.kind === 'assault') showBanner('ASSAULT ON KARTENBURG!', suitOpts(ev.suit, { icon: '⚔️' }));
      else showBanner('THE ARMY MARCHES', suitOpts(ev.suit, { icon: '🥾' }));
      const fromSel = ev.from.zone === 'camp' ? cellSel('camp', ev.suit) : cellSel('road', ev.suit, ev.from.idx);
      const destSel = ev.dest.zone === 'citadel' ? cellSel('citadel') : cellSel('road', ev.suit, ev.dest.idx);
      const html = '<div class="stack">' + ev.cards.map(c => pcardHTML(c, 'mini')).join('') + '</div>';
      flyHTML(html, rectOf(fromSel), rectOf(destSel), 460);
      sfx.whoosh();
      if (ev.dest.zone !== 'citadel') setTimeout(() => popSel(destSel), 440);
      break;
    }
    case 'assault': {
      camPunch('citadel');
      if (!ev.won) showBanner('ASSAULT REPELLED', { tint: '#d06050', variant: 'slash' });
      const r = rectOf(cellSel('citadel'));
      setTimeout(() => {
        flashAt(r);
        shake(ev.won ? 'lg' : 'md');
        sparks(r, ev.won ? GOLD_SPARKS : BLOOD_SPARKS, ev.won ? 20 : 14);
        floatText(ev.won ? '⚔️ ' + ev.attStr + ' vs ' + ev.defStr : '🛡️ ' + ev.attStr + ' vs ' + ev.defStr, r, ev.won ? 'gold big' : 'red');
        sfx.thud();
      }, 150);
      break;
    }
    case 'capture': {
      showBanner('KARTENBURG FALLS!', suitOpts(ev.suit, { icon: '👑', big: true }));
      const r = rectOf(cellSel('citadel'));
      flashAt(r);
      hitstop(95); // Vlambeer freeze-frame before the payoff
      setTimeout(() => {
        popSel(cellSel('citadel'));
        shake('lg');
        sparks(r, GOLD_SPARKS, 26);
        floatText('+' + GLORY.capture + ' 🏅 KARTENBURG FALLS!', r, 'gold big');
        sfx.fanfare();
      }, 100);
      break;
    }
    case 'raid': {
      camPunch('road-' + ev.targetSuit + '-' + ev.roadIdx);
      showBanner(ev.won ? 'RAIDERS STRIKE!' : 'RAID REPELLED', { tint: '#d06050', variant: 'slash' });
      const targetSel = cellSel('road', ev.targetSuit, ev.roadIdx);
      const tr = rectOf(targetSel);
      flyHTML(pcardHTML(ev.jack), deckR && !game.armies[ev.attacker].isHuman ? deckR : (handR || deckR), tr, 420, 'spin');
      setTimeout(() => {
        flashAt(tr);
        shake('sm');
        sparks(tr, BLOOD_SPARKS, 12);
        floatText(ev.won ? '💀 +1 🏅' : '🛡️ +1 🏅', tr, ev.won ? 'red big' : 'gold');
        sfx.thud();
      }, 430);
      break;
    }
    case 'tribute': {
      showBanner('TRIBUTE +' + GLORY.tribute, suitOpts(ev.suit, { icon: '👑' }));
      const r = rectOf(cellSel('citadel'));
      floatText('+' + GLORY.tribute + ' 🏅', r, 'gold');
      sfx.coin();
      break;
    }
    case 'supply': {
      for (let i = 0; i < ev.count; i++) {
        setTimeout(() => { flyHTML(cardBackHTML(), handR, discR, 340); }, i * 110);
      }
      sfx.whoosh();
      break;
    }
    case 'toss': {
      flyHTML(pcardHTML(ev.card, 'mini'), handR, discR, 320);
      sfx.whoosh();
      break;
    }
    case 'season': {
      const el = document.createElement('div');
      el.className = 'fx-season';
      fxRoot().appendChild(el);
      setTimeout(() => el.remove(), 950);
      showBanner('SEASON ' + ev.season + ' - THE FALLEN RETURN', { tint: '#4c7a3d', icon: '🌱', big: true });
      sfx.shuffleSound();
      break;
    }
  }
}

/* ── Tiny procedural sound kit (WebAudio, no assets) ──────────────────── */

const sfx = (() => {
  let ctx = null;
  let muted = false;
  try { muted = localStorage.getItem('kartenburg-muted') === '1'; } catch (e) { }

  function ac() {
    if (muted) return null;
    if (!ctx) {
      try { ctx = new (window.AudioContext || window.webkitAudioContext)(); } catch (e) { return null; }
    }
    if (ctx.state === 'suspended') ctx.resume();
    return ctx;
  }

  function tone(freq, dur, type, vol, when) {
    const c = ac();
    if (!c) return;
    const t0 = c.currentTime + (when || 0);
    const o = c.createOscillator();
    const g = c.createGain();
    o.type = type || 'square';
    o.frequency.value = freq;
    g.gain.setValueAtTime(vol || 0.06, t0);
    g.gain.exponentialRampToValueAtTime(0.001, t0 + dur);
    o.connect(g).connect(c.destination);
    o.start(t0);
    o.stop(t0 + dur + 0.05);
  }

  function noise(dur, vol, cutoff) {
    const c = ac();
    if (!c) return;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * (1 - i / len);
    const src = c.createBufferSource();
    src.buffer = buf;
    const f = c.createBiquadFilter();
    f.type = 'lowpass';
    f.frequency.value = cutoff || 900;
    const g = c.createGain();
    g.gain.value = vol || 0.12;
    src.connect(f).connect(g).connect(c.destination);
    src.start();
  }

  // Generative ambience: a slow minor-pentatonic music box over a soft drone.
  let musicTimer = null;
  let beat = 0;
  const SCALE = [220, 261.63, 293.66, 329.63, 392, 440];
  function musicNote() {
    if (muted) return;
    const c = ac();
    if (!c) return;
    beat++;
    if (beat % 4 === 1) tone(SCALE[0] / 2, 2.4, 'sine', 0.028);
    if (Math.random() < 0.85) {
      const n = SCALE[Math.floor(Math.random() * SCALE.length)];
      tone(n, 1.6, 'triangle', 0.022, Math.random() * 0.3);
      if (Math.random() < 0.3) tone(n * 1.5, 1.4, 'triangle', 0.014, 0.45);
    }
  }

  return {
    toggle() {
      muted = !muted;
      try { localStorage.setItem('kartenburg-muted', muted ? '1' : '0'); } catch (e) { }
      if (muted) this.stopMusic(); else if (typeof game !== 'undefined' && game) this.startMusic();
      return muted;
    },
    isMuted() { return muted; },
    startMusic() {
      if (musicTimer || muted) return;
      musicNote();
      musicTimer = setInterval(musicNote, 1150);
    },
    stopMusic() {
      if (musicTimer) { clearInterval(musicTimer); musicTimer = null; }
    },
    tick() { tone(980, 0.03, 'square', 0.028); },
    slash() { noise(0.1, 0.16, 3200); tone(1400, 0.06, 'sawtooth', 0.05); tone(500, 0.1, 'sawtooth', 0.05, 0.05); },
    draw() { tone(620, 0.07, 'triangle', 0.05); },
    flip() { tone(440, 0.05, 'triangle', 0.05); tone(660, 0.06, 'triangle', 0.04, 0.05); },
    place() { tone(200, 0.07, 'square', 0.06); tone(300, 0.06, 'square', 0.045, 0.04); },
    whoosh() { noise(0.16, 0.07, 1400); },
    thud() { noise(0.14, 0.2, 500); tone(85, 0.16, 'sine', 0.18); },
    coin() { tone(880, 0.06, 'triangle', 0.055); tone(1318, 0.1, 'triangle', 0.045, 0.06); },
    fanfare() { [523, 659, 784, 1046].forEach((f, i) => tone(f, 0.13, 'square', 0.055, i * 0.09)); },
    shuffleSound() { for (let i = 0; i < 5; i++) setTimeout(() => noise(0.05, 0.06, 2200), i * 70); },
  };
})();

function toggleSound() {
  const nowMuted = sfx.toggle();
  const btn = document.getElementById('muteBtn');
  if (btn) btn.textContent = nowMuted ? '🔇 Sound off' : '🔊 Sound on';
}

document.addEventListener('DOMContentLoaded', () => {
  const btn = document.getElementById('muteBtn');
  if (btn) btn.textContent = sfx.isMuted() ? '🔇 Sound off' : '🔊 Sound on';
  document.body.classList.add('pixel-mode');
});
