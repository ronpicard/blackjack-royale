/**
 * How the spectators around the table react to a settled round. Pure function of a `RoundResult`,
 * so the engine, the crowd view and the audio all agree.
 */

import type { RoundResult } from './types.ts'
import { isBigWin } from './session.ts'

export type CrowdReactionKind = 'cheer' | 'groan'

export interface CrowdReaction {
  kind: CrowdReactionKind
  /** 0 to 1: how many spectators join in and how loudly. */
  strength: number
}

/** A round losing this much or more of the stake draws the loudest groan. */
export const BIG_LOSS_STAKE = 500
/** A round that returns some but not all of the stake (a partial loss, split hands) draws this soft groan. */
export const PARTIAL_LOSS_STRENGTH = 0.3
const MIN_CHEER_STRENGTH = 0.35
const MIN_GROAN_STRENGTH = 0.5

const clamp01 = (value: number): number => Math.min(1, Math.max(0, value))

/**
 * The crowd cheers a net win (loudest for a blackjack or a big win) and groans at a net loss, soft
 * when some hand still won or pushed. There is no reaction when nothing was staked, or the round
 * broke exactly even.
 */
export function crowdReaction(result: RoundResult | null): CrowdReaction | null {
  if (!result || result.staked <= 0) return null
  const { staked, net } = result

  const isBlackjack = result.hands.some((hand) => hand.outcome === 'blackjack')
  if (isBlackjack || isBigWin(net)) return { kind: 'cheer', strength: 1 }

  if (net > 0) {
    return { kind: 'cheer', strength: MIN_CHEER_STRENGTH + (1 - MIN_CHEER_STRENGTH) * clamp01(net / (2 * staked)) }
  }
  if (net === 0) return null

  const partialLoss = result.hands.some((hand) => hand.outcome === 'win' || hand.outcome === 'push')
  if (partialLoss) return { kind: 'groan', strength: PARTIAL_LOSS_STRENGTH }
  return { kind: 'groan', strength: MIN_GROAN_STRENGTH + (1 - MIN_GROAN_STRENGTH) * clamp01(staked / BIG_LOSS_STAKE) }
}
