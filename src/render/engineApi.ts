import type {
  AvailableActions,
  Card,
  ChipValue,
  HandOutcome,
  HandStatus,
  PlayerAction,
  SessionPhase,
  SessionSave,
  SoundName,
} from '../game/types.ts'

/** One of the player's hands, as the HUD shows it. */
export interface HudHand {
  cards: Card[]
  total: number
  soft: boolean
  bet: number
  status: HandStatus
  outcome: HandOutcome | null
  /** The hand taking actions right now. */
  active: boolean
}

/** The dealer's hand, as the HUD shows it. The hole card is omitted until it is revealed. */
export interface HudDealer {
  cards: Card[]
  /** Total of the visible cards. */
  total: number
  soft: boolean
  holeHidden: boolean
}

/** The last round, as the HUD shows it. */
export interface HudResult {
  staked: number
  returned: number
  net: number
  outcome: HandOutcome
  /** A short line for the banner, e.g. `Blackjack!`, `Dealer busts`, `Push`. */
  headline: string
}

/** What the HUD shows. A new object is sent only when one of its fields changes. */
export interface HudSnapshot {
  phase: SessionPhase
  /** Credits not on the table. */
  bankroll: number
  /** Chips on the circle before the deal, or everything staked during the round. */
  bet: number
  selectedChip: ChipValue
  hands: HudHand[]
  dealer: HudDealer
  insuranceBet: number
  can: AvailableActions
  /** Basic-strategy advice for the active hand during 'player', for the hint button. */
  hint: PlayerAction | null
  /** Set while the result of the last round is showing, and until the next deal. */
  lastResult: HudResult | null
  /** Outcomes of past rounds, newest first, at most 20. */
  history: HandOutcome[]
  /** No credits left anywhere: the HUD offers a refill. */
  broke: boolean
  rounds: number
  /** Cards left in the shoe before the cut card, for the shoe meter. */
  shoeRemaining: number
}

export type EngineSound = SoundName

/** Callbacks from the 3D engine to the React shell. All are invoked on the main thread. */
export interface EngineEvents {
  onHud(snapshot: HudSnapshot): void
  /** A one-shot sound. `intensity` runs 0 to 1 and scales the volume of crowd sounds. */
  onSound(name: EngineSound, intensity: number): void
  /** A line for the dealer's call-out banner, e.g. `Insurance?` or `Dealer busts`. */
  onMessage(text: string, seconds: number): void
  /** Persist this. Sent when a round settles and on refill. */
  onSave(save: SessionSave): void
}

/** 'play' takes the player's bets. 'attract' plays basic strategy by itself with demo chips and fires no events. */
export type EngineMode = 'play' | 'attract'

/**
 * 'auto' follows the game: seated at the table while betting, closer over the cards while the
 * hand plays, then back. 'seat' is the seated view, 'cards' looks down over the player's cards
 * toward the dealer, and 'overhead' looks straight down on the whole table.
 */
export type CameraView = 'auto' | 'seat' | 'cards' | 'overhead'

/** Screen space covered by UI, in CSS pixels, measured in from each edge of the canvas. */
export interface ViewInsets {
  left: number
  top: number
  right: number
  bottom: number
}

export interface EngineApi {
  /** Starts taking bets in 'play' mode from a saved session, or a fresh 1,000-credit bankroll for `null`. */
  startSession(save: SessionSave | null): void
  /** Leaves 'play' mode (chips on the circle go back to the bankroll first) and runs the attract mode. */
  showAttract(): void
  selectChip(value: ChipValue): void
  /** Adds the selected chip to the betting circle, as a tap on the circle does. */
  addChip(): void
  undo(): void
  clearBet(): void
  rebet(): void
  doubleBet(): void
  deal(): void
  hit(): void
  stand(): void
  double(): void
  split(): void
  /** Answers the insurance offer. */
  insurance(take: boolean): void
  /** Resets a broke bankroll to 1,000 credits. */
  refill(): void
  setCameraView(view: CameraView): void
  /** Deals and flips at double speed. The cards do not change. */
  setQuickDeal(on: boolean): void
  /** Keeps the table clear of the part of the canvas the UI covers. */
  setViewInsets(insets: ViewInsets): void
  /** Freezes the animations and the clocks. The scene keeps rendering. */
  setPaused(paused: boolean): void
  /** Re-reads the canvas size. The engine also observes its canvas, so this is rarely needed. */
  resize(): void
  dispose(): void
}
