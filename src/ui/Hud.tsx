import { useEffect, useState } from 'react'
import { CUT_CARD_REMAINING } from '../game/cards.ts'
import type { ChipValue, HandOutcome } from '../game/types.ts'
import type { CameraView, HudSnapshot } from '../render/engineApi.ts'
import CardOverlay from './CardOverlay.tsx'

interface HudProps {
  /** Null until the engine's first snapshot arrives after `startSession()`. */
  hud: HudSnapshot | null
  selectedChip: ChipValue
  cameraView: CameraView
  quickDeal: boolean
  muted: boolean
  onSelectChip: (value: ChipValue) => void
  onDeal: () => void
  onHit: () => void
  onStand: () => void
  onDouble: () => void
  onSplit: () => void
  onInsurance: (take: boolean) => void
  onUndo: () => void
  onClear: () => void
  onRebet: () => void
  onDoubleBet: () => void
  onDealAgain: () => void
  onNewBet: () => void
  onRefill: () => void
  onCycleCamera: () => void
  onToggleQuickDeal: () => void
  onToggleMute: () => void
  onOpenMenu: () => void
}

const CAMERA_LABEL: Record<CameraView, string> = { auto: 'Auto', seat: 'Seat', cards: 'Cards', overhead: 'Overhead' }

const CHIP_VALUES: readonly ChipValue[] = [1, 5, 25, 100, 500]

/** A full six-deck shoe minus the cut card: the shoe meter's full scale. */
const SHOE_METER_MAX = 312 - CUT_CARD_REMAINING

/** Short disc label per outcome for the history strip. */
const HISTORY_LABEL: Record<HandOutcome, string> = {
  blackjack: 'BJ',
  win: 'W',
  push: 'P',
  lose: 'L',
  bust: 'L',
}

/** A bust settles like a loss for colouring purposes: there is no separate `hud-outcome-bust` rule. */
function outcomeClass(outcome: HandOutcome): string {
  return outcome === 'bust' ? 'hud-outcome-lose' : `hud-outcome-${outcome}`
}

/** Formats credits with thousands separators, e.g. `1,250`. */
export function formatCredits(amount: number): string {
  return Math.round(amount).toLocaleString('en-US')
}

function CameraIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 8h3l1.5-2h7L17 8h3v11H4Z" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinejoin="round" />
      <circle cx="12" cy="13.5" r="3.2" fill="none" stroke="currentColor" strokeWidth="1.6" />
    </svg>
  )
}

function QuickDealIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M5 5v14l9-7Z" fill="currentColor" />
      <path d="M13 5v14l9-7Z" fill="currentColor" opacity="0.6" />
    </svg>
  )
}

function MuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path d="m16 9 5 6M21 9l-5 6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

function UnmuteIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 9v6h4l5 4V5L8 9H4Z" fill="currentColor" />
      <path
        d="M16.5 8.5a5 5 0 0 1 0 7M19 6a8.5 8.5 0 0 1 0 12"
        fill="none"
        stroke="currentColor"
        strokeWidth="1.8"
        strokeLinecap="round"
      />
    </svg>
  )
}

function MenuIcon() {
  return (
    <svg viewBox="0 0 24 24" width="1em" height="1em" aria-hidden="true">
      <path d="M4 6h16M4 12h16M4 18h16" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

/** Chip face colours, matching the felt chips (`chipTextures.ts`) and a real casino rack. */
const CHIP_COLOR: Record<ChipValue, string> = {
  1: 'chip-white',
  5: 'chip-red',
  25: 'chip-green',
  100: 'chip-black',
  500: 'chip-purple',
}

/**
 * The in-play chrome: bankroll/bet/dealer/hand pills, the history strip, the chip rack, phase-
 * specific action buttons, a hint toggle, the shoe meter, a hover tip over the felt, and the
 * broke overlay. Stays clear of the table's centre and respects safe-area insets; `App` measures
 * this bar's own footprint with `ResizeObserver` to report `setViewInsets` back to the engine.
 */
export default function Hud({
  hud,
  selectedChip,
  cameraView,
  quickDeal,
  muted,
  onSelectChip,
  onDeal,
  onHit,
  onStand,
  onDouble,
  onSplit,
  onInsurance,
  onUndo,
  onClear,
  onRebet,
  onDoubleBet,
  onDealAgain,
  onNewBet,
  onRefill,
  onCycleCamera,
  onToggleQuickDeal,
  onToggleMute,
  onOpenMenu,
}: HudProps) {
  // The touch hint below the chip rack shows only until the player has placed their first chip,
  // ever — a returning player (one with round history already) never sees it.
  const [everPlacedChip, setEverPlacedChip] = useState(() => (hud?.history.length ?? 0) > 0)
  useEffect(() => {
    if (hud && (hud.bet > 0 || hud.can.undo)) setEverPlacedChip(true)
  }, [hud])

  // Purely a local display toggle: it is not persisted, and `hintFor` already recomputes for free.
  const [hintOn, setHintOn] = useState(false)

  const phase = hud?.phase ?? 'betting'
  const history = hud?.history ?? []
  const shoeFraction = Math.min(1, Math.max(0, (hud?.shoeRemaining ?? 0) / SHOE_METER_MAX))

  function hintClass(action: 'hit' | 'stand' | 'double' | 'split'): string {
    return hintOn && hud?.hint === action ? ' hint-glow' : ''
  }

  return (
    <>
      <div className="hud-top-bar felt-panel">
        <div className="hud-pill-row">
          <div className="hud-pill">
            <span className="hud-pill-label">Bankroll</span>
            <span className="hud-pill-value">{formatCredits(hud?.bankroll ?? 0)}</span>
          </div>
          <div className="hud-pill">
            <span className="hud-pill-label">Bet</span>
            <span className="hud-pill-value">{formatCredits(hud?.bet ?? 0)}</span>
          </div>
          <div className="hud-pill">
            <span className="hud-pill-label">Dealer</span>
            <span className="hud-pill-value">
              {hud ? `${hud.dealer.total}${hud.dealer.holeHidden ? ' + ?' : ''}` : '—'}
            </span>
          </div>
          {hud?.hands.map((hand, i) => (
            <div
              key={i}
              className={`hud-pill hud-hand-pill${hand.active ? ' hud-hand-active' : ''}${
                hand.outcome ? ` ${outcomeClass(hand.outcome)}` : ''
              }`}
            >
              <span className="hud-pill-label">Hand {i + 1}</span>
              <span className="hud-pill-value">
                {hand.total}
                {hand.soft ? ' soft' : ''}
                {hand.outcome ? ` · ${hand.outcome.toUpperCase()}` : ''}
              </span>
            </div>
          ))}
        </div>

        <div className="hud-actions">
          <button
            type="button"
            className="icon-button"
            aria-label={`Camera view: ${CAMERA_LABEL[cameraView]}. Change view`}
            onClick={onCycleCamera}
          >
            <CameraIcon />
            <span className="icon-button-caption">{CAMERA_LABEL[cameraView]}</span>
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label="Quick deal"
            aria-pressed={quickDeal}
            onClick={onToggleQuickDeal}
          >
            <QuickDealIcon />
          </button>
          <button
            type="button"
            className="icon-button"
            aria-label={muted ? 'Unmute' : 'Mute'}
            onClick={onToggleMute}
          >
            {muted ? <MuteIcon /> : <UnmuteIcon />}
          </button>
          <button type="button" className="icon-button" aria-label="Menu" onClick={onOpenMenu}>
            <MenuIcon />
          </button>
        </div>
      </div>

      <CardOverlay hud={hud} />

      {history.length > 0 && (
        <div className="hud-history-strip" aria-label="Recent outcomes">
          {history.map((outcome, i) => (
            <span
              key={i}
              className={`hud-history-disc ${outcomeClass(outcome)}${i === 0 ? ' hud-history-disc-newest' : ''}`}
            >
              {HISTORY_LABEL[outcome]}
            </span>
          ))}
        </div>
      )}

      <div className="hud-bottom-bar felt-panel">
        {!everPlacedChip && phase === 'betting' && (
          <div className="hud-hover-tip touch-only">Tap the felt to bet · hold a stack to remove it</div>
        )}

        <div className="hud-bottom-row">
          <div className="hud-chip-rack" role="radiogroup" aria-label="Chip value">
            {CHIP_VALUES.map((value) => (
              <button
                key={value}
                type="button"
                className={`chip ${CHIP_COLOR[value]}${value === selectedChip ? ' chip-selected' : ''}`}
                role="radio"
                aria-checked={value === selectedChip}
                aria-label={`${value} credit chip`}
                onClick={() => onSelectChip(value)}
              >
                <span className="chip-face">
                  <span className="chip-value">{value}</span>
                </span>
              </button>
            ))}
          </div>

          <div className="hud-action-buttons">
            {phase === 'betting' && (
              <>
                <button type="button" className="secondary-button" disabled={!hud?.can.undo} onClick={onUndo}>
                  Undo
                </button>
                <button type="button" className="secondary-button" disabled={!hud?.can.clear} onClick={onClear}>
                  Clear
                </button>
                <button type="button" className="secondary-button" disabled={!hud?.can.rebet} onClick={onRebet}>
                  Rebet
                </button>
                <button type="button" className="secondary-button" disabled={!hud?.can.doubleBet} onClick={onDoubleBet}>
                  &times;2
                </button>
                <button type="button" className="spin-button" disabled={!hud?.can.deal} onClick={onDeal}>
                  Deal
                </button>
              </>
            )}

            {phase === 'player' && (
              <>
                <button
                  type="button"
                  className="secondary-button"
                  aria-pressed={hintOn}
                  onClick={() => setHintOn((on) => !on)}
                >
                  Hint
                </button>
                <button
                  type="button"
                  className={`secondary-button${hintClass('hit')}`}
                  disabled={!hud?.can.hit}
                  onClick={onHit}
                >
                  Hit
                </button>
                <button
                  type="button"
                  className={`secondary-button${hintClass('stand')}`}
                  disabled={!hud?.can.stand}
                  onClick={onStand}
                >
                  Stand
                </button>
                <button
                  type="button"
                  className={`secondary-button${hintClass('double')}`}
                  disabled={!hud?.can.double}
                  onClick={onDouble}
                >
                  Double
                </button>
                <button
                  type="button"
                  className={`secondary-button${hintClass('split')}`}
                  disabled={!hud?.can.split}
                  onClick={onSplit}
                >
                  Split
                </button>
              </>
            )}

            {phase === 'insurance' && (
              <div className="insurance-row">
                <button type="button" className="secondary-button" onClick={() => onInsurance(false)}>
                  No insurance
                </button>
                <button type="button" className="primary-button" onClick={() => onInsurance(true)}>
                  Insurance
                </button>
              </div>
            )}

            {phase === 'result' && (
              <>
                <button type="button" className="secondary-button" onClick={onNewBet}>
                  New bet
                </button>
                <button type="button" className="spin-button" disabled={!hud?.can.rebet} onClick={onDealAgain}>
                  Deal again
                </button>
              </>
            )}
          </div>
        </div>

        <div className="shoe-meter" aria-label="Cards remaining before the cut card">
          <div className="shoe-meter-fill" style={{ width: `${Math.round(shoeFraction * 100)}%` }} />
        </div>
      </div>

      {hud?.broke && (
        <div className="modal-backdrop">
          <div className="broke-card felt-panel" role="dialog" aria-modal="true" aria-label="Out of credits">
            <h2 className="broke-title">Out of credits</h2>
            <button type="button" className="primary-button" onClick={onRefill}>
              Refill 1,000 credits
            </button>
          </div>
        </div>
      )}
    </>
  )
}
