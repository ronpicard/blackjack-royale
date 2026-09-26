import { useEffect, useRef, useState } from 'react'
import { formatCredits } from './Hud.tsx'
import type { HandOutcome } from '../game/types.ts'
import type { HudSnapshot } from '../render/engineApi.ts'

interface ResultBannerProps {
  hud: HudSnapshot | null
  /** The dealer's call-out line, e.g. `Insurance?` or `Dealer busts`, already timed by `App`. */
  message: string | null
}

const RESULT_VISIBLE_MS = 3500

/** A bust settles like a loss for colouring purposes: there is no separate `hud-outcome-bust` rule. */
function outcomeClass(outcome: HandOutcome): string {
  return outcome === 'bust' ? 'hud-outcome-lose' : `hud-outcome-${outcome}`
}

/**
 * Two transient lines above the felt: a small elegant call-out (`message`, from the engine's
 * `onMessage`) and, when a round just settled, the headline (`Blackjack!`, `Dealer busts`, ...)
 * with the net credits won or lost. The banner fades out on its own timer after about 3.5s; the
 * call-out's timing is owned by `App` (it already knows the duration from `onMessage`).
 */
export default function ResultBanner({ hud, message }: ResultBannerProps) {
  const [visible, setVisible] = useState(false)
  const prevRoundsRef = useRef<number | null>(null)
  const timerRef = useRef<number | undefined>(undefined)

  useEffect(() => {
    if (!hud) return
    const prevRounds = prevRoundsRef.current
    prevRoundsRef.current = hud.rounds
    if (prevRounds !== null && hud.rounds !== prevRounds && hud.lastResult) {
      setVisible(true)
      window.clearTimeout(timerRef.current)
      timerRef.current = window.setTimeout(() => setVisible(false), RESULT_VISIBLE_MS)
    }
  }, [hud])

  useEffect(() => () => window.clearTimeout(timerRef.current), [])

  const result = hud?.lastResult ?? null

  return (
    <>
      {message && (
        <div className="callout-banner" role="status" aria-live="polite">
          {message}
        </div>
      )}

      {result && (
        <div
          className={`result-banner${visible ? ' result-banner-visible' : ''}`}
          aria-hidden={!visible}
        >
          <span className="result-headline">{result.headline}</span>
          {result.net > 0 ? (
            <span className="result-win-line">+{formatCredits(result.net)}</span>
          ) : result.net < 0 ? (
            <span className={outcomeClass(result.outcome)}>{formatCredits(result.net)}</span>
          ) : (
            <span className="hud-outcome-push">Push</span>
          )}
        </div>
      )}
    </>
  )
}
