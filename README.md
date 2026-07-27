# 🃏 Four Banners

*"Banners" for short.* A war game for **one regular 52-card deck** — four suit-armies race to capture and hold
a central citadel. Playable in the browser for 1–4 players (any army without a player
runs on a deterministic script), and equally playable on a kitchen table with a real
deck, pen and paper.

**No build step, no dependencies** — plain HTML/CSS/JS. Open `index.html` in a
browser, or host it with GitHub Pages.

## The game in one paragraph

Each suit is an army. You build fighting hosts by stacking up to three cards of your
suit into a single army whose strength is their sum: pips are soldiers, the Ace a
champion (11), the Jack a raider that snipes the weakest card out of an enemy stack,
the Queen a banner (+2 to all your battles) and the King a general (marches cost 1
less). Off-suit cards are supply — a march costs one per card in the stack, so heavy
hosts move slowly. Armies merge on the road, storm the Citadel (battles compare stack
totals, defender wins ties, the winner loses its weakest card as casualties), and the
Citadel pays its holder +1 glory every turn — the clock that punishes waiting for
perfect cards. Captures score 5, raids and defenses 1. Two seasons, most glory wins.

Automated armies hold no hand: their turn is two card flips — own suit reinforces
their most forward army, anything else banks supply until the frontmost army can
afford to march. Fully deterministic, so at a real table any player can run them in
seconds (the supply bank is literally a face-up pile of cards).

## Pages

| Page | Purpose |
|------|---------|
| `index.html` | Landing page |
| `game.html` | The game — hot-seat for 1–4 players plus automated armies |
| `rules.html` | Full rules and strategy tips |
| `reference.html` | Printable one-page reference sheet for tabletop play |

## Code layout

```
css/style.css   — all styling (incl. print styles for the reference sheet)
js/cards.js     — deck, suits, strengths, army names
js/engine.js    — pure game logic, no DOM (unit-testable in Node)
js/ui.js        — rendering + input for game.html
```

The engine has no DOM dependencies, so full games can be simulated headlessly in Node
for testing and balance work:

```js
const engine = require('./js/engine.js');
const state = engine.createGame(0); // 0 humans = four automated armies
while (!state.over) engine.npcFlip(state);
```

Human seats are driven with `engine.deploy`, `engine.marchTo`, `engine.raid`,
`engine.discardFromHand` and `engine.passTurn`.

## Hosting on GitHub Pages

Settings → Pages → deploy from branch, root folder. The site is fully static.
