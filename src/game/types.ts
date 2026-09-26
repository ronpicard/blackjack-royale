/**
 * Shared types for Blackjack Royale's game logic (`src/game/`). Everything here is plain data:
 * no classes, no three.js, no DOM, so the rules can run under `node --test` and in the browser
 * alike, and a session can be serialised as JSON.
 *
 * Rules (see `rules.ts` for the constants): six decks, dealer stands on soft 17, blackjack pays
 * 3 to 2, double on any two cards, double after split, split up to four hands, split aces get one
 * card each, insurance pays 2 to 1, the dealer peeks for blackjack under a ten or an ace.
 */

export type Suit = 'S' | 'H' | 'D' | 'C'

export type Rank = 'A' | '2' | '3' | '4' | '5' | '6' | '7' | '8' | '9' | '10' | 'J' | 'Q' | 'K'

export interface Card {
  rank: Rank
  suit: Suit
}

export type ChipValue = 1 | 5 | 25 | 100 | 500

/**
 * 'betting': chips go on the circle. 'insurance': the dealer shows an ace and the player answers.
 * 'player': the active hand takes actions. 'dealer': the dealer's hand is being played out and
 * the hands settled (the engine animates the commands of this phase). 'result': the round is
 * over and the outcome is showing; any bet action or `beginBetting` starts the next round.
 */
export type SessionPhase = 'betting' | 'insurance' | 'player' | 'dealer' | 'result'

/** What a settled hand did. 'blackjack' is a natural 21 that beat the dealer (paid 3 to 2). */
export type HandOutcome = 'blackjack' | 'win' | 'push' | 'lose' | 'bust'

export type HandStatus = 'playing' | 'stood' | 'bust' | 'blackjack'

export interface Hand {
  cards: Card[]
  /** Credits staked on this hand (doubled after a double down). */
  bet: number
  status: HandStatus
  doubled: boolean
  /** Made by a split; a natural 21 here is an ordinary 21, not a blackjack. */
  fromSplit: boolean
  /** A split ace: one card only, no further action. */
  splitAces: boolean
  /** Set when the hand is settled. */
  outcome: HandOutcome | null
  /** Stake plus winnings handed back at settlement, 0 for a lost hand. Set with `outcome`. */
  returned: number
}

export interface HandValue {
  /** Best total not over 21 when an ace can count 11, else the hard total. */
  total: number
  /** True when an ace is counting as 11. */
  soft: boolean
}

export type PlayerAction = 'hit' | 'stand' | 'double' | 'split'

/** What the player may do with the active hand, or with the bet during 'betting'/'result'. */
export interface AvailableActions {
  deal: boolean
  hit: boolean
  stand: boolean
  double: boolean
  split: boolean
  /** Insurance is being offered (phase 'insurance'). The player can afford it when true. */
  insurance: boolean
  undo: boolean
  clear: boolean
  rebet: boolean
  doubleBet: boolean
}

export interface RoundResult {
  /** Everything staked this round: every hand's bet plus insurance. */
  staked: number
  /** Everything handed back: every hand's `returned` plus the insurance payout. */
  returned: number
  net: number
  /** The outcome of the first hand, which the history strip shows. */
  outcome: HandOutcome
  hands: { outcome: HandOutcome; total: number; bet: number; returned: number }[]
  dealerTotal: number
  dealerBlackjack: boolean
  /** Insurance was taken and paid (dealer had blackjack). */
  insuranceWon: boolean
}

export interface SessionStats {
  rounds: number
  handsWon: number
  handsLost: number
  handsPushed: number
  blackjacks: number
  biggestWin: number
  peakBankroll: number
}

export interface Session {
  phase: SessionPhase
  /** Credits not on the table. */
  bankroll: number
  /** Chips on the betting circle, before the deal. Moved into `hands[0].bet` by `deal`. */
  bet: number
  /** Chip placements this round, newest last, for undo during 'betting'. */
  undo: ChipValue[]
  /** The main bet of the last round, for rebet. */
  lastBet: number | null
  /** Cards still to deal, next card first. Rebuilt and reshuffled when the cut card is reached. */
  shoe: Card[]
  /** Cards dealt since the last shuffle, for the discard tray. */
  discards: number
  /** Number of shuffles this session; also the seed offset for the next shuffle. */
  shuffles: number
  /** The player's hands, left to right. Empty during 'betting'. */
  hands: Hand[]
  /** Index of the hand taking actions during 'player'. */
  activeHand: number
  dealer: {
    cards: Card[]
    /** False while the second card is face down. */
    holeRevealed: boolean
  }
  /** Insurance bet placed this round, 0 when declined or not offered. */
  insurance: number
  lastResult: RoundResult | null
  /** Outcomes of past rounds, newest first, at most `HISTORY_LENGTH` (in `session.ts`). */
  history: HandOutcome[]
  stats: SessionStats
}

/** What persists between visits. The shoe is not saved: a new visit starts from a fresh shuffle. */
export interface SessionSave {
  version: 1
  bankroll: number
  history: HandOutcome[]
  stats: SessionStats
}

export type SoundName =
  | 'chip'
  | 'chipRemove'
  | 'clear'
  | 'shuffle'
  | 'deal'
  | 'flip'
  | 'hit'
  | 'stand'
  | 'bust'
  | 'win'
  | 'bigWin'
  | 'blackjack'
  | 'push'
  | 'lose'
  | 'insurance'
  | 'cheer'
  | 'groan'
  | 'refill'

/**
 * What the engine must show, in order, after a rules function runs. `deal` and `reveal` are
 * animated one after another; the rest are instant. `to` is a hand index or 'dealer'.
 */
export type Command =
  | { type: 'shuffle' }
  | { type: 'deal'; to: number | 'dealer'; card: Card; faceDown: boolean }
  | { type: 'reveal'; card: Card }
  | { type: 'split'; hand: number }
  | { type: 'double'; hand: number }
  | { type: 'bust'; hand: number | 'dealer' }
  | { type: 'insurance'; won: boolean; returned: number }
  | { type: 'settle'; hand: number; outcome: HandOutcome; returned: number }
  | { type: 'sound'; name: SoundName }
  | { type: 'message'; text: string; seconds: number }
  /** Save the session to storage now. */
  | { type: 'save' }

export interface Transition {
  session: Session
  commands: Command[]
}
