# 🃏 Four Banners

A war game for **one regular 52-card deck** — four suit-armies race to capture and hold
a central citadel. Playable in the browser for 1–4 players (any army without a player
runs on a deterministic script), and equally playable on a kitchen table with a real
deck, pen and paper.

**No build step, no dependencies** — plain HTML/CSS/JS. Open `index.html` in a
browser, or host it with GitHub Pages.

## The game in one paragraph

Each suit is an army: number cards are soldiers (strength = pips), the Ace a champion
(11), the Jack a one-shot raider, the Queen a banner (+2 to all your battles) and the
King a general (marches move 2). Cards of other suits are supply — one pays for each
march. Armies march down their road toward the Citadel; battles are a single strength
comparison (defender wins ties); capturing the Citadel scores 5 glory, holding it at
each season's end 3, winning raids and defenses 1. Two seasons (one reshuffle), most
glory wins.

Automated armies hold no hand: their turn is two card flips — own suit deploys,
anything else marches the frontmost unit. Fully deterministic, so at a real table any
player can run them in seconds.

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
