/**
 * Attract-mode demo play: a deterministic bet size for a seeded rng and the demo bankroll, and the
 * action the demo takes at the table (always basic strategy, always declining insurance).
 */

import type { PlayerAction, Session } from './types.ts'
import { TABLE_MIN_BET, hintFor } from './session.ts'

/** Attract mode only ever draws these three denominations, smallest first. */
const DEMO_CHIP_VALUES: readonly number[] = [5, 25, 100]

/** A deterministic demo bet: one of 5, 25 or 100, never more than `bankroll`, else 0. */
export function attractBet(rng: () => number, bankroll: number): number {
  const affordable = DEMO_CHIP_VALUES.filter((value) => value >= TABLE_MIN_BET && value <= bankroll)
  if (affordable.length === 0) return 0
  return affordable[Math.floor(rng() * affordable.length)]!
}

/** The demo's action: always declines insurance, otherwise plays the hinted basic-strategy move. */
export function attractAction(s: Session): PlayerAction | boolean {
  if (s.phase === 'insurance') return false
  if (s.phase === 'player') return hintFor(s) ?? false
  return false
}
