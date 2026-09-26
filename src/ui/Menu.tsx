import { useState } from 'react'
import { formatCredits } from './Hud.tsx'
import type { CameraView } from '../render/engineApi.ts'

interface MenuProps {
  /** A saved session exists (this run or a previous visit); shows "Continue" instead of "Play". */
  hasSave: boolean
  savedBankroll: number
  muted: boolean
  quickDeal: boolean
  cameraView: CameraView
  onPlay: () => void
  onToggleMute: () => void
  onToggleQuickDeal: () => void
  onCycleCamera: () => void
  onResetCredits: () => void
}

const CAMERA_LABEL: Record<CameraView, string> = { auto: 'Auto', seat: 'Seat', cards: 'Cards', overhead: 'Overhead' }

/** The fixed payout table for this table's rules (see `AGENTS.md`'s "Game rules (fixed)"). */
const PAYOUT_ROWS: { label: string; value: string }[] = [
  { label: 'Blackjack', value: '3 to 2' },
  { label: 'Win', value: '1 to 1' },
  { label: 'Insurance', value: '2 to 1' },
  { label: 'Push', value: 'Returns the bet' },
]

/** Six short lines covering the table's rules, shown under "How to play". */
const HOW_TO_LINES: string[] = [
  'Place chips on the circle, then deal. Blackjack pays 3 to 2.',
  'Hit, stand, double on any first two cards, or split equal pairs.',
  'Doubling deals one more card and ends the hand; split hands may double too.',
  'An ace up card offers insurance for half your bet, paying 2 to 1 against a dealer blackjack.',
  'The dealer stands on soft 17 and draws to 17 or higher.',
  'Six decks are shuffled fresh whenever the cut card is reached.',
]

/** One row of the keyboard legend, matching the bindings in `App.tsx`. */
const KEYBOARD_LEGEND: { label: string; keys: string }[] = [
  { label: 'Deal / Hit', keys: 'Space / Enter' },
  { label: 'Hit', keys: 'H' },
  { label: 'Stand', keys: 'S' },
  { label: 'Double', keys: 'D' },
  { label: 'Split', keys: 'P' },
  { label: 'Chip value', keys: '1 – 5' },
  { label: 'Add chip', keys: 'A' },
  { label: 'Undo', keys: 'Z / Backspace' },
  { label: 'Clear bet', keys: 'X / Delete' },
  { label: 'Rebet', keys: 'R' },
  { label: 'Double bet', keys: 'B' },
  { label: 'Insurance yes / no', keys: 'Y / N' },
  { label: 'Camera', keys: 'C' },
  { label: 'Quick deal', keys: 'Q' },
  { label: 'Mute', keys: 'M' },
  { label: 'Menu', keys: 'Esc' },
]

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

/**
 * The art-deco title screen: a docked panel on wide screens (so attract mode stays visible on
 * the table behind it) or a bottom sheet on phones. Play/Continue, an expandable how-to-play
 * with the payout table and keyboard legend, settings toggles, a reset-credits control with an
 * inline confirm, and the no-real-money footer.
 */
export default function Menu({
  hasSave,
  savedBankroll,
  muted,
  quickDeal,
  cameraView,
  onPlay,
  onToggleMute,
  onToggleQuickDeal,
  onCycleCamera,
  onResetCredits,
}: MenuProps) {
  const [howToOpen, setHowToOpen] = useState(false)
  const [confirmingReset, setConfirmingReset] = useState(false)

  function handleResetClick() {
    if (confirmingReset) {
      setConfirmingReset(false)
      onResetCredits()
    } else {
      setConfirmingReset(true)
    }
  }

  return (
    <div className="menu-screen">
      <div className="menu-panel felt-panel">
        <div className="menu-top-row">
          <div className="bulb-border">
            <h1 className="menu-title">Blackjack Royale</h1>
          </div>
        </div>
        <p className="menu-tagline">Six decks. Dealer stands on 17. Blackjack pays 3 to 2.</p>

        <button type="button" className="primary-button play-button" onClick={onPlay}>
          {hasSave ? `Continue — ${formatCredits(savedBankroll)} credits` : 'Play'}
        </button>

        <section className="panel-section">
          <button
            type="button"
            className="panel-heading panel-heading-toggle"
            aria-expanded={howToOpen}
            onClick={() => setHowToOpen((open) => !open)}
          >
            How to play {howToOpen ? '−' : '+'}
          </button>
          {howToOpen && (
            <div className="how-to-body">
              {HOW_TO_LINES.map((line) => (
                <p className="how-to-line" key={line}>
                  {line}
                </p>
              ))}
              <table className="payout-table">
                <tbody>
                  {PAYOUT_ROWS.map((row) => (
                    <tr key={row.label}>
                      <td className="payout-label">{row.label}</td>
                      <td className="payout-value">{row.value}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <dl className="legend-list pointer-only">
                {KEYBOARD_LEGEND.map((row) => (
                  <div className="legend-row" key={row.label}>
                    <dt>{row.label}</dt>
                    <dd>{row.keys}</dd>
                  </div>
                ))}
              </dl>
            </div>
          )}
        </section>

        <section className="panel-section" aria-label="Settings">
          <h2 className="panel-heading">Settings</h2>
          <div className="settings-row">
            <span className="settings-label">Quick deal</span>
            <button
              type="button"
              className="toggle-switch"
              role="switch"
              aria-checked={quickDeal}
              aria-label="Quick deal"
              onClick={onToggleQuickDeal}
            >
              <span className="toggle-knob" />
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-label">Sound</span>
            <button
              type="button"
              className="icon-button"
              aria-label={muted ? 'Unmute' : 'Mute'}
              onClick={onToggleMute}
            >
              {muted ? <MuteIcon /> : <UnmuteIcon />}
            </button>
          </div>
          <div className="settings-row">
            <span className="settings-label">Camera</span>
            <button type="button" className="secondary-button settings-camera" onClick={onCycleCamera}>
              {CAMERA_LABEL[cameraView]}
            </button>
          </div>
        </section>

        <section className="panel-section">
          {confirmingReset ? (
            <div className="reset-confirm-row">
              <span className="settings-label">Reset to 1,000 credits?</span>
              <button type="button" className="secondary-button" onClick={handleResetClick}>
                Confirm
              </button>
              <button type="button" className="secondary-button" onClick={() => setConfirmingReset(false)}>
                Cancel
              </button>
            </div>
          ) : (
            <button type="button" className="secondary-button" onClick={handleResetClick}>
              Reset credits
            </button>
          )}
        </section>

        <p className="menu-footer">Credits only. No real money.</p>
      </div>
    </div>
  )
}
