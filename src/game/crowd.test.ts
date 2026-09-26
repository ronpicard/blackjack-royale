import test from 'node:test'
import assert from 'node:assert/strict'
import type { HandOutcome, RoundResult } from './types.ts'
import { BIG_LOSS_STAKE, PARTIAL_LOSS_STRENGTH, crowdReaction } from './crowd.ts'

function result(staked: number, returned: number, outcomes: HandOutcome[] = ['win']): RoundResult {
  return {
    staked,
    returned,
    net: returned - staked,
    outcome: outcomes[0]!,
    hands: outcomes.map((outcome) => ({ outcome, total: 20, bet: staked, returned })),
    dealerTotal: 20,
    dealerBlackjack: false,
    insuranceWon: false,
  }
}

test('no reaction without a result or a stake, and none on an exact push', () => {
  assert.equal(crowdReaction(null), null)
  assert.equal(crowdReaction(result(0, 0, ['push'])), null)
  assert.equal(crowdReaction(result(10, 10, ['push'])), null)
})

test('a blackjack always draws the loudest cheer, regardless of net', () => {
  assert.deepEqual(crowdReaction(result(10, 25, ['blackjack'])), { kind: 'cheer', strength: 1 })
})

test('a big win draws the loudest cheer', () => {
  assert.deepEqual(crowdReaction(result(10, 300, ['win'])), { kind: 'cheer', strength: 1 })
})

test('an ordinary net win draws a cheer that grows with the payout', () => {
  const small = crowdReaction(result(10, 12, ['win']))
  const big = crowdReaction(result(10, 20, ['win']))
  assert.equal(small?.kind, 'cheer')
  assert.equal(big?.kind, 'cheer')
  assert.ok(small!.strength > 0 && small!.strength < big!.strength)
  assert.ok(big!.strength < 1)
})

test('a total loss (no hand won or pushed) draws a groan that grows with the stake', () => {
  const small = crowdReaction(result(5, 0, ['lose']))
  const big = crowdReaction(result(BIG_LOSS_STAKE, 0, ['lose']))
  assert.equal(small?.kind, 'groan')
  assert.ok(small!.strength >= 0.5 && small!.strength < big!.strength)
  assert.equal(big!.strength, 1)
})

test('a partial loss (a split where one hand won or pushed) draws a soft groan', () => {
  const reaction = crowdReaction(result(20, 10, ['lose', 'push']))
  assert.deepEqual(reaction, { kind: 'groan', strength: PARTIAL_LOSS_STRENGTH })
})
