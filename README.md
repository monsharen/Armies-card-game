# 🃏 Kartenburg

A war game for **one regular 52-card deck**: the four realms of
the deck converge on Kartenburg, the castle of cards, to capture and hold it. Playable in the browser for 1–4 players (any army without a player
runs on a deterministic script), and equally playable on a kitchen table with a real
deck, pen and paper.

**No build step, no dependencies** — plain HTML/CSS/JS. Open `index.html` in a
browser, or host it with GitHub Pages.

## The game in one paragraph

Each suit is an army. You build fighting hosts by stacking up to three cards of your
suit into a single army whose strength is their sum: pips are soldiers, the Ace a
champion (11), the Jack a raider that snipes the weakest card out of an enemy stack —
or infiltrates a camp to strike a Banner or General — the Queen a banner (+2 to all
your battles) and the King a general (marches cost 1 less). Off-suit cards are
supply — a march costs one per card in the stack, so heavy hosts move slowly (too
much supply can be foraged: 2 supply → 1 card). Armies merge on the road and storm
Kartenburg: battles compare stack totals, defender wins ties, the winner loses its
weakest card as casualties, and a defender may commit one reserve card from hand
before any battle resolves. Kartenburg pays its holder +1 glory every turn and +2
when a season turns — the clock that punishes waiting for perfect cards. Captures
score 5, raids and defenses 1, and a repelled assault that still bloodies the
garrison pays the attacker +1 siege glory. Later seats start with extra cards or
banked supply to offset the first-mover advantage. Two seasons (each season ends
only when its final round completes, so every seat gets equal turns), most glory
wins.

Automated armies hold no hand: their turn is two card flips — own suit reinforces
their most forward army, anything else banks supply until the frontmost army can
afford to march. Fully deterministic, so at a real table any player can run them in
seconds (the supply bank is literally a face-up pile of cards).

## Pages

| Page | Purpose |
|------|---------|
| `index.html` | The game — a fullscreen app: title screen, main menu (New Game / Tutorial), an interactive tutorial that teaches by playing a scripted opening, in-game How to Play, hot-seat play for 1–4 players plus automated armies |
| `reference.html` | Printable one-page reference sheet for tabletop play (linked from the menu) |
| `game.html`, `rules.html` | Redirects into the app (kept for old links) |

## Presentation

Pixel art throughout, Balatro-inspired: every card is a hand-drawn low-res
bitmap sprite shown at exact integer upscales, headings are rendered in a
bitmap pixel font (with slowly waving letters on the menus), and a WebGL swirl
shader runs at low resolution behind the table. Living cards (idle sway + 3D
cursor tilt), flight trails, hitstop freeze-frames on captures, a count-up
final scoreboard, chronicle events that splash on screen as they happen (the
Chronicle panel keeps the full history), and generative WebAudio ambience and
sound effects with a mute toggle. During play the UI goes full screen,
console-style: a compact HUD, the board auto-scaled to the display, the hand as
a bottom bar, themed pixel-letter action banners (with a screen slash for
damage), and everything else — chronicle history, sound, fullscreen, rules —
tucked into a pause menu (Esc) and a chronicle drawer.

## Code layout

```
css/style.css   — all styling (incl. print styles for the reference sheet)
js/cards.js     — deck, suits, strengths, army names
js/engine.js    — pure game logic, no DOM (unit-testable in Node)
js/ui.js        — rendering, input, FX queue and sound for game.html
js/swirl.js     — WebGL pixel-swirl background (CSS fallback)
```

The engine has no DOM dependencies, so full games can be simulated headlessly in Node
for testing and balance work:

```js
const engine = require('./js/engine.js');
const state = engine.createGame(0); // 0 humans = four automated armies
while (!state.over) engine.npcFlip(state);
```

Human seats are driven with `engine.deployCard`, `engine.march`, `engine.raid`,
`engine.raidPost`, `engine.forage`, `engine.discardFromHand` and `engine.passTurn`;
pending defenses (reserve decisions) resolve via `engine.resolvePendingBattle`.

## Hosting on GitHub Pages

Settings → Pages → deploy from branch, root folder. The site is fully static.
