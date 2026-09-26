import test from 'node:test'
import assert from 'node:assert/strict'
import type { Card } from './types.ts'
import { basicStrategy } from './strategy.ts'

function c(rank: Card['rank'], suit: Card['suit'] = 'S'): Card {
  return { rank, suit }
}

const FULL = { canDouble: true, canSplit: true }

test('8,8 vs 10 splits', () => {
  assert.equal(basicStrategy([c('8'), c('8', 'H')], c('10'), FULL), 'split')
})

test('10,10 vs 6 stands (tens never split)', () => {
  assert.equal(basicStrategy([c('10'), c('K', 'H')], c('6'), FULL), 'stand')
})

test('A,A vs anything always splits', () => {
  assert.equal(basicStrategy([c('A'), c('A', 'H')], c('7'), FULL), 'split')
})

test('A,7 vs 9 hits (soft 18 against a strong up card)', () => {
  assert.equal(basicStrategy([c('A'), c('7', 'H')], c('9'), FULL), 'hit')
})

test('A,7 vs 6 doubles, and stands instead when double is unavailable', () => {
  assert.equal(basicStrategy([c('A'), c('7', 'H')], c('6'), FULL), 'double')
  assert.equal(basicStrategy([c('A'), c('7', 'H')], c('6'), { canDouble: false, canSplit: true }), 'stand')
})

test('A,7 vs 8 stands', () => {
  assert.equal(basicStrategy([c('A'), c('7', 'H')], c('8'), FULL), 'stand')
})

test('11 vs A hits (can\'t double into a dealer ace safely per the table)', () => {
  assert.equal(basicStrategy([c('6'), c('5', 'H')], c('A'), FULL), 'hit')
})

test('11 vs 8 doubles', () => {
  assert.equal(basicStrategy([c('6'), c('5', 'H')], c('8'), FULL), 'double')
})

test('16 vs 7 hits', () => {
  assert.equal(basicStrategy([c('10'), c('6', 'H')], c('7'), FULL), 'hit')
})

test('12 vs 4 stands', () => {
  assert.equal(basicStrategy([c('7'), c('5', 'H')], c('4'), FULL), 'stand')
})

test('12 vs 2 hits (outside the 4-6 stand window)', () => {
  assert.equal(basicStrategy([c('7'), c('5', 'H')], c('2'), FULL), 'hit')
})

test('9 vs 3 doubles, and hits instead when double is unavailable', () => {
  assert.equal(basicStrategy([c('4'), c('5', 'H')], c('3'), FULL), 'double')
  assert.equal(basicStrategy([c('4'), c('5', 'H')], c('3'), { canDouble: false, canSplit: true }), 'hit')
})

test('a pair that would split falls through to the total\'s rule when split is unavailable', () => {
  // 8,8 (total 16 hard) vs a dealer 10: hard 16 hits, even though 8,8 always wants to split.
  const noSplit = { canDouble: true, canSplit: false }
  assert.equal(basicStrategy([c('8'), c('8', 'H')], c('10'), noSplit), 'hit')
})

test('5,5 is treated as a hard 10, never split', () => {
  assert.equal(basicStrategy([c('5'), c('5', 'H')], c('9'), FULL), 'double')
  assert.equal(basicStrategy([c('5'), c('5', 'H')], c('10'), FULL), 'hit')
})

test('17+ always stands', () => {
  assert.equal(basicStrategy([c('10'), c('7', 'H')], c('A'), FULL), 'stand')
})
