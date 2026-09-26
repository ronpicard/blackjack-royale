import test from 'node:test'
import assert from 'node:assert/strict'
import type { Card, Hand } from './types.ts'
import { createRng } from './rng.ts'
import {
  CUT_CARD_REMAINING,
  DECK_COUNT,
  buildShoe,
  cardKey,
  cardLabel,
  cardValue,
  handValue,
  isBlackjack,
  isPair,
  isTenValue,
  shuffle,
} from './cards.ts'

function hand(cards: Card[], overrides: Partial<Hand> = {}): Hand {
  return {
    cards,
    bet: 10,
    status: 'playing',
    doubled: false,
    fromSplit: false,
    splitAces: false,
    outcome: null,
    returned: 0,
    ...overrides,
  }
}

test('buildShoe has 312 cards, 24 of each rank', () => {
  const shoe = buildShoe()
  assert.equal(shoe.length, 52 * DECK_COUNT)
  const counts = new Map<string, number>()
  for (const card of shoe) counts.set(card.rank, (counts.get(card.rank) ?? 0) + 1)
  for (const count of counts.values()) assert.equal(count, 24)
})

test('CUT_CARD_REMAINING is 78', () => {
  assert.equal(CUT_CARD_REMAINING, 78)
})

test('cardValue and isTenValue', () => {
  assert.equal(cardValue('A'), 11)
  assert.equal(cardValue('9'), 9)
  assert.equal(cardValue('10'), 10)
  assert.equal(cardValue('J'), 10)
  assert.equal(cardValue('Q'), 10)
  assert.equal(cardValue('K'), 10)
  assert.equal(isTenValue('10'), true)
  assert.equal(isTenValue('K'), true)
  assert.equal(isTenValue('A'), false)
  assert.equal(isTenValue('9'), false)
})

test('shuffle is a permutation, deterministic for a seed, and different for another', () => {
  const shoe = buildShoe()
  const a = shuffle(shoe, createRng(1))
  const b = shuffle(shoe, createRng(1))
  const c = shuffle(shoe, createRng(2))

  assert.equal(a.length, shoe.length)
  assert.deepEqual(a, b)
  assert.notDeepEqual(a, c)

  // Same multiset of cards, just reordered; the input is untouched.
  assert.deepEqual(
    [...a].sort((x, y) => cardKey(x).localeCompare(cardKey(y))),
    [...shoe].sort((x, y) => cardKey(x).localeCompare(cardKey(y))),
  )
  assert.deepEqual(shoe, buildShoe())
})

test('handValue: A+K is 21 soft', () => {
  const v = handValue([{ rank: 'A', suit: 'S' }, { rank: 'K', suit: 'H' }])
  assert.deepEqual(v, { total: 21, soft: true })
})

test('handValue: A+A is 12 soft', () => {
  const v = handValue([{ rank: 'A', suit: 'S' }, { rank: 'A', suit: 'H' }])
  assert.deepEqual(v, { total: 12, soft: true })
})

test('handValue: A+5+10 is 16 hard', () => {
  const v = handValue([{ rank: 'A', suit: 'S' }, { rank: '5', suit: 'H' }, { rank: '10', suit: 'D' }])
  assert.deepEqual(v, { total: 16, soft: false })
})

test('handValue: 10+9+5 is 24 (bust, hard)', () => {
  const v = handValue([{ rank: '10', suit: 'S' }, { rank: '9', suit: 'H' }, { rank: '5', suit: 'D' }])
  assert.deepEqual(v, { total: 24, soft: false })
})

test('isBlackjack is true for a natural 21, false for a split hand or a non-21', () => {
  const natural = hand([{ rank: 'A', suit: 'S' }, { rank: 'K', suit: 'H' }])
  assert.equal(isBlackjack(natural), true)

  const split = hand([{ rank: 'A', suit: 'S' }, { rank: 'K', suit: 'H' }], { fromSplit: true })
  assert.equal(isBlackjack(split), false)

  const notTwentyOne = hand([{ rank: '9', suit: 'S' }, { rank: 'K', suit: 'H' }])
  assert.equal(isBlackjack(notTwentyOne), false)
})

test('isPair: K+10 is a pair, A+K is not', () => {
  assert.equal(isPair([{ rank: 'K', suit: 'S' }, { rank: '10', suit: 'H' }]), true)
  assert.equal(isPair([{ rank: 'A', suit: 'S' }, { rank: 'K', suit: 'H' }]), false)
  assert.equal(isPair([{ rank: '8', suit: 'S' }, { rank: '8', suit: 'H' }]), true)
})

test('cardLabel and cardKey', () => {
  assert.equal(cardLabel({ rank: 'A', suit: 'S' }), 'A♠')
  assert.equal(cardLabel({ rank: '10', suit: 'H' }), '10♥')
  assert.equal(cardKey({ rank: 'A', suit: 'S' }), 'AS')
  assert.equal(cardKey({ rank: '10', suit: 'H' }), '10H')
})
