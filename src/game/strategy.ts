/**
 * Standard S17 multi-deck basic strategy: the mathematically optimal action for any hand, used
 * both for the HUD's hint and for `scripts/simulate.ts`'s house-edge check. Pure function of the
 * hand, the dealer's up card, and whether doubling/splitting is currently allowed.
 */

import type { Card, PlayerAction } from './types.ts'
import { cardValue, handValue, isPair } from './cards.ts'

function inRange(value: number, lo: number, hi: number): boolean {
  return value >= lo && value <= hi
}

/** Whether a pair of this value (2-9, 11 for aces; tens never reach here) splits against `dv`. */
function pairSplits(pairValue: number, dv: number): boolean {
  switch (pairValue) {
    case 11: // A,A
      return true
    case 9:
      return inRange(dv, 2, 6) || inRange(dv, 8, 9)
    case 8:
      return true
    case 7:
      return inRange(dv, 2, 7)
    case 6:
      return inRange(dv, 2, 6)
    case 5: // treated as hard 10, never split
      return false
    case 4:
      return inRange(dv, 5, 6)
    case 3:
    case 2:
      return inRange(dv, 2, 7)
    default: // 10-value pairs never split
      return false
  }
}

/** Falls back to `hit` when a recommended double is unavailable, except soft 18 against 3-6. */
function resolveDouble(canDouble: boolean, standInstead: boolean): PlayerAction {
  if (canDouble) return 'double'
  return standInstead ? 'stand' : 'hit'
}

function softTotalAction(total: number, dv: number, canDouble: boolean): PlayerAction {
  if (total <= 12) return 'hit' // only reachable via A,A falling through unsplit
  if (total <= 14) return inRange(dv, 5, 6) ? resolveDouble(canDouble, false) : 'hit' // A,2-A,3
  if (total <= 16) return inRange(dv, 4, 6) ? resolveDouble(canDouble, false) : 'hit' // A,4-A,5
  if (total === 17) return inRange(dv, 3, 6) ? resolveDouble(canDouble, false) : 'hit' // A,6
  if (total === 18) { // A,7
    if (inRange(dv, 3, 6)) return resolveDouble(canDouble, true)
    if (dv === 2 || dv === 7 || dv === 8) return 'stand'
    return 'hit' // 9, 10, A
  }
  return 'stand' // A,8+
}

function hardTotalAction(total: number, dv: number, canDouble: boolean): PlayerAction {
  if (total <= 8) return 'hit'
  if (total === 9) return inRange(dv, 3, 6) ? resolveDouble(canDouble, false) : 'hit'
  if (total === 10) return inRange(dv, 2, 9) ? resolveDouble(canDouble, false) : 'hit'
  if (total === 11) return dv <= 10 ? resolveDouble(canDouble, false) : 'hit'
  if (total === 12) return inRange(dv, 4, 6) ? 'stand' : 'hit'
  if (total <= 16) return inRange(dv, 2, 6) ? 'stand' : 'hit'
  return 'stand' // 17+
}

/** The textbook action for `hand` against `dealerUp`, given whether double/split are currently legal. */
export function basicStrategy(
  hand: Card[],
  dealerUp: Card,
  options: { canDouble: boolean; canSplit: boolean },
): PlayerAction {
  const dv = cardValue(dealerUp.rank)

  if (hand.length === 2 && isPair(hand)) {
    const pairValue = cardValue(hand[0]!.rank)
    if (options.canSplit && pairSplits(pairValue, dv)) return 'split'
  }

  const { total, soft } = handValue(hand)
  return soft ? softTotalAction(total, dv, options.canDouble) : hardTotalAction(total, dv, options.canDouble)
}
