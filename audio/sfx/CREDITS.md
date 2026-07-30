# Sound effects — CC0 1.0

Every file in this folder comes from the **uisfx** library
(<https://uisfx.com>, npm package `uisfx`, source <https://github.com/romainsimon/uisfx>),
"Mechanical" theme.

The library's `LICENSE-AUDIO` dedicates the audio to the public domain:

> The audio files under `sounds/` are dedicated to the public domain under the
> Creative Commons CC0 1.0 Universal Public Domain Dedication.
>
> You may copy, modify, distribute, and use these files, including commercially,
> without asking permission. Attribution is appreciated but not required.
>
> SPDX identifier: CC0-1.0

Attribution is not required; this file is here because it is deserved, and so
the provenance of every asset in the repository is recorded.

## Which sound came from which

Files are renamed to the moment they play, not the sound they are. To swap one
out, drop a replacement MP3 over the file of the same name — the game loads by
name and needs no code change. A missing or unplayable file falls back to the
built-in WebAudio synth, so the game is never silent.

| Ours | uisfx (mechanical) | Plays when |
|------|--------------------|------------|
| `card-draw` | `swipe` | a card leaves the draw pile |
| `card-flip` | `snap` | that card flips face up |
| `card-place` | `drop` | a card lands on a slot or post |
| `card-discard` | `delete` | a card is thrown on the heap |
| `supply-spend` | `deselect` | supply is burned to pay a march |
| `deck-shuffle` | `reorder` | the season turns and discards reshuffle |
| `march-step` | `progress-step` | an army advances one space |
| `army-merge` | `connect` | two of your armies join |
| `muster` | `add-to-cart` | a new army forms in camp |
| `banner-raise` | `toggle-on` | the Queen takes her post |
| `general-command` | `badge` | the King takes command |
| `gate-reached` | `checkpoint` | an army arrives at the gate |
| `assault-charge` | `forward` | the assault begins |
| `duel-tick` | `typing` | each card totals up in the cascade (pitch rises) |
| `clash` | `blocked` | the totals resolve |
| `walls-breached` | `level-up` | the attacker wins |
| `repelled` | `invalid-drop` | the assault breaks |
| `casualty` | `remove-from-cart` | the winner buries its weakest card |
| `raid-ride` | `send` | a Jack rides out |
| `raid-strike` | `double-click` | the raid connects |
| `to-arms` | `warning` | you may commit a reserve |
| `reserve-commit` | `lock` | the reserve joins the line |
| `glory-coin` | `coupon` | a glory chip flies to the lane score |
| `tribute` | `receive` | Kartenburg pays its holder |
| `capture-fanfare` | `achievement` | Kartenburg falls |
| `crown-endures` | `streak` | you hold the city through a season |
| `banner-lower` | `collapse` | the old colors come down |
| `banner-hoist` | `expand` | the new colors go up |
| `season-turn` | `wake` | a new season begins |
| `war-end` | `complete` | the final scoreboard opens |
| `score-tick` | `check` | the final tally counts up |
| `menu-move` | `hover` | the focus ring moves |
| `menu-select` | `select` | a button is chosen |
| `menu-back` | `back` | you back out of a screen |
| `game-start` | `start` | the title screen is tapped |
| `sheet-open` | `open` | an action sheet slides up |
| `sheet-close` | `close` | it slides away |
| `denied` | `error` | an illegal action is refused |
| `tutorial-advance` | `info` | a tutorial step completes |
