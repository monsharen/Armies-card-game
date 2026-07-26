/* Four Banners — standard 52-card deck definitions.
 * Each suit is an army. In your own suit:
 *   2–10  soldier (strength = pip value)
 *   A     champion (strength 11)
 *   J     raider — one-shot attack, or deploy as a strength-11 soldier
 *   Q     banner  — camp post, all your units fight at +2
 *   K     general — camp post, your marches move up to 2 spaces
 * Cards of other suits are supply: each march is paid for with one.
 */

const SUITS = ['hearts', 'spades', 'diamonds', 'clubs']; // clockwise seating & turn order

const SUIT_META = {
  hearts:   { symbol: '♥', color: 'red',   army: 'Hearts',   tint: '#c04545' },
  spades:   { symbol: '♠', color: 'black', army: 'Spades',   tint: '#5d6675' },
  diamonds: { symbol: '♦', color: 'red',   army: 'Diamonds', tint: '#c99a2c' },
  clubs:    { symbol: '♣', color: 'black', army: 'Clover',   tint: '#4c7a3d' },
};

const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K', 'A'];

function makeDeck() {
  const deck = [];
  for (const suit of SUITS) {
    for (const rank of RANKS) deck.push({ suit, rank, id: rank + '-' + suit });
  }
  return deck;
}

/* Battle strength of a card fighting as a unit (or as the citadel garrison). */
function strength(card) {
  if (card.rank === 'A' || card.rank === 'J') return 11;
  if (card.rank === 'Q') return 12;
  if (card.rank === 'K') return 13;
  return parseInt(card.rank, 10);
}

function cardLabel(card) {
  return card.rank + SUIT_META[card.suit].symbol;
}

function armyName(suit) {
  return SUIT_META[suit].army + ' ' + SUIT_META[suit].symbol;
}

if (typeof module !== 'undefined') {
  module.exports = { SUITS, SUIT_META, RANKS, makeDeck, strength, cardLabel, armyName };
}
