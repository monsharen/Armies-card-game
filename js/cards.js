/* Armies — unit & building definitions.
 * The build menu is powered by these "cards": every one belongs to one row,
 * and when that row's action is taken, each card in the row triggers its
 * effect from left to right.
 *   cost:   resources paid to build/recruit it
 *   power:  permanent army strength (tested by invasions, scored at the end)
 *   effect: gained each time the card's row is activated
 *   stock:  how many of this card exist in your supply (Catan-style piece limit)
 */

const CARD_TYPES = [
  // ── Farmlands (Harvest action: base +1 Food) ─────────────────────────
  { id: 'peasant',    name: 'Peasant Levy',   row: 'farm',    cost: {},                       power: 1,  effect: { food: 1 },          stock: 4, icon: '🧑‍🌾',
    flavor: 'They fight with pitchforks, but they feed the camp.' },
  { id: 'grainfarm',  name: 'Grain Farm',     row: 'farm',    cost: { ore: 1 },               power: 0,  effect: { food: 2 },          stock: 3, icon: '🌾',
    flavor: 'An army marches on its stomach.' },
  { id: 'hunter',     name: 'Hunter',         row: 'farm',    cost: { food: 1 },              power: 2,  effect: { food: 1 },          stock: 3, icon: '🏹',
    flavor: 'Fresh game for the fires, sharp eyes for the watch.' },
  { id: 'oxwagon',    name: 'Ox Wagon',       row: 'farm',    cost: { food: 2 },              power: 1,  effect: { food: 1, gold: 1 }, stock: 2, icon: '🐂',
    flavor: 'Trade caravans follow wherever the wagons roll.' },
  { id: 'granary',    name: 'Granary Keep',   row: 'farm',    cost: { ore: 2 },               power: 3,  effect: { food: 1 },          stock: 2, icon: '🏰',
    flavor: 'Thick walls guard the winter stores.' },

  // ── Mines (Mine action: base +1 Ore) ─────────────────────────────────
  { id: 'prospector', name: 'Prospector',     row: 'mine',    cost: {},                       power: 1,  effect: { ore: 1 },           stock: 4, icon: '⛏️',
    flavor: 'Knows every seam in the hills.' },
  { id: 'ironmine',   name: 'Iron Mine',      row: 'mine',    cost: { food: 1 },              power: 0,  effect: { ore: 2 },           stock: 3, icon: '⚒️',
    flavor: 'The mountain gives, if you dig deep enough.' },
  { id: 'blacksmith', name: 'Blacksmith',     row: 'mine',    cost: { food: 1, ore: 1 },      power: 2,  effect: { ore: 1 },           stock: 3, icon: '🔨',
    flavor: 'Every blade in the army passed through her forge.' },
  { id: 'goldmine',   name: 'Gold Mine',      row: 'mine',    cost: { ore: 2 },               power: 0,  effect: { gold: 1 },          stock: 2, icon: '🪙',
    flavor: 'Gold buys what iron cannot.' },
  { id: 'siegeworks', name: 'Siege Workshop', row: 'mine',    cost: { ore: 2, gold: 1 },      power: 5,  effect: { ore: 1 },           stock: 2, icon: '🛠️',
    flavor: 'No wall stands forever.' },

  // ── War Camp (Patrol action: base +1 Gold) ───────────────────────────
  { id: 'scout',      name: 'Scout',          row: 'command', cost: { food: 1 },              power: 1,  effect: { gold: 1 },          stock: 3, icon: '🔭',
    flavor: 'Loots the borderlands before the enemy can.' },
  { id: 'footman',    name: 'Footman',        row: 'command', cost: { food: 1, ore: 1 },      power: 3,  effect: {},                   stock: 4, icon: '🗡️',
    flavor: 'The backbone of every battle line.' },
  { id: 'archer',     name: 'Archer',         row: 'command', cost: { food: 2 },              power: 3,  effect: {},                   stock: 3, icon: '🎯',
    flavor: 'Darkens the sky before the charge.' },
  { id: 'quarter',    name: 'Quartermaster',  row: 'command', cost: { gold: 1 },              power: 2,  effect: { gold: 1 },          stock: 2, icon: '📯',
    flavor: 'Runs the camp markets with an iron ledger.' },
  { id: 'knight',     name: 'Knight',         row: 'command', cost: { ore: 2, gold: 1 },      power: 6,  effect: {},                   stock: 2, icon: '🐎',
    flavor: 'A wall of steel on horseback.' },
  { id: 'catapult',   name: 'Catapult',       row: 'command', cost: { ore: 3 },               power: 5,  effect: {},                   stock: 2, icon: '🪨',
    flavor: 'Speaks a language every fortress understands.' },
  { id: 'warlord',    name: 'Warlord',        row: 'command', cost: { food: 2, ore: 2, gold: 2 }, power: 10, effect: {},               stock: 1, icon: '👑',
    flavor: 'Armies gather where the banner flies.' },
];

const RES_ICONS = { food: '🌾', ore: '⛏️', gold: '🪙' };

const ROW_INFO = {
  farm:    { label: 'Farmlands', action: 'Harvest', base: { food: 1 }, icon: '🌾' },
  mine:    { label: 'Mines',     action: 'Mine',    base: { ore: 1 },  icon: '⛏️' },
  command: { label: 'War Camp',  action: 'Patrol',  base: { gold: 1 }, icon: '⚔️' },
};

const ROWS = ['farm', 'mine', 'command'];

function cardById(id) {
  return CARD_TYPES.find(c => c.id === id);
}

function costText(cost) {
  const parts = [];
  for (const r of ['food', 'ore', 'gold']) {
    if (cost[r]) parts.push(RES_ICONS[r].repeat(cost[r]));
  }
  return parts.length ? parts.join(' ') : 'Free';
}

function effectText(card) {
  const e = card.effect || {};
  const parts = [];
  for (const r of ['food', 'ore', 'gold']) {
    if (e[r]) parts.push('+' + e[r] + ' ' + RES_ICONS[r]);
  }
  if (!parts.length) return null;
  return 'On ' + ROW_INFO[card.row].action + ': ' + parts.join(', ');
}

if (typeof module !== 'undefined') {
  module.exports = { CARD_TYPES, RES_ICONS, ROW_INFO, ROWS, cardById, costText, effectText };
}
