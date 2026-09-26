import test from 'node:test'
import assert from 'node:assert/strict'
import { createRng } from './rng.ts'
import { createSession } from './session.ts'
import { attractAction, attractBet } from './autoplay.ts'

test('attractBet never exceeds the bankroll, and is 0 below the table minimum', () => {
  const rng = createRng(1)
  assert.equal(attractBet(rng, 0), 0)
  assert.equal(attractBet(rng, 4), 0)
  for (let seed = 0; seed < 30; seed++) {
    const r = createRng(seed)
    for (const bankroll of [5, 24, 25, 99, 100, 1000]) {
      const bet = attractBet(r, bankroll)
      assert.ok(bet === 0 || [5, 25, 100].includes(bet), `unexpected bet ${bet}`)
      assert.ok(bet <= bankroll, `bet ${bet} exceeds bankroll ${bankroll}`)
    }
  }
})

test('attractBet is deterministic for the same rng sequence', () => {
  assert.equal(attractBet(createRng(7), 1000), attractBet(createRng(7), 1000))
})

test('attractAction always declines insurance and otherwise follows the hint', () => {
  const session = createSession(null, 1)
  assert.equal(attractAction({ ...session, phase: 'insurance' }), false)

  const playerPhase = {
    ...session,
    phase: 'player' as const,
    hands: [{ cards: [{ rank: '10' as const, suit: 'S' as const }, { rank: '6' as const, suit: 'H' as const }], bet: 10, status: 'playing' as const, doubled: false, fromSplit: false, splitAces: false, outcome: null, returned: 0 }],
    activeHand: 0,
    dealer: { cards: [{ rank: '7' as const, suit: 'C' as const }, { rank: '2' as const, suit: 'D' as const }], holeRevealed: false },
  }
  // hard 16 vs 7: basic strategy hits.
  assert.equal(attractAction(playerPhase), 'hit')
})
