/* Kartenburg — pure game engine. No DOM access, so it can be unit-tested in
 * Node and driven by either the UI or headless simulations.
 *
 * Units are ARMIES: stacks of up to STACK_CAP cards of one suit. An army's
 * strength is the sum of its cards (+2 with its Queen banner). Armies march
 * down a road of ROAD_LEN spaces toward Kartenburg; marching costs
 * one supply card per card in the stack (King: one less, min 1). Armies can
 * merge by marching onto a friendly army. Battles compare stack totals
 * (defender wins ties): the loser is destroyed and the winner discards its
 * weakest card as casualties — victories cost blood, so no army is forever.
 *
 * Kartenburg pays tribute: +1 glory at the start of each of your turns while
 * your army garrisons it. That clock is what punishes waiting at home for
 * perfect cards.
 */

const ROAD_LEN = 3;
const STACK_CAP = 3;
const HAND_LIMIT = 7;
const ACTIONS_PER_TURN = 2;
const NPC_FLIPS = 2;
const SEASONS = 2;
const GLORY = { battle: 1, capture: 5, tribute: 1 };

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
    events: [],  // animation/FX events for the UI; harmless to ignore headless
  };
  for (const suit of SUITS) {
    state.armies[suit] = {
      suit,
      isHuman: humans.indexOf(suit) !== -1,
      hand: [],
      camp: [],                          // array of {cards: [...]} stacks
      road: new Array(ROAD_LEN).fill(null), // each null or {cards: [...]}
      posts: { queen: null, king: null },
      supply: 0,                         // automated armies bank supply here
      glory: 0,
    };
  }
  for (const suit of humans) {
    for (let i = 0; i < 4; i++) state.armies[suit].hand.push(state.deck.pop());
    pushEvent(state, { type: 'deal', suit, count: 4 });
  }
  const g = [state.deck.pop(), state.deck.pop()];
  state.garrison = { cards: g, owner: null };
  pushEvent(state, { type: 'garrison', cards: g.slice() });
  addLog(state, 'system', 'The war for Kartenburg begins. Mercenaries hold it: ' +
    stackLabel(g) + ' (strength ' + stackSum(g) + '). Kartenburg pays its holder ' +
    GLORY.tribute + ' glory at the start of each of their turns.');
  beginTurn(state);
  return state;
}

function addLog(state, kind, msg) {
  state.log.push({ kind, msg, season: state.season });
}

function pushEvent(state, ev) {
  state.events.push(ev);
}

function currentArmy(state) {
  return state.armies[SUITS[state.orderIdx]];
}

function qBonus(army) {
  return army.posts.queen ? 2 : 0;
}

function stackSum(cards) {
  return cards.reduce((s, c) => s + strength(c), 0);
}

function stackLabel(cards) {
  return cards.map(cardLabel).join('+');
}

/* Battle strength of a stack fighting for a given owner (null = mercenaries). */
function effStrength(state, ownerSuit, cards) {
  return stackSum(cards) + (ownerSuit ? qBonus(state.armies[ownerSuit]) : 0);
}

function weakestIdx(cards) {
  let idx = 0;
  for (let i = 1; i < cards.length; i++) {
    if (strength(cards[i]) < strength(cards[idx])) idx = i;
  }
  return idx;
}

function marchCost(army, stack) {
  return Math.max(1, stack.cards.length - (army.posts.king ? 1 : 0));
}

function supplyIndices(army) {
  const idxs = [];
  army.hand.forEach((c, i) => { if (c.suit !== army.suit) idxs.push(i); });
  return idxs;
}

/* ── Deck, seasons, game end ──────────────────────────────────────────── */

function drawCard(state) {
  if (state.over) return null;
  if (!state.deck.length) endSeason(state);
  if (state.over || !state.deck.length) return null;
  return state.deck.pop();
}

function endSeason(state) {
  if (state.season >= SEASONS) {
    finishGame(state);
    return;
  }
  state.season++;
  state.deck = shuffle(state.discard);
  state.discard = [];
  addLog(state, 'system', '🌱 Season ' + state.season + ' begins — the fallen return to the deck (' +
    state.deck.length + ' cards).');
  pushEvent(state, { type: 'season', season: state.season });
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
  if (state.garrison.owner === army.suit) {
    army.glory += GLORY.tribute;
    addLog(state, 'system', '👑 ' + armyName(army.suit) + ' collects Kartenburg tribute: +' +
      GLORY.tribute + ' glory.');
    pushEvent(state, { type: 'tribute', suit: army.suit });
  }
  if (army.isHuman) {
    let drawn = 0;
    while (drawn < 2) {
      const card = drawCard(state);
      if (!card) break;
      army.hand.push(card);
      drawn++;
    }
    state.pendingDiscard = Math.max(0, army.hand.length - HAND_LIMIT);
    if (drawn) pushEvent(state, { type: 'draw', suit: army.suit, count: drawn });
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

/* Winner discards its weakest card as casualties (single-card armies are
 * spared). Applies to garrisons repelling assaults too — fortresses erode. */
function takeCasualties(state, cards) {
  if (cards.length < 2) return null;
  const fallen = cards.splice(weakestIdx(cards), 1)[0];
  state.discard.push(fallen);
  return fallen;
}

function resolveAssault(state, suit, stack) {
  const g = state.garrison;
  const attStr = effStrength(state, suit, stack.cards);
  const defStr = effStrength(state, g.owner, g.cards);
  const defName = g.owner ? armyName(g.owner) : 'the mercenaries';
  pushEvent(state, { type: 'assault', suit, won: attStr > defStr, attStr, defStr });
  if (attStr > defStr) {
    for (const c of g.cards) state.discard.push(c);
    const fallen = takeCasualties(state, stack.cards);
    state.garrison = { cards: stack.cards, owner: suit };
    state.armies[suit].glory += GLORY.capture;
    pushEvent(state, { type: 'capture', suit });
    addLog(state, 'battle', '🏰 ' + armyName(suit) + '\'s army ' + stackLabel(stack.cards) +
      ' (' + attStr + ') storms Kartenburg, destroying ' + defName + ' (' + defStr + ')! +' +
      GLORY.capture + ' glory.' + (fallen ? ' Casualties: ' + cardLabel(fallen) + '.' : ''));
  } else {
    for (const c of stack.cards) state.discard.push(c);
    const fallen = takeCasualties(state, g.cards);
    if (g.owner) state.armies[g.owner].glory += GLORY.battle;
    addLog(state, 'battle', '🛡️ Assault repelled! ' + armyName(suit) + '\'s army (' + attStr +
      ') breaks against ' + defName + ' (' + defStr + ').' +
      (g.owner ? ' +' + GLORY.battle + ' glory to ' + armyName(g.owner) + '.' : '') +
      (fallen ? ' Garrison casualties: ' + cardLabel(fallen) + '.' : ''));
  }
}

/* A raid strikes an enemy army's weakest card — Jacks whittle stacks down. */
function resolveRaid(state, attackerSuit, jack, targetSuit, roadIdx) {
  const att = state.armies[attackerSuit];
  const def = state.armies[targetSuit];
  const stack = def.road[roadIdx];
  const wIdx = weakestIdx(stack.cards);
  const target = stack.cards[wIdx];
  const attStr = strength(jack) + qBonus(att);
  const defStr = strength(target) + qBonus(def);
  pushEvent(state, { type: 'raid', attacker: attackerSuit, targetSuit, roadIdx, won: attStr > defStr, jack });
  if (attStr > defStr) {
    stack.cards.splice(wIdx, 1);
    state.discard.push(target);
    if (!stack.cards.length) def.road[roadIdx] = null;
    att.glory += GLORY.battle;
    addLog(state, 'battle', '🗡️ ' + armyName(attackerSuit) + '\'s raiders (' + attStr +
      ') cut ' + cardLabel(target) + ' (' + defStr + ') out of ' + armyName(targetSuit) +
      '\'s army! +' + GLORY.battle + ' glory.');
  } else {
    def.glory += GLORY.battle;
    addLog(state, 'battle', '🛡️ ' + armyName(targetSuit) + '\'s ' + cardLabel(target) + ' (' + defStr +
      ') drives off ' + armyName(attackerSuit) + '\'s raiders (' + attStr + '). +' +
      GLORY.battle + ' glory to the defender.');
  }
  state.discard.push(jack); // raiders always withdraw
}

/* ── Marching ─────────────────────────────────────────────────────────── */

/* All marches for a suit, one plan per army that has somewhere to go:
 * {from: {zone:'camp'|'road', idx}, dest: {zone:'road', idx}|{zone:'citadel'},
 *  kind: 'move'|'merge'|'assault', cost}. Forward only; merging requires the
 * combined stack to fit under STACK_CAP; assaulting your own garrison is out. */
function computeMarchPlans(state, suit) {
  const army = state.armies[suit];
  const plans = [];
  const forward = (stack, from, destIdx) => {
    if (destIdx >= ROAD_LEN) {
      if (state.garrison.owner !== suit) {
        plans.push({ from, dest: { zone: 'citadel' }, kind: 'assault', cost: marchCost(army, stack) });
      }
      return;
    }
    const ahead = army.road[destIdx];
    if (!ahead) {
      plans.push({ from, dest: { zone: 'road', idx: destIdx }, kind: 'move', cost: marchCost(army, stack) });
    } else if (ahead.cards.length + stack.cards.length <= STACK_CAP) {
      plans.push({ from, dest: { zone: 'road', idx: destIdx }, kind: 'merge', cost: marchCost(army, stack) });
    }
  };
  for (let i = ROAD_LEN - 1; i >= 0; i--) {
    if (army.road[i]) forward(army.road[i], { zone: 'road', idx: i }, i + 1);
  }
  army.camp.forEach((stack, i) => forward(stack, { zone: 'camp', idx: i }, 0));
  return plans;
}

function stackAt(army, from) {
  return from.zone === 'camp' ? army.camp[from.idx] : army.road[from.idx];
}

function executePlan(state, suit, plan) {
  const army = state.armies[suit];
  const stack = stackAt(army, plan.from);
  pushEvent(state, { type: 'march', suit, from: plan.from, dest: plan.dest, kind: plan.kind,
    cards: stack.cards.slice() });
  if (plan.from.zone === 'camp') army.camp.splice(plan.from.idx, 1);
  else army.road[plan.from.idx] = null;
  if (plan.kind === 'assault') {
    addLog(state, 'player', armyName(suit) + '\'s army ' + stackLabel(stack.cards) +
      ' marches on Kartenburg!');
    resolveAssault(state, suit, stack);
  } else if (plan.kind === 'merge') {
    const ahead = army.road[plan.dest.idx];
    ahead.cards.push.apply(ahead.cards, stack.cards);
    addLog(state, 'player', armyName(suit) + ' merges its armies into ' +
      stackLabel(ahead.cards) + ' (strength ' + stackSum(ahead.cards) + ') on road space ' +
      (plan.dest.idx + 1) + '.');
  } else {
    army.road[plan.dest.idx] = stack;
    addLog(state, 'player', armyName(suit) + '\'s army ' + stackLabel(stack.cards) +
      ' marches to road space ' + (plan.dest.idx + 1) + '.');
  }
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
  pushEvent(state, { type: 'toss', suit: army.suit, card });
  addLog(state, 'player', armyName(army.suit) + ' discards ' + cardLabel(card) + '.');
  return { ok: true };
}

/* Deploy a card of your suit. target: {zone:'newcamp'} starts a fresh army;
 * {zone:'camp', idx} reinforces that camp army. Armies that have marched out
 * (road or garrison) can NOT be reinforced — cards enter the board only in
 * camp, and strength moves only by paying supply. Marching is a commitment. */
function deployCard(state, handIdx, target) {
  const g = humanGuard(state);
  if (!g.ok) return g;
  const army = g.army;
  const card = army.hand[handIdx];
  if (!card) return { ok: false, msg: 'No such card.' };
  if (card.suit !== army.suit) return { ok: false, msg: 'Only cards of your own suit can be deployed. Off-suit cards are supply for marching.' };
  if (card.rank === 'Q') {
    if (army.posts.queen) return { ok: false, msg: 'Your Banner is already raised.' };
    army.posts.queen = card;
    addLog(state, 'player', armyName(army.suit) + ' raises the Banner (Q): all their armies now fight at +2.');
    pushEvent(state, { type: 'deploy', suit: army.suit, card, target: 'post' });
  } else if (card.rank === 'K') {
    if (army.posts.king) return { ok: false, msg: 'Your General is already in camp.' };
    army.posts.king = card;
    addLog(state, 'player', armyName(army.suit) + '\'s General (K) takes command: marches cost 1 less supply.');
    pushEvent(state, { type: 'deploy', suit: army.suit, card, target: 'post' });
  } else if (!target || target.zone === 'newcamp') {
    army.camp.push({ cards: [card] });
    addLog(state, 'player', armyName(army.suit) + ' musters a new army: ' + cardLabel(card) +
      ' (strength ' + strength(card) + ').');
    pushEvent(state, { type: 'deploy', suit: army.suit, card, target: 'camp' });
  } else {
    if (target.zone !== 'camp') {
      return { ok: false, msg: 'Armies can only be reinforced in camp — once they march out, their roster is fixed.' };
    }
    const stack = army.camp[target.idx];
    if (!stack) return { ok: false, msg: 'No army there.' };
    if (stack.cards.length >= STACK_CAP) return { ok: false, msg: 'That army is full (' + STACK_CAP + ' cards).' };
    stack.cards.push(card);
    addLog(state, 'player', armyName(army.suit) + ' reinforces a camp army: now ' +
      stackLabel(stack.cards) + ' (strength ' + stackSum(stack.cards) + ').');
    pushEvent(state, { type: 'deploy', suit: army.suit, card, target: 'camp' });
  }
  army.hand.splice(handIdx, 1);
  spendAction(state);
  return { ok: true };
}

/* March the army at `from` along its (single) forward plan. Supply cards are
 * taken from the hand automatically. */
function march(state, from) {
  const g = humanGuard(state);
  if (!g.ok) return g;
  const army = g.army;
  const plan = computeMarchPlans(state, army.suit).find(p =>
    p.from.zone === from.zone && p.from.idx === from.idx);
  if (!plan) return { ok: false, msg: 'That army has nowhere to march.' };
  const supplies = supplyIndices(army);
  if (supplies.length < plan.cost) {
    return { ok: false, msg: 'Marching that army costs ' + plan.cost + ' supply — you have ' + supplies.length + '.' };
  }
  for (let i = plan.cost - 1; i >= 0; i--) {
    state.discard.push(army.hand.splice(supplies[i], 1)[0]);
  }
  addLog(state, 'player', armyName(army.suit) + ' spends ' + plan.cost + ' supply.');
  pushEvent(state, { type: 'supply', suit: army.suit, count: plan.cost });
  executePlan(state, army.suit, plan);
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
    return { ok: false, msg: 'Pick an enemy army on a road to raid.' };
  }
  army.hand.splice(handIdx, 1);
  resolveRaid(state, army.suit, card, targetSuit, roadIdx);
  spendAction(state);
  return { ok: true };
}

/* ── The automated-army script ────────────────────────────────────────── *
 * One flip: own suit → Q/K take posts, the Jack raids (or reinforces when
 * there is nothing to raid), anything else reinforces the most forward army
 * with room (garrison first, then road, then camp) or founds a new one.
 * Any other suit → one banked supply; the frontmost army marches as soon as
 * the bank covers its cost. At a real table the bank is just a face-up pile. */

function npcRaidTarget(state, suit) {
  let best = null;
  for (let d = 1; d < SUITS.length; d++) {
    const enemy = SUITS[(SUITS.indexOf(suit) + d) % SUITS.length];
    const road = state.armies[enemy].road;
    for (let i = 0; i < ROAD_LEN; i++) {
      if (!road[i]) continue;
      const cand = { suit: enemy, idx: i, str: stackSum(road[i].cards) };
      if (!best || cand.idx > best.idx || (cand.idx === best.idx && cand.str > best.str)) {
        best = cand;
      }
    }
  }
  return best;
}

/* Reinforcement is camp-only (marching is a commitment): the fullest camp
 * army with room gets the recruit (oldest on ties), else a new army forms. */
function npcReinforce(state, army, card) {
  let target = null;
  for (const stack of army.camp) {
    if (stack.cards.length >= STACK_CAP) continue;
    if (!target || stack.cards.length > target.cards.length) target = stack;
  }
  if (target) {
    target.cards.push(card);
    addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) +
      ' — reinforces a camp army: now ' + stackLabel(target.cards) + ' (strength ' + stackSum(target.cards) + ').');
  } else {
    army.camp.push({ cards: [card] });
    addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) +
      ' — musters a new army (strength ' + strength(card) + ').');
  }
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
      pushEvent(state, { type: 'flip', suit: army.suit, card, action: 'post' });
      army.posts.queen = card;
      addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) +
        ' — raises its Banner: armies fight at +2.');
    } else if (card.rank === 'K' && !army.posts.king) {
      pushEvent(state, { type: 'flip', suit: army.suit, card, action: 'post' });
      army.posts.king = card;
      addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) +
        ' — its General takes command: marches cost 1 less.');
    } else if (card.rank === 'J') {
      const target = npcRaidTarget(state, army.suit);
      if (target) {
        pushEvent(state, { type: 'flip', suit: army.suit, card, action: 'raid' });
        addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) + ' — raiders ride out!');
        resolveRaid(state, army.suit, card, target.suit, target.idx);
      } else {
        pushEvent(state, { type: 'flip', suit: army.suit, card, action: 'muster' });
        npcReinforce(state, army, card);
      }
    } else {
      pushEvent(state, { type: 'flip', suit: army.suit, card, action: 'muster' });
      npcReinforce(state, army, card);
    }
  } else {
    army.supply++;
    state.discard.push(card);
    const plan = computeMarchPlans(state, army.suit)[0]; // plans are frontmost-first
    if (plan && army.supply >= plan.cost) {
      pushEvent(state, { type: 'flip', suit: army.suit, card, action: 'supply-march' });
      army.supply -= plan.cost;
      addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) +
        ' — supplies complete (' + plan.cost + ' spent), the army marches!');
      executePlan(state, army.suit, plan);
    } else {
      pushEvent(state, { type: 'flip', suit: army.suit, card, action: 'supply-bank' });
      addLog(state, 'npc', armyName(army.suit) + ' flips ' + cardLabel(card) +
        ' — banks supply (' + army.supply + (plan ? ' of ' + plan.cost + ' needed' : '') + ').');
    }
  }
  if (state.over) return;
  state.flipsLeft--;
  if (state.flipsLeft <= 0) nextTurn(state);
}

if (typeof module !== 'undefined') {
  module.exports = {
    ROAD_LEN, STACK_CAP, HAND_LIMIT, ACTIONS_PER_TURN, NPC_FLIPS, SEASONS, GLORY, HUMAN_SEATS,
    createGame, currentArmy, qBonus, stackSum, stackLabel, effStrength, marchCost,
    supplyIndices, computeMarchPlans,
    deployCard, march, raid, passTurn, npcFlip, discardFromHand,
  };
}
