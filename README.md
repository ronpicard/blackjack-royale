# Blackjack Royale

Blackjack Royale is a 3D blackjack table that runs in the browser: a felt half-moon table with a padded rail, a card shoe and discard tray, and a chip tray along the dealer's edge, in a dim casino among slot machines, chandeliers and marquee lights. The cards are dealt one at a time from the shoe, the dealer peeks under an ace or a ten, and a crowd of spectators watches every hand, cheers your wins under a shower of confetti, and groans at your losses. Play the [live demo](https://ronpicard.github.io/blackjack-royale/) — it works on both phones and desktops.

It plays for credits only. There is no real money, no purchases, and nothing to win.

## How to play

- Pick a chip from the rack (1, 5, 25, 100 or 500 credits) and click or tap the betting circle to bet. `UNDO`, `CLEAR`, `REBET` (the last hand's bet) and `×2` (double the circle) do what they say.
- Press `DEAL` once your bet is down. Two cards are dealt to you and two to the dealer, the dealer's second card face down.
- If the dealer shows an ace and you can afford it, you're offered insurance for half your bet; it pays 2 to 1 if the dealer has blackjack. The dealer then peeks under an ace or a ten-value card, and a dealer blackjack ends the round at once.
- On your turn, `HIT`, `STAND`, `DOUBLE` (one more card, hand ends) or `SPLIT` (equal-rank pairs, up to four hands; split aces get one card each). A `HINT` toggle marks the basic-strategy play with a gold glow.
- The dealer stands on soft 17 and draws to 17 or higher, then every hand is settled: blackjack pays 3 to 2, an ordinary win pays even money, and a push returns your bet.
- The spectators cheer a win, louder for blackjack or a big win, and groan at a loss. They stay quiet on a push.
- You start with 1,000 credits, and your credits and history are kept in your browser. If you run out, the table offers a refill.
- The camera follows the game by default: seated at the table while you bet, in close over the cards while the hand plays. The camera button or `C` cycles it with three fixed views: seated, over the cards, and straight down on the table.
- Quick deal deals and flips at double speed. The cards do not change.
- While the menu is up, the table plays itself with basic strategy.

### Keyboard

| Key | Action |
| --- | --- |
| `Space` or `Enter` | Deal, or hit once a hand is in play |
| `H` | Hit |
| `S` | Stand |
| `D` | Double |
| `P` | Split |
| `1` to `5` | Select the 1, 5, 25, 100 or 500 chip |
| `A` | Add the selected chip to the circle |
| `Z` or `Backspace` | Undo |
| `X` or `Delete` | Clear the bet |
| `R` | Rebet |
| `B` | Double the bet |
| `Y` | Take insurance |
| `N` | Decline insurance |
| `C` | Change camera |
| `Q` | Quick deal |
| `M` | Mute |
| `Escape` | Menu |

## The rules

| Rule | Detail |
| --- | --- |
| Decks | Six decks (312 cards), reshuffled when fewer than 78 cards remain |
| Dealer | Stands on soft 17, peeks for blackjack under an ace or a ten |
| Blackjack | A natural 21 on the first two cards of an unsplit hand, pays 3 to 2 |
| Double | On any first two cards, including after a split; one card, hand ends |
| Split | Any equal-rank pair (a 10, J, Q or K counts as a pair of tens), up to four hands; split aces get one card each and cannot be re-split or hit |
| Insurance | Offered when the dealer's up card is an ace; costs half the main bet, pays 2 to 1 |
| Push | Equal totals, or a dealer blackjack against a player blackjack, return the bet |
| Table | Minimum bet 5, maximum 500 on the circle (a double or split may exceed it) |

The house edge is about 0.5% against basic strategy, the play the `HINT` button and the attract mode both follow.

## The shoe

Six decks are shuffled together and dealt down to a cut card 78 cards from the bottom, then reshuffled before the next round. Every shuffle is deterministic: given the same seed, the same cards come out in the same order every time. To see the numbers yourself:

```bash
npm run simulate -- 20000
```

This plays the given number of rounds with basic strategy at a flat bet through the real game rules and prints the rounds and hands played, the win/push/loss rates, the blackjack rate, how often doubles and splits were taken, and the realised return per credit staked (expect about −0.5% ± 1%).

## Settings

- Mute the sound.
- Quick deal, which deals and flips at double speed without changing the cards.
- Camera view: auto, seated, over the cards, or overhead.
- Reset credits, with a confirmation, back to 1,000.

## Development

Requires Node >= 22.12.

Everything under `src/game/` is framework-free — no DOM, no three.js, and no non-deterministic calls like `Math.random` or `Date` — so `npm test` runs directly in Node without spinning up a browser.

| Command | Purpose |
| --- | --- |
| `npm install` | Install dependencies |
| `npm run dev` | Start the dev server |
| `npm test` | Run the card, strategy, session and crowd tests |
| `npm run simulate` | Play rounds headlessly with basic strategy and report the return |
| `npm run build` | Type-check and build for production |
| `npm run preview` | Preview the production build locally |

Add `?quality=high` or `?quality=low` to the address to pin the rendering cost; otherwise the engine steps it down by itself when frames stay slow.

## Deployment

Pushes to `main` run a GitHub Actions workflow that installs dependencies, runs the test suite, builds the production bundle, and publishes the `dist` output to GitHub Pages.

## License

[MIT](LICENSE)
