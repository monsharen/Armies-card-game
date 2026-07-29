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

function newGame(numHumans, tutorialDeck) {
  if (!tutorialDeck) TUT.active = false; // a normal game ends any tutorial
  ui.numHumans = numHumans;
  clearTimeout(ui.npcTimer);
  ui.npcTimer = null;
  ui.modal = null;
  ui.revealedSuit = null;
  ui.bannerSuit = null;
  ui.glorySeen = null;
  ui.pendingHide = {};
  ui.scars = {};
  ui.terrainSeed = (Math.random() * 1e9) | 0;
  ui.glorySrc = {};
  for (const s of SUITS) ui.glorySrc[s] = { capture: 0, tribute: 0, season: 0 };
  game = createGame(numHumans, tutorialDeck);
  sfx.startMusic();
  document.body.classList.add('playing');
  document.getElementById('setup').classList.add('hidden');
  document.getElementById('gameArea').classList.remove('hidden');
  document.getElementById('endModal').classList.add('hidden');
  document.getElementById('logDrawer').classList.add('hidden');
  document.getElementById('pauseMenu').classList.add('hidden');
  document.getElementById('howto').classList.add('hidden');
  const events = game.events.splice(0);
  markPendingHides(events);
  tallyGlory(events);
  render();
  playFx(events);
  maybeScheduleNpc();
}

function backToSetup() {
  clearTimeout(ui.npcTimer);
  ui.npcTimer = null;
  game = null;
  TUT.active = false;
  document.getElementById('tutorBox').classList.add('hidden');
  showMainMenu();
  document.body.classList.remove('playing');
  document.getElementById('endModal').classList.add('hidden');
  document.getElementById('pauseMenu').classList.add('hidden');
  document.getElementById('logDrawer').classList.add('hidden');
  document.getElementById('gameArea').classList.add('hidden');
  document.getElementById('setup').classList.remove('hidden');
}

/* ── Scenes: title → menu → game; How to Play overlays either ─────────── */

function enterMenu() {
  const title = document.getElementById('titleScreen');
  if (!title || title.classList.contains('hidden') || title.dataset.entering) return;
  title.dataset.entering = '1';
  sfx.coin();
  title.classList.add('hidden');
  document.body.classList.remove('on-title');
  document.getElementById('setup').classList.remove('hidden');
  sfx.startMusic();
  sfx.draw();
}

/* Retro title dressing: twinkling pixel stars and drifting card backs.
 * Used by both the title screen and the main menu, which share the look. */
function buildTitleFx(holderId) {
  const holder = document.getElementById(holderId || 'titleFx');
  if (!holder) return;
  let html = '';
  for (let i = 0; i < 46; i++) {
    const size = 1 + Math.floor(Math.random() * 3);
    html += '<span class="title-star" style="left:' + (Math.random() * 100).toFixed(1) +
      '%;top:' + (Math.random() * 100).toFixed(1) + '%;width:' + size + 'px;height:' + size +
      'px;animation-delay:' + (Math.random() * 4).toFixed(2) + 's;animation-duration:' +
      (2.2 + Math.random() * 3).toFixed(2) + 's"></span>';
  }
  for (let i = 0; i < 7; i++) {
    html += '<span class="title-card" style="left:' + (4 + Math.random() * 92).toFixed(1) +
      '%;animation-delay:' + (-Math.random() * 26).toFixed(2) + 's;animation-duration:' +
      (17 + Math.random() * 14).toFixed(2) + 's;--drift:' + (Math.random() * 60 - 30).toFixed(0) +
      'px;--spin:' + (Math.random() * 50 - 25).toFixed(0) + 'deg">' + cardBackHTML() + '</span>';
  }
  holder.innerHTML = html;
}

/* ── Main menu navigation ─────────────────────────────────────────────── */

function showPlayerSelect() {
  document.getElementById('menuMain').classList.add('hidden');
  document.getElementById('menuPlayers').classList.remove('hidden');
  sfx.flip();
}

function showMainMenu() {
  const main = document.getElementById('menuMain');
  if (main) {
    main.classList.remove('hidden');
    document.getElementById('menuPlayers').classList.add('hidden');
  }
}

/* ── Tutorial: a scripted opening as Hearts with a step-by-step coach ── *
 * The deck is stacked so the first three rounds are deterministic enough
 * to teach deploy → reinforce → march → assault, then the coach hands the
 * war over to the player. Steps advance on a Next click (informational)
 * or when a condition on the game state comes true (action steps). */

const TUT = { active: false, step: 0 };

function tutorialDeck() {
  const deck = makeDeck();
  const take = (rank, suit) => {
    const i = deck.findIndex(c => c.rank === rank && c.suit === suit);
    return deck.splice(i, 1)[0];
  };
  // Draw order: your hand (4), the garrison (2), then round by round.
  const script = [
    ['9', 'hearts'], ['7', 'hearts'], ['8', 'clubs'], ['6', 'diamonds'],  // hand
    ['2', 'spades'], ['3', 'clubs'],                                      // garrison (str 5)
    ['5', 'diamonds'], ['4', 'spades'],                                   // your turn-1 draw
    ['5', 'spades'], ['6', 'spades'],                                     // spades round 1
    ['4', 'diamonds'], ['7', 'diamonds'],                                 // diamonds round 1
    ['5', 'clubs'], ['7', 'clubs'],                                       // clover round 1
    ['9', 'diamonds'], ['10', 'spades'],                                  // your turn-2 draw
    ['8', 'spades'], ['2', 'diamonds'],                                   // spades round 2
    ['8', 'diamonds'], ['2', 'clubs'],                                    // diamonds round 2
    ['9', 'clubs'], ['3', 'diamonds'],                                    // clover round 2
    ['10', 'diamonds'], ['3', 'spades'],                                  // your turn-3 draw
  ].map(([r, s]) => take(r, s));
  for (let i = deck.length - 1; i > 0; i--) {  // shuffle the remainder
    const j = Math.floor(Math.random() * (i + 1));
    [deck[i], deck[j]] = [deck[j], deck[i]];
  }
  return deck.concat(script.reverse()); // pop() draws from the end
}

function tutHandSlot(rank) {
  if (!game) return null;
  const i = game.armies.hearts.hand.findIndex(c => c.suit === 'hearts' && c.rank === rank);
  return i === -1 ? null : '#handArea .hand-slot[data-slot="' + i + '"]';
}

const TUTORIAL_STEPS = [
  { text: 'Welcome, commander of <b>Hearts ♥</b>! Kartenburg is won with <b>glory</b>: ' +
      'most glory after two seasons of the deck takes the war. The richest prize sits at ' +
      'the center of the board — the city itself.', hl: () => '[data-cell="citadel"]' },
  { text: '<b>Kartenburg</b> is held by a mercenary garrison (strength 5 today). ' +
      'Your lane runs <b>upward</b> — from your camp at the bottom to the gate just below the city. <b>Capture the city: +5 glory.</b> ' +
      'Hold it: +1 every turn, +2 when a season turns.', hl: () => '[data-cell="camp-hearts"]' },
  { text: 'Your hand: <b>♥ cards fight for you</b>. Cards of other suits are <b>supply</b> — ' +
      'fuel for marching, not soldiers. You draw 2 at the start of each turn and take up to ' +
      '<b>2 actions</b>.', hl: () => '#handArea' },
  { text: '<b>Action 1 — Deploy.</b> Tap your <b>9♥</b> and <em>found a new army</em> in camp.',
    hl: () => tutHandSlot('9'),
    when: g => g.armies.hearts.camp.reduce((n, s) => n + s.cards.length, 0) >= 1 },
  { text: '<b>Action 2 — Reinforce.</b> Armies are <b>stacks</b> of up to 3 cards; their strength ' +
      'is the sum. Tap your <b>7♥</b> and add it to your army (or found a second one — your call).',
    hl: () => tutHandSlot('7'),
    when: g => g.armies.hearts.camp.reduce((n, s) => n + s.cards.length, 0) +
      g.armies.hearts.road.filter(Boolean).length >= 2 },
  { text: 'Both actions spent — the <b>automated armies</b> now move. They flip 2 cards each turn: ' +
      'their own suit joins their camp, anything else piles up as supply, and the moment the pile ' +
      'covers their front army\'s march cost, <b>it marches</b>. Watch them go.' },
  { text: '<b>March!</b> Tap your army, then confirm. A march costs <b>1 supply per card in the ' +
      'stack</b> — your off-suit cards are spent automatically. Each march climbs one slot; ' +
      'reach the <b>GATE</b> at the top of your lane. It will take a couple of turns.',
    hl: () => '[data-cell="road-hearts-2"]',
    when: g => !!g.armies.hearts.road[2] || g.garrison.owner === 'hearts' },
  { text: 'You stand at the gate! <b>Assault:</b> march once more to storm the city. Stack total vs ' +
      'garrison total — <b>defender wins ties</b>, and the winner loses its weakest card as ' +
      'casualties. Your army is stronger. Strike!',
    hl: () => '[data-cell="citadel"]',
    when: g => g.garrison.owner === 'hearts' },
  { text: '<b>KARTENBURG IS YOURS!</b> +5 glory, and the city pays <b>+1 tribute</b> at the start ' +
      'of each of your turns — +2 more if you hold it when the season turns. But the garrison ' +
      'cannot be reinforced: it stands alone until it falls.' },
  { text: 'Beware the <b>Jacks</b>: raiders that snipe the weakest card of a road army, or ' +
      'infiltrate a camp to strike a <b>Banner (Q)</b> or <b>General (K)</b>. When <em>you</em> are ' +
      'attacked, you may commit one ♥ card from hand as a <b>reserve</b> — its strength joins the ' +
      'defense, then the card is lost.' },
  { text: 'Two more tools: your <b>Queen</b> posts in camp for +2 to all your battles, your ' +
      '<b>King</b> makes marches cost 1 less. Drowning in supply? <b>🤝 Trade</b> swaps 2 supply ' +
      'for a fresh card. When the deck empties, the round finishes, the season turns and the ' +
      'fallen reshuffle.' },
  { text: 'The war is yours now, commander. Rivals will besiege your walls — raid them, rebuild, ' +
      'and hold the crown. <b>Most glory after season 2 wins.</b> Good luck!', last: true },
];

function startTutorial() {
  TUT.active = true;
  TUT.step = 0;
  newGame(1, tutorialDeck());
}

function tutNext() {
  if (!TUT.active) return;
  const step = TUTORIAL_STEPS[TUT.step];
  if (step && step.last) { tutSkip(); return; }
  TUT.step++;
  sfx.flip();
  render();
}

function tutSkip() {
  TUT.active = false;
  document.getElementById('tutorBox').classList.add('hidden');
  document.querySelectorAll('.tut-hl').forEach(el => el.classList.remove('tut-hl'));
  render();
}

function renderTutorial() {
  const box = document.getElementById('tutorBox');
  if (!TUT.active || !game || game.over) {
    box.classList.add('hidden');
    return;
  }
  // Advance through any action steps whose condition is already met.
  while (TUT.step < TUTORIAL_STEPS.length) {
    const s = TUTORIAL_STEPS[TUT.step];
    if (s.when && s.when(game)) { TUT.step++; sfx.coin(); continue; }
    break;
  }
  if (TUT.step >= TUTORIAL_STEPS.length) { tutSkip(); return; }
  const step = TUTORIAL_STEPS[TUT.step];
  box.classList.remove('hidden');
  document.getElementById('tutText').innerHTML = step.text;
  const nextBtn = document.getElementById('tutNextBtn');
  nextBtn.style.display = step.when ? 'none' : '';
  nextBtn.textContent = step.last ? 'Finish ✔' : 'Next ▶';
  document.querySelectorAll('.tut-hl').forEach(el => el.classList.remove('tut-hl'));
  const sel = step.hl && step.hl();
  if (sel) document.querySelectorAll(sel).forEach(el => el.classList.add('tut-hl'));
}

const HOWTO_PAGES = [
  {
    title: 'The Goal',
    build: () => '<div class="ht-row ht-center">' +
      '<div class="ht-citadel"><span class="crown">👑</span>' +
      pcardHTML({ suit: 'spades', rank: '9', id: '9-spades' }, 'mini') +
      pcardHTML({ suit: 'diamonds', rank: '6', id: '6-diamonds' }, 'mini') + '</div></div>' +
      '<p>Kartenburg is held by mercenaries. Four armies climb their lanes toward it — camp at the bottom, gate at the top.</p>' +
      '<p><b>Capture the city: +5 glory.</b> Hold it at the start of your turn: <b>+1 tribute</b>. ' +
      'Hold it when a season turns: <b>+2</b>. Win raids and defenses: +1. ' +
      'Most glory after two seasons of the deck wins the war.</p>' +
      '<p>Later seats start stronger: extra cards (players) or banked supply (automated armies).</p>',
  },
  {
    title: 'Your Cards',
    build: () => '<div class="ht-row">' +
      ['7', 'A', 'J', 'Q', 'K'].map(r =>
        '<div class="ht-card">' + pcardHTML({ suit: 'hearts', rank: r, id: r + '-hearts' }) +
        '<span>' + ({ 7: 'Soldier', A: 'Champion 11', J: 'Raider 11', Q: 'Banner +2', K: 'General' }[r]) + '</span></div>'
      ).join('') + '</div>' +
      '<p>Cards of <b>your suit</b> fight. The Queen posts in camp: all your armies +2. ' +
      'The King makes marches cost 1 less.</p>' +
      '<div class="ht-row"><div class="ht-card">' + pcardHTML({ suit: 'clubs', rank: '8', id: '8-clubs' }) +
      '<span>Supply</span></div><p class="ht-side">Cards of <b>other suits</b> are supply — ' +
      'each march costs 1 supply per card in the marching stack. Heavy armies are slow. ' +
      'Too much supply? <b>Trade</b>: swap 2 supply for a fresh card.</p></div>',
  },
  {
    title: 'Your Turn',
    build: () => '<p>Draw 2 cards (hand limit 7), then take up to <b>2 actions</b>:</p>' +
      '<div class="ht-actions">' +
      '<div><b>🚩 Deploy</b><br>Muster a new army in camp, or reinforce a camp army — ' +
      'stacks of up to <b>3 cards</b>, strength is their sum. Once an army marches out, its roster is fixed.</div>' +
      '<div><b>🥾 March</b><br>Climb one slot up your lane, paying supply. March onto your own army to <b>merge</b>; ' +
      'march from the <b>gate</b> to assault Kartenburg.</div>' +
      '<div><b>🗡️ Raid</b><br>Your Jack strikes the <b>weakest card</b> of any enemy army on a road — ' +
      'or infiltrates an enemy camp to strike its <b>Banner or General</b> — then withdraws.</div>' +
      '<div><b>🤝 Trade</b><br>Swap 2 supply for 1 fresh card.</div>' +
      '</div>',
  },
  {
    title: 'Battle',
    build: () => '<p class="ht-vs">' +
      pcardHTML({ suit: 'hearts', rank: '10', id: '10-hearts' }, 'mini') +
      pcardHTML({ suit: 'hearts', rank: '8', id: '8-hearts' }, 'mini') +
      '<span class="ht-vs-label">18 vs 15</span>' +
      pcardHTML({ suit: 'spades', rank: '9', id: '9-spades' }, 'mini') +
      pcardHTML({ suit: 'spades', rank: '6', id: '6-spades' }, 'mini') + '</p>' +
      '<p>One comparison: <b>stack total vs stack total</b> (+2 with your Queen). ' +
      '<b>The defender wins ties.</b> The loser is destroyed — and the <b>winner loses its ' +
      'weakest card</b> as casualties.</p>' +
      '<p><b>Reserves:</b> when you are attacked, you may commit one card of your suit from hand — ' +
      'its strength joins the defense, then the card is lost.</p>' +
      '<p>Garrisons erode and <b>cannot be reinforced</b>: waves of cheap attackers bring down any ' +
      'fortress — a repelled assault that still bloodies the garrison earns the <b>attacker</b> +1 ' +
      'siege glory. Every crown falls, eventually.</p>',
  },
  {
    title: 'Rival Armies',
    build: () => '<div class="ht-row ht-center">' + cardBackHTML() + '</div>' +
      '<p>Armies without a player flip <b>2 cards</b> off the deck each turn: their own suit ' +
      'joins their camp (Jacks raid!), anything else piles up as supply — and the moment the pile ' +
      'covers the front army\'s march cost, <b>it marches</b>.</p>' +
      '<p>When the deck runs out, the season turns: the fallen shuffle back in, and after the ' +
      'second season the war ends. <b>Most glory wins.</b></p>',
  },
];

function openHowto(fromGame) {
  ui.howtoReturn = fromGame ? 'game' : 'menu';
  ui.howtoPage = 0;
  document.getElementById('pauseMenu').classList.add('hidden');
  document.getElementById('howto').classList.remove('hidden');
  renderHowto();
}

function renderHowto() {
  const page = HOWTO_PAGES[ui.howtoPage];
  document.getElementById('howtoTitle').innerHTML =
    '<span class="pixel-title" data-scale="3">' + page.title + '</span>';
  document.getElementById('howtoTitle').querySelector('.pixel-title').removeAttribute('data-pixelized');
  document.getElementById('howtoBody').innerHTML = page.build();
  document.getElementById('howtoDots').innerHTML = HOWTO_PAGES.map((p, i) =>
    '<span class="ht-dot' + (i === ui.howtoPage ? ' on' : '') + '"></span>').join('');
  document.getElementById('howtoPrev').disabled = ui.howtoPage === 0;
  document.getElementById('howtoNext').disabled = ui.howtoPage === HOWTO_PAGES.length - 1;
  applyPixelTitles(document.getElementById('howto'));
}

function howtoStep(dir) {
  ui.howtoPage = Math.max(0, Math.min(HOWTO_PAGES.length - 1, ui.howtoPage + dir));
  sfx.flip();
  renderHowto();
}

function closeHowto() {
  document.getElementById('howto').classList.add('hidden');
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

/* The lane view is the one and only board — no camera, no pan/zoom.
 * (Kept: the viewport lookup used by deck-flip FX fallbacks.) */
function camViewport() { return document.querySelector('.board-viewport'); }

function afterEngineCall() {
  const events = game.events.splice(0);
  markPendingHides(events);
  tallyGlory(events);
  render();
  playFx(events);
  if (game.over) { setTimeout(showEndModal, Math.max(600, fxUntil - Date.now())); return; }
  maybeScheduleNpc();
}

/* Running per-army glory-source tally (for the end-of-war breakdown —
 * battle glory is derived as the remainder). */
function tallyGlory(events) {
  if (!ui.glorySrc) return;
  for (const ev of events) {
    const t = ui.glorySrc[ev.suit];
    if (!t) continue;
    if (ev.type === 'capture') t.capture += GLORY.capture;
    else if (ev.type === 'tribute') t.tribute += GLORY.tribute;
    else if (ev.type === 'seasonHold') t.season += GLORY.season;
  }
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
  if (!game || game.over || game.pendingBattle || currentArmy(game).isHuman || ui.npcTimer) return;
  const delay = Math.max(950, fxUntil - Date.now() + 350);
  ui.npcTimer = setTimeout(() => {
    ui.npcTimer = null;
    npcFlip(game);
    afterEngineCall();
  }, delay);
}

/* ── Input ────────────────────────────────────────────────────────────── */

function myTurn() {
  return game && !game.over && !game.pendingBattle && currentArmy(game).isHuman &&
    (humanSuits().length <= 1 || ui.revealedSuit === currentArmy(game).suit);
}

/* Who the device should be in front of: the pending battle's defender wins
 * over the current player (a defense interrupts anyone's turn). */
function handoffTarget() {
  if (game.pendingBattle && game.armies[game.pendingBattle.defender].isHuman) {
    return game.pendingBattle.defender;
  }
  const cur = currentArmy(game);
  return cur.isHuman ? cur.suit : null;
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

/* Enemy camp posts (Banners and Generals) the Jack can strike. */
function postTargets() {
  const suit = currentArmy(game).suit;
  const targets = [];
  for (const enemy of SUITS) {
    if (enemy === suit) continue;
    if (game.armies[enemy].posts.queen) targets.push({ suit: enemy, post: 'queen' });
    if (game.armies[enemy].posts.king) targets.push({ suit: enemy, post: 'king' });
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
  if (card.rank === 'J' && (raidTargets().length || postTargets().length)) {
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

function modalRaidPost(suit, post) {
  if (!myTurn() || !ui.modal || ui.modal.type !== 'raid') return;
  const res = raidPost(game, ui.modal.handIdx, suit, post);
  ui.modal = null;
  if (!res.ok) toast(res.msg);
  afterEngineCall();
}

function onTrade() {
  if (!myTurn() || mustDiscard() || ui.modal) return;
  const res = trade(game);
  if (!res.ok) { toast(res.msg); return; }
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
  if (game && game.pendingBattle) return; // neither can a defense
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
  ui.revealedSuit = handoffTarget() || currentArmy(game).suit;
  render();
}

document.addEventListener('keydown', e => {
  if (e.key === 'Escape' && !document.getElementById('howto').classList.contains('hidden')) {
    closeHowto();
    return;
  }
  if (e.key !== 'Escape' || !game) return;
  if (mustDiscard() || game.pendingBattle) return;
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
  renderTutorial();
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

/* ── Lane view: the portrait board. Same state, no geometry — Kartenburg
 * as a status strip, rivals as compact rows, your lane as the big track.
 * Cells keep their data-cell anchors so every FX flight still lands. */

/* A held hand, seen from across the table: slightly fanned card backs
 * plus the count. Automated armies hold no hand, so they get nothing. */
function handFanHTML(n) {
  if (!n) return '';
  const shown = Math.min(n, 7);
  let cards = '';
  for (let i = 0; i < shown; i++) {
    const rot = ((i - (shown - 1) / 2) * 9).toFixed(0);
    cards += '<img class="fan-card" src="' + cardSprite(null, 's') +
      '" width="16" height="22" style="--r:' + rot + 'deg" alt="" draggable="false">';
  }
  return '<span class="hand-fan" title="' + n + ' card' + (n === 1 ? '' : 's') + ' in hand">' +
    cards + '<b>' + n + '</b></span>';
}

/* ── The battleground: terrain dressing and battle scars ──────────────
 * Lanes are dressed with grass tufts and rocks (seeded per game, stable
 * across renders), and battles leave permanent debris — blood pools,
 * swords and spears stuck in the ground, fallen helmets — at the exact
 * cells where they happened. The field remembers the war. */

const DECOR = {
  grass: { rows: ['0010010', '0101101', '1101011'], colors: { 1: '#41663a' } },
  grass2: { rows: ['010010', '101101'], colors: { 1: '#38572f' } },
  rock: { rows: ['0110', '1111', '1111'], colors: { 1: '#565d68' } },
  pebble: { rows: ['11', '11'], colors: { 1: '#474d57' } },
  blood: { rows: ['0011000', '0111110', '1111111', '0111100'], colors: { 1: '#5e1212' } },
  sword: { rows: ['020', '030', '111', '020', '020', '020'],
    colors: { 1: '#d4a72c', 2: '#b7c0cc', 3: '#6b4a2c' } },
  spear: { rows: ['1', '2', '2', '2', '2', '2', '2'], colors: { 1: '#b7c0cc', 2: '#6b4a2c' } },
  helmet: { rows: ['01110', '11111', '12121'], colors: { 1: '#7a828e', 2: '#23252c' } },
  tent: { rows: ['0001000', '0011100', '0111110', '1112111'],
    colors: { 1: '#8a7550', 2: '#2a2118' } },
  fire: { rows: ['00200', '02320', '23332', '11111'],
    colors: { 1: '#6b4a2c', 2: '#e8842c', 3: '#f0cd6b' } },
  gatetorch: { rows: ['030', '232', '111', '111', '111'],
    colors: { 1: '#565b64', 2: '#e8842c', 3: '#f0cd6b' } },
};

/* A fixed piece of set dressing (campsite, gate posts) at a CSS position. */
function spriteImg(name, cls, scale) {
  const d = DECOR[name];
  return '<img class="site ' + cls + '" src="' + decorSprite(name) + '" width="' +
    d.rows[0].length * scale + '" height="' + d.rows.length * scale +
    '" alt="" draggable="false">';
}
const decorCache = new Map();

function decorSprite(name) {
  if (decorCache.has(name)) return decorCache.get(name);
  const d = DECOR[name];
  const cv = document.createElement('canvas');
  cv.width = d.rows[0].length;
  cv.height = d.rows.length;
  drawPix(cv.getContext('2d'), d.rows, 0, 0, d.colors);
  const url = cv.toDataURL();
  decorCache.set(name, url);
  return url;
}

function decorImg(name, x, y, rot, cls) {
  const d = DECOR[name];
  return '<img class="' + cls + '" src="' + decorSprite(name) + '" width="' + d.rows[0].length * 2 +
    '" height="' + d.rows.length * 2 + '" style="left:' + x.toFixed(1) + '%;top:' + y.toFixed(1) +
    '%;--rot:' + (rot || 0) + 'deg" alt="" draggable="false">';
}

function hashStr(str) {
  let h = 0;
  for (let i = 0; i < str.length; i++) h = (h * 31 + str.charCodeAt(i)) | 0;
  return h;
}

function mulberry32(a) {
  return function () {
    a |= 0;
    a = a + 0x6D2B79F5 | 0;
    let t = Math.imul(a ^ a >>> 15, 1 | a);
    t = t + Math.imul(t ^ t >>> 7, 61 | t) ^ t;
    return ((t ^ t >>> 14) >>> 0) / 4294967296;
  };
}

/* The sandy road itself: a low-res pixel sprite, drawn with a wandering
 * random-walk centerline and ragged dithered edges — never straight,
 * never antialiased — seeded per lane so each war's roads are its own. */
const roadCache = new Map();

function lanePathSprite(suit) {
  const key = suit + ':' + (ui.terrainSeed || 1);
  if (roadCache.has(key)) return roadCache.get(key);
  const W = 36, H = 140;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const rnd = mulberry32((ui.terrainSeed || 1) + hashStr('path-' + suit));
  let cx = W / 2, w = 10;
  for (let y = 0; y < H; y++) {
    cx += Math.round(rnd() * 2 - 1);
    if (rnd() < 0.25) w += Math.round(rnd() * 2 - 1);
    w = Math.max(9, Math.min(12, w));
    cx = Math.max(w + 3, Math.min(W - w - 3, cx));
    const x1 = Math.round(cx - w), x2 = Math.round(cx + w);
    ctx.fillStyle = '#3a2e1c';                 // ragged edge pixels
    ctx.fillRect(x1, y, 1, 1);
    ctx.fillRect(x2, y, 1, 1);
    ctx.fillStyle = '#55452a';                 // the sand
    ctx.fillRect(x1 + 1, y, x2 - x1 - 1, 1);
    for (let i = 0; i < 3; i++) {              // dither speckles
      if (rnd() < 0.5) {
        ctx.fillStyle = rnd() < 0.5 ? '#6a5735' : '#463a22';
        ctx.fillRect(x1 + 2 + Math.floor(rnd() * (x2 - x1 - 3)), y, 1, 1);
      }
    }
  }
  const url = cv.toDataURL();
  roadCache.set(key, url);
  return url;
}

/* Kartenburg itself: a pixel stone wall with battlements and a gate,
 * stretched across the top of the field. Same rules as the roads —
 * hard pixels only, seeded noise, cached per game. */
function cityWallSprite() {
  const key = 'city:' + (ui.terrainSeed || 1);
  if (roadCache.has(key)) return roadCache.get(key);
  const W = 96, H = 26;
  const cv = document.createElement('canvas');
  cv.width = W;
  cv.height = H;
  const ctx = cv.getContext('2d');
  const rnd = mulberry32((ui.terrainSeed || 1) + hashStr('city'));
  // Wall body: stone bricks with mortar lines and offset joints.
  for (let y = 5; y < H; y++) {
    for (let x = 0; x < W; x++) {
      let c = '#565b64';
      if (y >= H - 2) c = '#383c43';
      else if (y % 5 === 0) c = '#3f434b';
      else if (((x + (Math.floor(y / 5) % 2 ? 3 : 0)) % 7) === 0) c = '#3f434b';
      else if (rnd() < 0.07) c = '#646a75';
      else if (rnd() < 0.05) c = '#4b5058';
      ctx.fillStyle = c;
      ctx.fillRect(x, y, 1, 1);
    }
  }
  // Battlements: merlons with open sky between them.
  for (let x = 0; x < W; x++) {
    if (Math.floor(x / 5) % 2 === 0) {
      for (let y = 0; y < 5; y++) {
        ctx.fillStyle = y === 0 ? '#646a75' : '#565b64';
        ctx.fillRect(x, y, 1, 1);
      }
    }
  }
  // The main gate, where the roads arrive.
  const cx = W / 2;
  for (let y = 12; y < H; y++) {
    const half = y < 14 ? 3 : y < 16 ? 5 : 6;
    ctx.fillStyle = '#161116';
    ctx.fillRect(cx - half, y, half * 2, 1);
  }
  ctx.fillStyle = '#6b4a2c'; // timber lintel
  ctx.fillRect(cx - 6, 11, 12, 1);
  const url = cv.toDataURL();
  roadCache.set(key, url);
  return url;
}

/* Stable per-cell terrain plus whatever scars the war has left there.
 * Grass and rocks hug the slot's edges, framing the path down the middle
 * where the armies (and the debris they leave) belong. */
function cellDecorHTML(key) {
  let html = '';
  const rnd = mulberry32((ui.terrainSeed || 1) + hashStr(key));
  const n = 3 + Math.floor(rnd() * 2);
  const kinds = ['grass', 'grass2', 'rock', 'grass', 'pebble'];
  for (let i = 0; i < n; i++) {
    const left = rnd() < 0.5;
    const x = left ? 2 + rnd() * 12 : 84 + rnd() * 12;
    html += decorImg(kinds[Math.floor(rnd() * kinds.length)],
      x, 6 + rnd() * 78, 0, 'decor');
  }
  for (const s of (ui.scars && ui.scars[key]) || []) {
    html += decorImg(s.t, s.x, s.y, s.rot, 'scar');
  }
  return html;
}

/* A battle just happened here: drop debris, store it, and pop it in live. */
function battleScar(key, types) {
  if (!ui.scars) return;
  for (const t of types) {
    const s = {
      t,
      x: 8 + Math.random() * 70,
      y: 15 + Math.random() * 56,
      rot: (t === 'sword' || t === 'spear') ? Math.random() * 44 - 22 : 0,
    };
    ui.scars[key] = ui.scars[key] || [];
    ui.scars[key].push(s);
    while (ui.scars[key].length > 6) ui.scars[key].shift();
    const cell = document.querySelector('[data-cell="' + key + '"]');
    if (cell) cell.insertAdjacentHTML('beforeend', decorImg(s.t, s.x, s.y, s.rot, 'scar scar-new'));
  }
}

/* An automated army's banked supply: a staggered pile of card backs plus
 * the count — the pile its next march will be paid from. */
function supplyPileHTML(n) {
  if (!n) return '';
  const shown = Math.min(n, 4);
  let cards = '';
  for (let i = 0; i < shown; i++) {
    cards += '<img class="pile-card" src="' + cardSprite(null, 's') +
      '" width="16" height="22" style="--i:' + i + '" alt="" draggable="false">';
  }
  return '<span class="supply-pile" title="Banked supply: ' + n +
    ' — their front army marches once this covers its cost">' + cards + '<b>' + n + '</b></span>';
}

function viewerSuit() {
  const cur = currentArmy(game);
  if (cur.isHuman && (humanSuits().length <= 1 || ui.revealedSuit === cur.suit)) return cur.suit;
  if (humanSuits().length) return humanSuits()[0];
  return cur.suit;
}

function renderLaneBoard() {
  const g = game.garrison;
  const you = viewerSuit();
  const active = myTurn() && !mustDiscard() && !ui.modal && currentArmy(game).suit === you;
  const plans = active ? computeMarchPlans(game, you) : [];
  const nSupply = active ? supplyIndices(game.armies[you]).length : 0;
  const can = (zone, idx) => plans.some(p => p.from.zone === zone && p.from.idx === idx && p.cost <= nSupply);

  let html = '<div class="lane-city" data-cell="citadel"' +
    (g.owner ? ' style="--tint:' + SUIT_META[g.owner].tint + '"' : '') +
    ' title="Kartenburg — defends at ' + effStrength(game, g.owner, g.cards) + '">' +
    '<img class="city-wall" src="' + cityWallSprite() + '" alt="" draggable="false">' +
    cellDecorHTML('citadel') +
    '<span class="crown">👑</span>' + stackHTML(game, g.owner, g.cards) +
    '<div class="lane-city-info">' +
    '<b>' + (g.owner ? armyName(g.owner) : 'Mercenaries') + '</b>' +
    '<span id="deckPile" class="lane-pile" title="The shared draw pile all four armies draw and flip from — when it empties, the season turns">Draw pile ' + game.deck.length + '</span>' +
    '<span id="discardPile" class="lane-pile" title="Discarded cards — reshuffled into the draw pile when the season turns">Discard ' + game.discard.length + '</span>' +
    '</div></div>';

  // Four vertical lanes under the city: gate at the top, camp at the bottom,
  // so stacks visibly climb toward Kartenburg. Slots hold the real cards.
  html += '<div class="lane-cols">';
  const prevGlory = ui.glorySeen || {};
  for (const suit of SUITS) {
    const a = game.armies[suit];
    const mine = suit === you;
    const bumped = prevGlory[suit] !== undefined && prevGlory[suit] !== a.glory;
    html += '<div class="lane-col' + (mine ? ' mine' : '') + '" style="--tint:' + SUIT_META[suit].tint + '">' +
      '<div class="lane-head" title="' + armyName(suit) + ' — ' + a.glory + ' glory">' +
      '<span class="lane-sym">' + SUIT_META[suit].symbol + '</span>' +
      (game.garrison.owner === suit ? '<span class="lane-crown">👑</span>' : '') +
      '<span class="lane-score' + (bumped ? ' bump' : '') + '" data-lane-score="' + suit + '">' +
      a.glory + '</span>' +
      '</div>';
    // The sandy road up to Kartenburg — a wobbly pixel sprite under the slots.
    html += '<div class="lane-path"><img class="lane-road" src="' + lanePathSprite(suit) +
      '" alt="" draggable="false">';
    for (let i = ROAD_LEN - 1; i >= 0; i--) {
      const stack = a.road[i];
      const movable = mine && can('road', i);
      html += '<div class="lane-slot' + (stack ? ' occ' : '') + (movable ? ' movable' : '') +
        (i === ROAD_LEN - 1 ? ' gate' : '') +
        (stack && i === ROAD_LEN - 1 && !mine ? ' threat' : '') +
        '" data-cell="road-' + suit + '-' + i + '"' +
        (mine ? ' onclick="onCellClick(\'road\',\'' + suit + '\',' + i + ')"' : '') + '>' +
        cellDecorHTML('road-' + suit + '-' + i) +
        (i === ROAD_LEN - 1
          ? spriteImg('gatetorch', 'gt-l', 3) + spriteImg('gatetorch', 'gt-r', 3) + '<label>Gate</label>'
          : '') +
        (stack ? stackHTML(game, suit, stack.cards) : '') + '</div>';
    }
    // Camp: every played card is visible — posts (Q/K) as single cards,
    // armies as overlapped stacks with their strength badge.
    const posts = [
      a.posts.queen && { c: a.posts.queen, t: 'Banner: all their armies fight at +2' },
      a.posts.king && { c: a.posts.king, t: 'General: their marches cost 1 less' },
    ].filter(Boolean).map(p =>
      '<div class="lane-post" title="' + p.t + '">' + pcardHTML(p.c, 'mini') + '</div>').join('');
    html += '<div class="lane-slot camp" data-cell="camp-' + suit + '">' +
      cellDecorHTML('camp-' + suit) +
      spriteImg('tent', 'camp-tent', 3) + spriteImg('fire', 'camp-fire', 3) +
      '<label>Camp</label>' + posts +
      a.camp.map((s, i) => {
        const movable = mine && can('camp', i);
        return '<div class="lane-camp-stack' + (movable ? ' movable' : '') + '"' +
          (mine && active ? ' onclick="startMarch(\'camp\',' + i + ')"' : '') +
          ' title="' + stackLabel(s.cards) + ' — strength ' + stackSum(s.cards) + '">' +
          stackHTML(game, suit, s.cards) + '</div>';
      }).join('') + '</div>';
    html += '</div>'; // /lane-path
    // Their cards enter play from here: humans show their held hand,
    // automated armies their banked supply pile.
    html += '<div class="lane-foot">' +
      (a.isHuman ? handFanHTML(a.hand.length) : supplyPileHTML(a.supply)) + '</div>';
    html += '</div>';
  }
  html += '</div>';
  document.getElementById('board').innerHTML = html;
}

function renderBoard() {
  renderLaneBoard();
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

  let html = '<div class="hand-block"><div class="hand-cards">';
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

  // Scores live on the lanes; here we only refresh the bump bookkeeping.
  ui.glorySeen = {};
  for (const suit of SUITS) ui.glorySeen[suit] = game.armies[suit].glory;
  document.getElementById('hudInfo').textContent =
    'S' + game.season + '/' + SEASONS + ' · deck ' + game.deck.length +
    (game.deck.length === 0 ? ' — ' + (game.season >= SEASONS ? 'the war' : 'the season') + ' ends this round!'
      : game.deck.length <= 6 ? ' ⌛' : '');

  // Contextual prompt line (lives in the bottom bar)
  const panel = document.getElementById('turnPanel');
  if (game.over) {
    panel.innerHTML = '<button class="btn primary" onclick="showEndModal()">Results</button>';
    return;
  }
  if (!cur.isHuman) {
    // Context console: while the automated armies move, this space becomes
    // a live ticker of what is happening instead of a dimmed dead zone.
    const lines = game.log.slice(-3).map(l =>
      '<p class="tick-line log-' + l.kind + '">' + l.msg + '</p>').join('');
    panel.innerHTML = '<div class="ticker">' + lines + '</div>';
    return;
  }
  if (!myTurn()) {
    panel.innerHTML = '<p class="prompt">Waiting for ' + playerLabel(cur.suit) + '…</p>';
    return;
  }
  // Glanceable status, no instructional prose: action pips + labeled buttons.
  const canTrade = supplyIndices(cur).length >= 2 && game.deck.length > 0;
  let pips = '';
  for (let i = 0; i < ACTIONS_PER_TURN; i++) {
    pips += '<span class="pip' + (i < game.actionsLeft ? ' on' : '') + '"></span>';
  }
  panel.innerHTML = '<div class="action-pips" title="Actions left this turn">' +
    '<span class="pips-label">Actions</span>' + pips + '</div>' +
    (canTrade ? '<button class="btn" onclick="onTrade()" title="Trade 2 supply for 1 fresh card">Trade</button>' : '') +
    '<button class="btn" onclick="onEndTurn()" title="Hold position and end your turn">End turn</button>';
}

function renderHandoff() {
  const overlay = document.getElementById('handoff');
  const target = handoffTarget();
  const need = !game.over && !!target && humanSuits().length > 1 && ui.revealedSuit !== target;
  overlay.classList.toggle('hidden', !need);
  if (need) {
    const defending = !!game.pendingBattle;
    document.getElementById('handoffText').innerHTML =
      (defending ? '🛡️ <strong>Defense!</strong> ' : '') +
      'Pass the device to <strong>' + playerLabel(target) + '</strong><br>' + armyName(target);
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

/* Attack and defense strengths of the pending battle (before any reserve). */
function pendingStrengths() {
  const pb = game.pendingBattle;
  if (pb.kind === 'assault') {
    return {
      att: effStrength(game, pb.attacker, pb.stack.cards),
      def: effStrength(game, game.garrison.owner, game.garrison.cards),
      what: 'assault Kartenburg with ' + stackLabel(pb.stack.cards),
      where: 'Your garrison',
    };
  }
  if (pb.kind === 'raid') {
    const stack = game.armies[pb.targetSuit].road[pb.roadIdx];
    const weak = stack.cards[weakestOf(stack.cards)];
    return {
      att: strength(pb.jack) + qBonus(game.armies[pb.attacker]),
      def: strength(weak) + qBonus(game.armies[pb.targetSuit]),
      what: 'raid your army on lane slot ' + (pb.roadIdx + 1),
      where: 'Your ' + cardLabel(weak),
    };
  }
  const st = postRaidStrengths(game, pb.attacker, pb.targetSuit, pb.post);
  return {
    att: st.att, def: st.def,
    what: 'strike your camp — they hunt your ' + (pb.post === 'queen' ? 'Banner (Q)' : 'General (K)'),
    where: 'Your ' + (pb.post === 'queen' ? 'Banner' : 'General'),
  };
}

function modalDefend(reserveIdx) {
  if (!game || !game.pendingBattle) return;
  const res = resolvePendingBattle(game, reserveIdx);
  if (!res.ok) { toast(res.msg); return; }
  afterEngineCall();
}

function renderActionModal() {
  const modal = document.getElementById('actionModal');
  const cur = currentArmy(game);
  const target = game.over ? null : handoffTarget();
  const handoffNeeded = !!target && humanSuits().length > 1 && ui.revealedSuit !== target;
  let title = '', body = '', cancelable = true, show = false;

  if (!handoffNeeded && game.pendingBattle && !game.over &&
      game.armies[game.pendingBattle.defender].isHuman) {
    const pb = game.pendingBattle;
    const s = pendingStrengths();
    show = true;
    cancelable = false;
    title = '🛡️ To arms, ' + armyName(pb.defender) + '!';
    body = '<p><strong>' + armyName(pb.attacker) + '</strong> ' + s.what +
      ' at strength <strong>' + s.att + '</strong>. ' + s.where + ' defends at <strong>' + s.def +
      '</strong> — you may commit one card of your suit from hand as a reserve. ' +
      'Its strength joins the defense, then the card is lost.</p>' +
      amOption('modalDefend(null)', '✋ Hold your reserves back',
        s.att > s.def ? '<span class="bad">The attack succeeds (' + s.att + ' vs ' + s.def + ')</span>'
          : '<span class="good">You hold anyway (' + s.att + ' vs ' + s.def + ')</span>');
    for (const i of reserveOptions(game, pb.defender)) {
      const card = game.armies[pb.defender].hand[i];
      const def2 = s.def + strength(card);
      body += amOption('modalDefend(' + i + ')',
        '🛡️ Commit ' + cardLabel(card) + ' (+' + strength(card) + ')',
        (s.att > def2 ? '<span class="bad">Still falls (' + s.att + ' vs ' + def2 + ')</span>'
          : '<span class="good">You hold (' + s.att + ' vs ' + def2 + ')</span>') +
        ' — the reserve is lost either way.');
    }
  } else if (!handoffNeeded && mustDiscard()) {
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
      body = '<p>Your raiders strike at ' + attStr + '. On a road they hit the army\'s ' +
        '<strong>weakest card</strong>; in a camp they can strike at a <strong>Banner or General</strong> ' +
        '(+2 for the infiltration). Defenders may commit a reserve.</p>';
      for (const t of raidTargets()) {
        const weak = t.stack.cards[weakestOf(t.stack.cards)];
        const defStr = strength(weak) + qBonus(game.armies[t.suit]);
        body += amOption('modalRaid(\'' + t.suit + '\',' + t.idx + ')',
          armyName(t.suit) + (t.idx === ROAD_LEN - 1 ? ' at their gate' : ' on lane slot ' + (t.idx + 1)) + ': ' + stackLabel(t.stack.cards),
          'Targets ' + cardLabel(weak) + ' → ' + battleForecast(attStr, defStr));
      }
      for (const t of postTargets()) {
        const st = postRaidStrengths(game, cur.suit, t.suit, t.post);
        body += amOption('modalRaidPost(\'' + t.suit + '\',\'' + t.post + '\')',
          armyName(t.suit) + '\'s ' + (t.post === 'queen' ? 'Banner (Q)' : 'General (K)') + ' in camp',
          (t.post === 'queen' ? 'Fell it and their armies lose their +2' : 'Slay him and their marches cost full price') +
          ' → ' + battleForecast(st.att, st.def));
      }
    } else if (m.type === 'pickArmy') {
      const nSupply = supplyIndices(cur).length;
      title = '🥾 March which army?';
      body = '<p>Off-suit cards are supply: a march costs 1 per card in the stack. You have <strong>' +
        nSupply + '</strong> supply.</p>';
      for (const p of myPlans()) {
        const stack = p.from.zone === 'camp' ? cur.camp[p.from.idx] : cur.road[p.from.idx];
        const where = p.from.zone === 'camp' ? 'in camp' : p.from.idx === ROAD_LEN - 1 ? 'at the gate' : 'on lane slot ' + (p.from.idx + 1);
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
    return '🧩 Merge with ' + stackLabel(ahead.cards) + ' on lane slot ' + (plan.dest.idx + 1) +
      ' → combined strength ' + (stackSum(ahead.cards) + stackSum(stack.cards));
  }
  return '⬆️ Advance to ' + (plan.dest.idx === ROAD_LEN - 1 ? 'the gate' : 'lane slot ' + (plan.dest.idx + 1));
}

/* ── End of game ──────────────────────────────────────────────────────── */

function showEndModal() {
  const rows = SUITS.slice().sort((a, b) => game.armies[b].glory - game.armies[a].glory);
  document.getElementById('endVerdict').innerHTML = '🏆 ' +
    game.winners.map(armyName).join(' & ') + ' — victorious with ' +
    game.armies[game.winners[0]].glory + ' glory!';
  const src = ui.glorySrc || {};
  document.getElementById('endTable').innerHTML =
    '<tr><th>Army</th><th>Controller</th><th>Glory</th><th class="glory-src">The tale</th></tr>' +
    rows.map(s => {
      const t = src[s] || { capture: 0, tribute: 0, season: 0 };
      const battle = Math.max(0, game.armies[s].glory - t.capture - t.tribute - t.season);
      return '<tr' + (game.winners.indexOf(s) !== -1 ? ' class="winner-row"' : '') + '><td>' + armyName(s) + '</td><td>' +
        (game.armies[s].isHuman ? playerLabel(s) : 'Automated') + '</td><td class="glory-count" data-v="' +
        game.armies[s].glory + '">0</td><td class="glory-src">🏰' + t.capture + ' 👑' + t.tribute +
        ' ⚔️' + battle + ' 🌱' + t.season + '</td></tr>';
    }).join('') +
    '<tr class="src-legend"><td colspan="4">🏰 capture · 👑 tribute · ⚔️ battle · 🌱 season hold</td></tr>';
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
  draw: 420, flip: 950, deploy: 480, march: 520, assault: 2600, capture: 700,
  raid: 750, tribute: 420, supply: 380, toss: 320, season: 950,
  deal: 780, garrison: 1550,
  defense: 650, reserve: 620, postraid: 780, seasonHold: 900,
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
  const deckR = stageDeckRect((holdMs || 620) + 700);
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

/* Center-stage piles: the deck steps to mid-screen while cards are drawn
 * and dealt from it; the trash pile appears while cards are thrown away,
 * collecting them as a disorganized heap — then both slip away. */
const stage = { deck: null, deckT: null, trash: null, trashT: null };

function stageOut(key) {
  const el = stage[key];
  stage[key] = null;
  if (el) {
    el.classList.add('stage-out');
    setTimeout(() => el.remove(), 380);
  }
}

function stageDeckRect(holdMs) {
  if (!stage.deck) {
    const el = document.createElement('div');
    el.className = 'fx-stage fx-stage-deck';
    el.innerHTML = '<div class="pile-stack">' + cardBackHTML('b3') + cardBackHTML('b2') +
      cardBackHTML() + '</div><span class="stage-label"></span>';
    fxRoot().appendChild(el);
    stage.deck = el;
  }
  const lbl = stage.deck.querySelector('.stage-label');
  if (lbl && game) lbl.textContent = 'Draw pile ' + game.deck.length;
  clearTimeout(stage.deckT);
  stage.deckT = setTimeout(() => stageOut('deck'), holdMs || 1200);
  return stage.deck.querySelector('.pile-stack').getBoundingClientRect();
}

function stageTrashRect(holdMs) {
  if (!stage.trash) {
    const el = document.createElement('div');
    el.className = 'fx-stage fx-stage-trash';
    el.innerHTML = '<div class="trash-cards"></div><span class="stage-label">Discard</span>';
    fxRoot().appendChild(el);
    stage.trash = el;
  }
  clearTimeout(stage.trashT);
  stage.trashT = setTimeout(() => stageOut('trash'), holdMs || 1500);
  return stage.trash.querySelector('.trash-cards').getBoundingClientRect();
}

/* A thrown card lands on the heap: random offset and tilt, nothing tidy. */
function stageTrashLand(html) {
  stageTrashRect(1500);
  if (!stage.trash) return;
  const holder = stage.trash.querySelector('.trash-cards');
  const rot = (Math.random() * 56 - 28).toFixed(0);
  const dx = (Math.random() * 30 - 15).toFixed(0);
  const dy = (Math.random() * 18 - 9).toFixed(0);
  holder.insertAdjacentHTML('beforeend',
    '<span class="trash-card" style="transform:translate(calc(-50% + ' + dx + 'px), calc(-50% + ' +
    dy + 'px)) rotate(' + rot + 'deg)">' + html + '</span>');
  while (holder.children.length > 7) holder.removeChild(holder.firstChild);
}

/* A glory coin flies from where it was earned to that army's HUD score chip,
 * which pops on landing — the payoff always travels to the scoreboard. */
function gloryFly(suit, amount, fromR) {
  const chip = document.querySelector('[data-lane-score="' + suit + '"]');
  if (!fromR || !chip) return;
  flyHTML('<span class="glory-fly">🏅' + (amount > 1 ? '<b>×' + amount + '</b>' : '') + '</span>',
    fromR, chip.getBoundingClientRect(), 520);
  setTimeout(() => {
    const c = document.querySelector('[data-lane-score="' + suit + '"]');
    if (c) {
      c.classList.remove('chip-pop');
      void c.offsetWidth;
      c.classList.add('chip-pop');
    }
    sfx.coin();
  }, 500);
}

/* Balatro-style battle cascade for assaults: both totals build card by card
 * with rising pings, bonuses chip in, a beat of silence, then the clash. */
function battleDuel(ev) {
  const attCards = ev.cards || [];
  const defCards = ev.defCards || [];
  const attBonus = ev.attStr - stackSum(attCards);
  const defBonus = ev.defStr - stackSum(defCards);
  const defMeta = ev.defOwner ? SUIT_META[ev.defOwner] : { symbol: '⚔', tint: '#8a8f98' };
  const el = document.createElement('div');
  el.className = 'fx-duel';
  el.innerHTML =
    '<div class="duel-side att" style="--tint:' + SUIT_META[ev.suit].tint + '">' +
    '<span class="duel-sym">' + SUIT_META[ev.suit].symbol + '</span>' +
    '<div class="duel-num"></div><div class="duel-chips"></div></div>' +
    '<div class="duel-vs">' + pixelWordHTML('VS', 3, '#d4a72c') + '</div>' +
    '<div class="duel-side def" style="--tint:' + defMeta.tint + '">' +
    '<span class="duel-sym">' + defMeta.symbol + '</span>' +
    '<div class="duel-num"></div><div class="duel-chips"></div></div>';
  fxRoot().appendChild(el);
  const sides = el.querySelectorAll('.duel-side');
  const setNum = (side, v) => {
    side.querySelector('.duel-num').innerHTML = pixelWordHTML(String(v), 5, '#ffffff');
  };
  setNum(sides[0], 0);
  setNum(sides[1], 0);
  let t = 300, ping = 0;
  const tick = (side, val, chipHtml) => {
    const p = ping++, at = t;
    t += 170;
    setTimeout(() => {
      setNum(side, val);
      side.querySelector('.duel-chips').insertAdjacentHTML('beforeend', chipHtml);
      side.classList.remove('duel-tick');
      void side.offsetWidth;
      side.classList.add('duel-tick');
      sfx.ping(p);
    }, at);
  };
  const seq = (side, cardsArr, bonus, bonusLabel) => {
    let run = 0;
    for (const c of cardsArr) {
      run += strength(c);
      tick(side, run, pcardHTML(c, 'mini'));
    }
    if (bonus > 0) {
      tick(side, run + bonus, '<span class="duel-chip">+' + bonus + ' ' + bonusLabel + '</span>');
    }
  };
  seq(sides[0], attCards, attBonus, '🚩');
  t += 240;
  seq(sides[1], defCards, defBonus, '🛡️');
  t += 320;
  const clashAt = t;
  setTimeout(() => {
    hitstop(90);
    const r = rectOf(cellSel('citadel'));
    shake(ev.won ? 'lg' : 'md');
    sparks(r, ev.won ? GOLD_SPARKS : BLOOD_SPARKS, ev.won ? 20 : 14);
    sides[ev.won ? 0 : 1].classList.add('duel-win');
    sides[ev.won ? 1 : 0].classList.add('duel-lose');
    battleScar('citadel', ev.won ? ['blood', 'helmet'] : ['blood', 'sword']);
    sfx.thud();
    if (!ev.won) {
      showBanner('ASSAULT REPELLED', { tint: '#d06050', variant: 'slash' });
      // Battered walls pay the attacker; a clean repel pays the holder.
      if (defCards.length >= 2) gloryFly(ev.suit, GLORY.siege, r);
      else if (ev.defOwner) gloryFly(ev.defOwner, GLORY.battle, r);
    }
  }, clashAt);
  setTimeout(() => el.remove(), clashAt + 900);
}

function runFx(ev) {
  const deckR = rectOf('#deckPile');
  const discR = rectOf('#discardPile');
  const handR = rectOf('#handArea .hand-cards') || rectOf('#handArea');
  switch (ev.type) {
    case 'draw': {
      showBanner('DRAWS ' + ev.count, suitOpts(ev.suit));
      for (let i = 0; i < ev.count; i++) {
        setTimeout(() => {
          flyHTML(cardBackHTML(), stageDeckRect(1300), drawDest(ev.suit), 380);
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
          flyHTML(cardBackHTML(), stageDeckRect(1300), drawDest(ev.suit), 380);
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
      battleDuel(ev);
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
        gloryFly(ev.suit, GLORY.capture, r);
        sfx.fanfare();
      }, 100);
      break;
    }
    case 'raid': {
      showBanner(ev.won ? 'RAIDERS STRIKE!' : 'RAID REPELLED', { tint: '#d06050', variant: 'slash' });
      const targetSel = cellSel('road', ev.targetSuit, ev.roadIdx);
      const tr = rectOf(targetSel);
      flyHTML(pcardHTML(ev.jack), deckR && !game.armies[ev.attacker].isHuman ? deckR : (handR || deckR), tr, 420, 'spin');
      setTimeout(() => {
        flashAt(tr);
        shake('sm');
        sparks(tr, BLOOD_SPARKS, 12);
        floatText(ev.won ? '💀 +1 🏅' : '🛡️ +1 🏅', tr, ev.won ? 'red big' : 'gold');
        gloryFly(ev.won ? ev.attacker : ev.targetSuit, GLORY.battle, tr);
        battleScar('road-' + ev.targetSuit + '-' + ev.roadIdx, ev.won ? ['blood', 'sword'] : ['blood', 'spear']);
        sfx.thud();
      }, 430);
      break;
    }
    case 'tribute': {
      showBanner('TRIBUTE +' + GLORY.tribute, suitOpts(ev.suit, { icon: '👑' }));
      const r = rectOf(cellSel('citadel'));
      gloryFly(ev.suit, GLORY.tribute, r);
      break;
    }
    case 'supply': {
      for (let i = 0; i < ev.count; i++) {
        setTimeout(() => {
          flyHTML(cardBackHTML(), handR, stageTrashRect(1500), 340);
          setTimeout(() => stageTrashLand(cardBackHTML()), 330);
        }, i * 110);
      }
      sfx.whoosh();
      break;
    }
    case 'toss': {
      flyHTML(pcardHTML(ev.card, 'mini'), handR, stageTrashRect(1500), 320);
      setTimeout(() => stageTrashLand(pcardHTML(ev.card, 'mini')), 310);
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
    case 'seasonHold': {
      showBanner('THE CROWN ENDURES +' + GLORY.season, suitOpts(ev.suit, { icon: '👑', big: true }));
      const r = rectOf(cellSel('citadel'));
      sparks(r, GOLD_SPARKS, 18);
      gloryFly(ev.suit, GLORY.season, r);
      sfx.fanfare();
      break;
    }
    case 'defense': {
      showBanner('TO ARMS!', suitOpts(ev.suit, { icon: '🛡️' }));
      sfx.thud();
      break;
    }
    case 'reserve': {
      showBanner('A RESERVE JOINS THE LINE', suitOpts(ev.suit, { icon: '🛡️' }));
      flyHTML(pcardHTML(ev.card, 'mini'), handR || deckR, stageTrashRect(1500), 380);
      setTimeout(() => stageTrashLand(pcardHTML(ev.card, 'mini')), 370);
      sfx.place();
      break;
    }
    case 'postraid': {
      showBanner(ev.won ? (ev.post === 'queen' ? 'THE BANNER FALLS!' : 'THE GENERAL FALLS!') : 'THE CAMP HOLDS',
        { tint: ev.won ? '#d06050' : SUIT_META[ev.targetSuit].tint, variant: 'slash' });
      const campSel = cellSel('camp', ev.targetSuit);
      const cr = rectOf(campSel);
      flyHTML(cardBackHTML(), deckR, cr, 420, 'spin');
      setTimeout(() => {
        flashAt(cr);
        shake(ev.won ? 'md' : 'sm');
        sparks(cr, BLOOD_SPARKS, ev.won ? 18 : 10);
        floatText(ev.won ? '💀 +1 🏅' : '🛡️ +1 🏅', cr, ev.won ? 'red big' : 'gold');
        gloryFly(ev.won ? ev.attacker : ev.targetSuit, GLORY.battle, cr);
        battleScar('camp-' + ev.targetSuit, ev.won ? ['blood', 'helmet'] : ['blood', 'spear']);
        sfx.thud();
      }, 430);
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
    // Rising-pitch scoring ping: each chip in a cascade sounds higher.
    ping(step) {
      const f = 540 * Math.pow(1.07, step);
      tone(f, 0.07, 'triangle', 0.06);
      tone(f * 2, 0.05, 'sine', 0.022, 0.01);
    },
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

function updateMuteBtns() {
  document.querySelectorAll('.muteBtn').forEach(b => {
    b.innerHTML = pixelWordHTML(sfx.isMuted() ? 'Sound off' : 'Sound on', 2, '#ffffff');
  });
}

function toggleSound() {
  sfx.toggle();
  updateMuteBtns();
}

document.addEventListener('DOMContentLoaded', () => {
  updateMuteBtns();
  document.body.classList.add('pixel-mode');
  document.body.classList.add('lane-mode'); // the lane view is the only view
  const title = document.getElementById('titleScreen');
  buildTitleFx('menuFx');
  if (title) {
    buildTitleFx();
    // Belt and braces for iOS Safari: some versions only deliver taps
    // reliably via touchend/pointerup (plus the inline onclick attribute).
    title.addEventListener('click', enterMenu);
    title.addEventListener('pointerup', enterMenu);
    title.addEventListener('touchend', e => { e.preventDefault(); enterMenu(); }, { passive: false });
    document.addEventListener('keydown', e => {
      if (!title.classList.contains('hidden') && e.key !== 'F12') enterMenu();
    }, { once: true });
  }
});
