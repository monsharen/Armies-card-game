# ⚔️ Armies — a solo resource engine game

A single-player, turn-based browser game of **resource engine building**: a
Wingspan-style engine under the hood (everything you build joins a row and boosts
that row's action) with Catan-simple resources and piece limits. Build up your realm
over 15 turns and repel three enemy invasions.

**No build step, no dependencies** — plain HTML/CSS/JS. Open `index.html` in a
browser, or host it with GitHub Pages.

## Pages

| Page | Purpose |
|------|---------|
| `index.html` | Landing page |
| `game.html` | The game — a 15-turn solo campaign |
| `rules.html` | Full rules and strategy tips |
| `cards.html` | Compendium of every unit/building, generated from the live game data |

## How it plays

- **3 resources**: Food 🌾, Ore ⛏️, Gold 🪙.
- **3 rows** in your realm — Farmlands, Mines, War Camp — each tied to an action
  (Harvest, Mine, Patrol). Every unit or building placed in a row makes that row's
  action stronger: that's the engine.
- **One action per turn**: build something from the (supply-limited) build menu,
  or activate one row.
- **Invasions** at the end of turns 5, 10 and 15. Enemy strength is rolled at
  campaign start and revealed by your scouts in advance. Repel it (army power ≥
  enemy strength) for 5/7/10 glory; fail and raiders pillage half your stores.
- **Final score** = army power + war glory + 1 per 3 leftover resources, mapped to
  a rank from Camp Follower to Legendary Conqueror. Personal best is kept in
  `localStorage`.

## Code layout

```
css/style.css   — all styling
js/cards.js     — unit/building data (single source of truth, also drives the compendium)
js/engine.js    — pure game logic, no DOM (unit-testable in Node)
js/ui.js        — rendering + player input for game.html
```

The engine has no DOM dependencies, so full campaigns can be simulated headlessly
in Node for testing and balance work:

```js
const engine = require('./js/engine.js');
const state = engine.createGame();
// drive state with engine.build / engine.activateRow / engine.endTurn
```

## Hosting on GitHub Pages

Settings → Pages → deploy from branch, root folder. The site is fully static.
