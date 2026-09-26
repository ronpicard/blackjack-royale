/**
 * Cards and the six-deck shoe: building it, shuffling it, and reading hand values off a list of
 * cards. Pure data and pure functions, so `session.ts` can drive the whole game deterministically.
 */

import type { Card, Hand, HandValue, Rank, Suit } from './types.ts'

export const SUITS: readonly Suit[] = ['S', 'H', 'D', 'C']

export const RANKS: readonly Rank[] = ['A', '2', '3', '4', '5', '6', '7', '8', '9', '10', 'J', 'Q', 'K']

/** Six decks, the standard shoe size for this table. */
export const DECK_COUNT = 6

/** Reshuffle before the next round when fewer cards than this remain in the shoe. */
export const CUT_CARD_REMAINING = 78

/** Blackjack value of a rank: an ace counts 11 here (`handValue` reduces it to 1 as needed). */
export function cardValue(rank: Rank): number {
  if (rank === 'A') return 11
  if (rank === '10' || rank === 'J' || rank === 'Q' || rank === 'K') return 10
  return Number(rank)
}

/** True for 10, J, Q, K: any rank that first counts as ten. */
export function isTenValue(rank: Rank): boolean {
  return cardValue(rank) === 10 && rank !== 'A'
}

/** A fresh six-deck shoe in fixed order (unshuffled): suit within rank, rank within deck. */
export function buildShoe(): Card[] {
  const shoe: Card[] = []
  for (let deck = 0; deck < DECK_COUNT; deck++) {
    for (const rank of RANKS) {
      for (const suit of SUITS) {
        shoe.push({ rank, suit })
      }
    }
  }
  return shoe
}

/** Fisher-Yates shuffle driven by `rng`; returns a new array and never mutates `cards`. */
export function shuffle(cards: Card[], rng: () => number): Card[] {
  const result = [...cards]
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1))
    const tmp = result[i]!
    result[i] = result[j]!
    result[j] = tmp
  }
  return result
}

/** Best total for a list of cards: aces count 11 then reduce to 1 while the total is over 21. */
export function handValue(cards: Card[]): HandValue {
  let total = 0
  let aces = 0
  for (const card of cards) {
    total += cardValue(card.rank)
    if (card.rank === 'A') aces++
  }
  let hardAces = 0
  while (total > 21 && hardAces < aces) {
    total -= 10
    hardAces++
  }
  return { total, soft: aces > hardAces }
}

/** A natural 21 on the first two cards of a hand that was not made by a split. */
export function isBlackjack(hand: Hand): boolean {
  return !hand.fromSplit && hand.cards.length === 2 && handValue(hand.cards).total === 21
}

/** Two cards that may be split: equal rank, or both ten-value (a king and a ten, say). */
export function isPair(cards: Card[]): boolean {
  if (cards.length !== 2) return false
  const [a, b] = cards as [Card, Card]
  if (a.rank === b.rank) return true
  return isTenValue(a.rank) && isTenValue(b.rank)
}

const SUIT_GLYPHS: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }

/** Short display label for a card, e.g. `A♠`, `10♥`. */
export function cardLabel(card: Card): string {
  return `${card.rank}${SUIT_GLYPHS[card.suit]}`
}

/** Stable identity key for a card, used to cache textures etc.: `${rank}${suit}`. */
export function cardKey(card: Card): string {
  return `${card.rank}${card.suit}`
}
