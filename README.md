# 🃏 Kartenburg

A war game for **one regular 52-card deck**: the four realms of
the deck converge on Kartenburg, the castle of cards, to capture and hold it. Playable in the browser for 1–4 players (any army without a player
runs on a deterministic script), and equally playable on a kitchen table with a real
deck, pen and paper.

**No build step, no dependencies** — plain HTML/CSS/JS (one bundled OFL pixel
font, fully offline). Open `index.html` in a browser, or host it with GitHub Pages.

## The game in one paragraph

Each suit is an army. You build fighting hosts by stacking up to three cards of your
suit into a single army whose strength is their sum: pips are soldiers, the Ace a
champion (11), the Jack a raider that snipes the weakest card out of an enemy stack —
or infiltrates a camp to strike a Banner or General — the Queen a banner (+2 to all
your battles) and the King a general (marches cost 1 less). Off-suit cards are
supply — a march costs one per card in the stack, so heavy hosts move slowly (too
much supply can be traded away: 2 supply → 1 card). Armies merge on the road and storm
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
tucked into a pause menu (Esc) and a chronicle drawer. Menus follow console
(10-foot) rules: flat pixel chrome, one primary action per screen, a single
always-visible focus ring driven by arrow keys, Enter/Esc or a connected
gamepad (d-pad/stick, A select, B back), and a standing hint bar that says
which buttons do what. The game view is a single interaction-first **lane
board** on every screen (phone-shaped and centered on desktop): Kartenburg as
a status strip on top, four vertical lanes beneath it with each army's glory
at the lane's head, real card stacks climbing the slots toward the city, held
hands fanned at the lane's foot, action dialogs as thumb-reach bottom sheets,
a live ticker narrating the automated armies' turns, and the deck / discard
piles stepping to center stage whenever cards are drawn or thrown away.

## Code layout

```
css/style.css   — all styling (incl. print styles for the reference sheet)
js/cards.js     — deck, suits, strengths, army names
js/engine.js    — pure game logic, no DOM (unit-testable in Node)
js/ui.js        — rendering, input, FX queue and sound for game.html
js/consoleui.js — focus-driven menu navigation (keyboard + gamepad) and hint bar
js/swirl.js     — WebGL pixel-swirl background (CSS fallback)
fonts/          — bundled Press Start 2P (latin subset, SIL OFL) — the one in-game text face
```

The engine has no DOM dependencies, so full games can be simulated headlessly in Node
for testing and balance work:

```js
const engine = require('./js/engine.js');
const state = engine.createGame(0); // 0 humans = four automated armies
while (!state.over) engine.npcFlip(state);
```

Human seats are driven with `engine.deployCard`, `engine.march`, `engine.raid`,
`engine.raidPost`, `engine.trade`, `engine.discardFromHand` and `engine.passTurn`;
pending defenses (reserve decisions) resolve via `engine.resolvePendingBattle`.

## Hosting on GitHub Pages

Settings → Pages → deploy from branch, root folder. The site is fully static.
