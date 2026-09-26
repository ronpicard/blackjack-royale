import test from 'node:test'
import assert from 'node:assert/strict'
import type { Card, Session, Transition } from './types.ts'
import { buildShoe } from './cards.ts'
import {
  BIG_WIN_NET,
  HISTORY_LENGTH,
  STARTING_BANKROLL,
  TABLE_MAX_BET,
  TABLE_MIN_BET,
  answerInsurance,
  availableActions,
  beginBetting,
  clearBet,
  createSession,
  deal,
  doubleBet,
  double,
  hintFor,
  hit,
  isBigWin,
  isBroke,
  parseSessionSave,
  placeChip,
  rebet,
  refill,
  split,
  stand,
  toSave,
  undoChip,
} from './session.ts'

function C(rank: Card['rank'], suit: Card['suit'] = 'S'): Card {
  return { rank, suit }
}

function fresh(): Session {
  return createSession(null, 1)
}

/** Forces the next cards dealt, padding with a full shoe so the cut-card reshuffle never fires. */
function withShoe(session: Session, cards: Card[]): Session {
  return { ...session, shoe: [...cards, ...buildShoe()] }
}

/** Places a bet of `amount` credits (a sum of 1/5/25/100/500 chips) without touching the shoe. */
function withBet(session: Session, amount: number): Session {
  let s = session
  let remaining = amount
  for (const chip of [500, 100, 25, 5, 1] as const) {
    while (remaining >= chip) {
      s = placeChip(s, chip).session
      remaining -= chip
    }
  }
  return s
}

/** A small deterministic PRNG so the "random playthrough" test is reproducible. */
function makeLcg(seed: number): () => number {
  let state = seed >>> 0
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0
    return state / 0x100000000
  }
}

/**
 * Everything the player currently owns or has legitimately at stake: the bankroll, the circle
 * bet, and any hand/insurance stake not yet settled. Once a round reaches 'result' every stake
 * has already been folded into the bankroll (won, pushed, or lost), so it no longer counts here.
 */
function creditsValue(s: Session): number {
  const activeHandStake = s.hands.filter((h) => h.outcome === null).reduce((sum, h) => sum + h.bet, 0)
  const activeInsurance = s.phase === 'result' ? 0 : s.insurance
  return s.bankroll + s.bet + activeHandStake + activeInsurance
}

test('placeChip stakes credits and rejects past the bankroll or the table max', () => {
  const s0 = fresh()
  const t1 = placeChip(s0, 25)
  assert.equal(t1.session.bankroll, STARTING_BANKROLL - 25)
  assert.equal(t1.session.bet, 25)
  assert.deepEqual(t1.commands, [{ type: 'sound', name: 'chip' }])

  const broke: Session = { ...s0, bankroll: 3 }
  const t2 = placeChip(broke, 5)
  assert.deepEqual(t2, { session: broke, commands: [] })

  const atMax: Session = { ...s0, bet: TABLE_MAX_BET }
  const t3 = placeChip(atMax, 1)
  assert.deepEqual(t3, { session: atMax, commands: [] })
})

test('placeChip from result reopens a fresh betting round, clearing the round but keeping lastBet', () => {
  const staked = withBet(fresh(), 10)
  const dealt = withShoe(staked, [C('9'), C('10', 'H'), C('9', 'D'), C('A', 'C')])
  const settled = deal(dealt).session
  assert.equal(settled.phase, 'result')
  assert.ok(settled.lastResult !== null)

  const t = placeChip(settled, 5)
  assert.equal(t.session.phase, 'betting')
  assert.equal(t.session.bet, 5)
  assert.equal(t.session.lastResult, null)
  assert.equal(t.session.lastBet, settled.lastBet)
  assert.deepEqual(t.session.hands, [])
})

test('undoChip pops only the last placement, and is a no-op when empty or mid-round', () => {
  const s0 = fresh()
  assert.deepEqual(undoChip(s0), { session: s0, commands: [] })

  const s1 = placeChip(s0, 25).session
  const s2 = placeChip(s1, 5).session
  const u1 = undoChip(s2)
  assert.equal(u1.session.bet, 25)
  assert.equal(u1.session.bankroll, STARTING_BANKROLL - 25)

  const u2 = undoChip(u1.session)
  assert.equal(u2.session.bet, 0)
  assert.equal(u2.session.bankroll, STARTING_BANKROLL)
  assert.deepEqual(u2.session.undo, [])
})

test('clearBet refunds everything staked and empties the undo stack', () => {
  const s1 = placeChip(fresh(), 25).session
  const s2 = placeChip(s1, 5).session
  const t = clearBet(s2)
  assert.equal(t.session.bet, 0)
  assert.equal(t.session.bankroll, STARTING_BANKROLL)
  assert.deepEqual(t.session.undo, [])
})

test('rebet restakes lastBet capped by bankroll and the table max; no-op without a lastBet', () => {
  const s0 = fresh()
  assert.deepEqual(rebet(s0), { session: s0, commands: [] })

  const staked = placeChip(s0, 25).session
  const dealt = withShoe(staked, [C('9'), C('10', 'H'), C('9', 'D'), C('A', 'C')])
  const afterResult = deal(dealt).session
  assert.equal(afterResult.phase, 'result')
  assert.equal(afterResult.lastBet, 25)

  const rebetT = rebet(afterResult)
  assert.equal(rebetT.session.bet, 25)
  assert.equal(rebetT.session.phase, 'betting')

  const poor: Session = { ...afterResult, bankroll: 0 }
  const denied = rebet(poor)
  assert.equal(denied.session.bet, 0)
})

test('doubleBet doubles the circle, capped by bankroll and the table max; denied at zero', () => {
  const s0 = fresh()
  assert.deepEqual(doubleBet(s0), { session: s0, commands: [] })

  const s1 = placeChip(s0, 100).session
  const t = doubleBet(s1)
  assert.equal(t.session.bet, 200)
  assert.equal(t.session.bankroll, STARTING_BANKROLL - 200)

  const nearMax: Session = { ...s0, bet: TABLE_MAX_BET - 10, bankroll: 1000 }
  const capped = doubleBet(nearMax)
  assert.equal(capped.session.bet, TABLE_MAX_BET)
})

test('deal requires the table minimum, and deals player/dealer/player/dealer-down in order', () => {
  const short = placeChip(fresh(), 1).session
  assert.deepEqual(deal(short), { session: short, commands: [] })

  const staked = withBet(fresh(), 10)
  const scripted = withShoe(staked, [C('4'), C('9', 'H'), C('5', 'D'), C('6', 'C')])
  const t = deal(scripted)

  assert.equal(t.session.phase, 'player')
  assert.equal(t.session.hands.length, 1)
  assert.deepEqual(t.session.hands[0]!.cards, [C('4'), C('5', 'D')])
  assert.deepEqual(t.session.dealer.cards, [C('9', 'H'), C('6', 'C')])
  assert.equal(t.session.dealer.holeRevealed, false)
  assert.equal(t.session.bet, 0)
  assert.equal(t.session.lastBet, 10)

  const dealCommands = t.commands.filter((c) => c.type === 'deal')
  assert.equal(dealCommands.length, 4)
  assert.deepEqual(
    dealCommands.map((c) => (c as { to: number | 'dealer' }).to),
    [0, 'dealer', 0, 'dealer'],
  )
  assert.equal((dealCommands[3] as { faceDown: boolean }).faceDown, true)
  assert.equal((dealCommands[1] as { faceDown: boolean }).faceDown, false)
})

test('a player blackjack against no dealer blackjack pays 3 to 2 immediately', () => {
  const staked = withBet(fresh(), 10)
  const scripted = withShoe(staked, [C('A'), C('9', 'H'), C('K', 'D'), C('6', 'C')])
  const t = deal(scripted)

  assert.equal(t.session.phase, 'result')
  assert.equal(t.session.hands[0]!.outcome, 'blackjack')
  assert.equal(t.session.hands[0]!.returned, 10 + Math.floor((10 * 3) / 2))
  assert.equal(t.session.bankroll, STARTING_BANKROLL - 10 + 25)
  assert.ok(t.commands.some((c) => c.type === 'sound' && c.name === 'blackjack'))
  assert.ok(t.commands.some((c) => c.type === 'reveal'))
})

test('dealer blackjack under a ten ends the round at once; a player blackjack pushes', () => {
  const staked = withBet(fresh(), 10)
  const scripted = withShoe(staked, [C('9'), C('10', 'H'), C('9', 'D'), C('A', 'C')])
  const t = deal(scripted)
  assert.equal(t.session.phase, 'result')
  assert.equal(t.session.hands[0]!.outcome, 'lose')
  assert.equal(t.session.hands[0]!.returned, 0)
  assert.equal(t.session.lastResult!.dealerBlackjack, true)

  const pushStaked = withBet(fresh(), 10)
  const pushScripted = withShoe(pushStaked, [C('A'), C('10', 'H'), C('K', 'D'), C('A', 'C')])
  const pushT = deal(pushScripted)
  assert.equal(pushT.session.hands[0]!.outcome, 'push')
  assert.equal(pushT.session.hands[0]!.returned, 10)
  assert.equal(pushT.session.bankroll, STARTING_BANKROLL)
})

test('insurance is offered only when the dealer shows an ace and it is affordable', () => {
  const staked = withBet(fresh(), 10)
  const nonAceUp = withShoe(staked, [C('9'), C('9', 'H'), C('8', 'D'), C('6', 'C')])
  assert.equal(deal(nonAceUp).session.phase, 'player')

  const aceUp = withShoe(staked, [C('9'), C('A', 'H'), C('8', 'D'), C('6', 'C')])
  const offered = deal(aceUp)
  assert.equal(offered.session.phase, 'insurance')
  assert.ok(offered.commands.some((c) => c.type === 'message' && c.text === 'Insurance?'))

  const tooPoor: Session = { ...staked, bankroll: 3 }
  const unaffordable = withShoe(tooPoor, [C('9'), C('A', 'H'), C('8', 'D'), C('6', 'C')])
  assert.equal(deal(unaffordable).session.phase, 'player')
})

test('insurance pays 2 to 1 on a dealer blackjack, and is lost otherwise', () => {
  const staked = withBet(fresh(), 10)
  const dealerBjShoe = withShoe(staked, [C('9'), C('A', 'H'), C('8', 'D'), C('K', 'C')])
  const offered = deal(dealerBjShoe).session
  assert.equal(offered.phase, 'insurance')

  const taken = answerInsurance(offered, true)
  assert.equal(taken.session.insurance, 5) // floor(10/2)
  assert.equal(taken.session.phase, 'result')
  assert.equal(taken.session.lastResult!.insuranceWon, true)
  // Hand 17 loses (returned 0), but insurance pays 3x its 5-credit premium: net back to even.
  assert.equal(taken.session.bankroll, STARTING_BANKROLL)
  assert.ok(taken.commands.some((c) => c.type === 'insurance' && c.won === true && c.returned === 15))

  const nonBjShoe = withShoe(staked, [C('9'), C('A', 'H'), C('8', 'D'), C('6', 'C')])
  const offered2 = deal(nonBjShoe).session
  const takenLost = answerInsurance(offered2, true)
  assert.equal(takenLost.session.phase, 'player')
  assert.ok(takenLost.commands.some((c) => c.type === 'insurance' && c.won === false && c.returned === 0))
  // The 5-credit premium is gone; only the main bet is still in play.
  assert.equal(takenLost.session.bankroll, STARTING_BANKROLL - 10 - 5)

  const declined = answerInsurance(offered, false)
  assert.equal(declined.session.insurance, 0)
  assert.equal(declined.session.bankroll, STARTING_BANKROLL - 10)
})

test('hit draws one card, and busting settles the round without a dealer draw', () => {
  const staked = withBet(fresh(), 10)
  const scripted = withShoe(staked, [C('9'), C('10', 'H'), C('9', 'D'), C('6', 'C')])
  const dealt = deal(scripted).session
  assert.equal(dealt.phase, 'player')

  const busted = hit({ ...dealt, shoe: [C('5'), ...dealt.shoe] })
  assert.equal(busted.session.hands[0]!.status, 'bust')
  assert.equal(busted.session.phase, 'result')
  assert.equal(busted.session.hands[0]!.outcome, 'bust')
  assert.equal(busted.session.hands[0]!.returned, 0)
  assert.equal(busted.session.dealer.cards.length, 2) // no dealer draw when every hand busted
  assert.ok(busted.commands.some((c) => c.type === 'bust' && c.hand === 0))
  assert.ok(!busted.commands.some((c) => c.type === 'deal' && c.to === 'dealer'))
  assert.equal(busted.session.bankroll, STARTING_BANKROLL - 10)
})

test('double takes exactly one card and doubles the stake', () => {
  const staked = withBet(fresh(), 10)
  const scripted = withShoe(staked, [C('5'), C('7', 'H'), C('6', 'D'), C('8', 'C')])
  const dealt = deal(scripted).session // player 5+6=11, dealer 7,8 (15)

  const doubled = double({ ...dealt, shoe: [C('9'), C('3'), ...dealt.shoe] }) // player draws 9 -> 20; dealer draws 3 -> 18
  const hand = doubled.session.hands[0]!
  assert.equal(hand.cards.length, 3)
  assert.equal(hand.bet, 20)
  assert.equal(hand.doubled, true)
  assert.equal(hand.status, 'stood')
  assert.equal(doubled.session.phase, 'result')
  assert.equal(hand.outcome, 'win')
  assert.equal(hand.returned, 40)
  assert.equal(doubled.session.bankroll, STARTING_BANKROLL - 10 - 10 + 40)
  assert.ok(doubled.commands.some((c) => c.type === 'double' && c.hand === 0))
})

test('double is rejected with more than two cards or an unaffordable bankroll', () => {
  const staked = withBet(fresh(), 10)
  const scripted = withShoe(staked, [C('5'), C('7', 'H'), C('6', 'D'), C('8', 'C')])
  const dealt = deal(scripted).session

  const poor: Session = { ...dealt, bankroll: 0 }
  assert.deepEqual(double(poor), { session: poor, commands: [] })

  const threeCards: Session = {
    ...dealt,
    hands: [{ ...dealt.hands[0]!, cards: [...dealt.hands[0]!.cards, C('2')] }],
  }
  assert.deepEqual(double(threeCards), { session: threeCards, commands: [] })
})

test('split makes two hands from a pair, including a king and a ten', () => {
  const staked = withBet(fresh(), 10)
  const scripted = withShoe(staked, [C('K'), C('7', 'H'), C('10', 'D'), C('6', 'C')])
  const dealt = deal(scripted).session

  const afterSplit = split({ ...dealt, shoe: [C('3'), C('2'), ...dealt.shoe] })
  assert.equal(afterSplit.session.hands.length, 2)
  assert.deepEqual(afterSplit.session.hands[0]!.cards, [C('K'), C('3')])
  assert.deepEqual(afterSplit.session.hands[1]!.cards, [C('10', 'D'), C('2')])
  assert.equal(afterSplit.session.hands[0]!.fromSplit, true)
  assert.equal(afterSplit.session.hands[1]!.fromSplit, true)
  assert.equal(afterSplit.session.bankroll, STARTING_BANKROLL - 10 - 10)
  assert.ok(afterSplit.commands.some((c) => c.type === 'split' && c.hand === 0))
})

test('split aces get exactly one card each and stand immediately (not a blackjack at 21)', () => {
  const staked = withBet(fresh(), 10)
  const scripted = withShoe(staked, [C('A'), C('9', 'H'), C('A', 'D'), C('6', 'C')])
  const dealt = deal(scripted).session
  assert.equal(dealt.phase, 'player')

  const afterSplit = split({ ...dealt, shoe: [C('K'), C('9'), C('2'), ...dealt.shoe] })
  assert.equal(afterSplit.session.hands[0]!.splitAces, true)
  assert.equal(afterSplit.session.hands[0]!.status, 'stood')
  assert.equal(afterSplit.session.hands[1]!.status, 'stood')
  // Both hands settle at once since neither can act further; the dealer (15) draws to 17 (a '2').
  assert.equal(afterSplit.session.phase, 'result')
  assert.equal(afterSplit.session.hands[0]!.outcome, 'win') // 21, not a blackjack, but beats 17
  assert.equal(afterSplit.session.hands[1]!.outcome, 'win') // 20 beats 17
})

test('split is capped at four hands', () => {
  const dummyHand = {
    cards: [C('8'), C('8', 'H')],
    bet: 10,
    status: 'playing' as const,
    doubled: false,
    fromSplit: true,
    splitAces: false,
    outcome: null,
    returned: 0,
  }
  const fourHands: Session = {
    ...fresh(),
    phase: 'player',
    bankroll: 1000,
    hands: [dummyHand, dummyHand, dummyHand, dummyHand],
    activeHand: 0,
    dealer: { cards: [C('9'), C('6', 'H')], holeRevealed: false },
  }
  assert.deepEqual(split(fourHands), { session: fourHands, commands: [] })
})

test('the dealer stands on a soft 17 and draws on a hard 16', () => {
  const staked = withBet(fresh(), 10)
  const soft17Shoe = withShoe(staked, [C('9'), C('6', 'H'), C('8', 'D'), C('A', 'C')])
  const dealt = deal(soft17Shoe).session // dealer: 6, A (soft 17); player 9+8=17
  const stood = stand(dealt)
  assert.equal(stood.session.phase, 'result')
  assert.equal(stood.session.dealer.cards.length, 2) // no draw on soft 17
  assert.equal(stood.session.hands[0]!.outcome, 'push')
  assert.ok(!stood.commands.some((c) => c.type === 'deal' && c.to === 'dealer'))

  const hard16Shoe = withShoe(staked, [C('9'), C('10', 'H'), C('9', 'D'), C('6', 'C')])
  const dealt2 = deal(hard16Shoe).session // dealer 10+6=16
  const stood2 = stand({ ...dealt2, shoe: [C('5'), ...dealt2.shoe] }) // draws a 5 -> 21
  assert.equal(stood2.session.dealer.cards.length, 3)
  assert.equal(stood2.session.lastResult!.dealerTotal, 21)
})

test('a dealer bust pays every standing hand; equal totals push', () => {
  const staked = withBet(fresh(), 10)
  const scripted = withShoe(staked, [C('9'), C('10', 'H'), C('9', 'D'), C('6', 'C')])
  const dealt = deal(scripted).session // player 18, dealer 16
  const stood = stand({ ...dealt, shoe: [C('10'), ...dealt.shoe] }) // dealer draws 10 -> 26, bust
  assert.equal(stood.session.hands[0]!.outcome, 'win')
  assert.equal(stood.session.hands[0]!.returned, 20)
  assert.ok(stood.commands.some((c) => c.type === 'bust' && c.hand === 'dealer'))
})

test('reshuffling under the cut card increments shuffles and emits a shuffle command', () => {
  const staked = withBet(fresh(), 10)
  const short: Session = { ...staked, shoe: withShoe(staked, [C('4'), C('9', 'H'), C('5', 'D'), C('6', 'C')]).shoe.slice(0, 50) }
  const t = deal(short)
  assert.equal(t.session.shuffles, staked.shuffles + 1)
  assert.ok(t.commands.some((c) => c.type === 'shuffle'))
  assert.ok(t.commands.some((c) => c.type === 'sound' && c.name === 'shuffle'))
  assert.ok(t.session.shoe.length > 50)
})

test('a settled round ends with a save command', () => {
  const staked = withBet(fresh(), 10)
  const scripted = withShoe(staked, [C('9'), C('10', 'H'), C('9', 'D'), C('A', 'C')])
  const t = deal(scripted)
  assert.equal(t.session.phase, 'result')
  assert.deepEqual(t.commands[t.commands.length - 1], { type: 'save' })
})

test('toSave and parseSessionSave round-trip; garbage is rejected', () => {
  const staked = withBet(fresh(), 10)
  const scripted = withShoe(staked, [C('9'), C('10', 'H'), C('9', 'D'), C('A', 'C')])
  const settled = deal(scripted).session
  assert.equal(settled.phase, 'result')

  const save = toSave(settled)
  assert.equal(save.version, 1)
  const parsed = parseSessionSave(save)
  assert.deepEqual(parsed, save)

  assert.equal(parseSessionSave(null), null)
  assert.equal(parseSessionSave('nope'), null)
  assert.equal(parseSessionSave({}), null)
  assert.equal(parseSessionSave({ ...save, version: 2 }), null)
  assert.equal(parseSessionSave({ ...save, bankroll: -1 }), null)
  assert.equal(parseSessionSave({ ...save, history: ['nonsense'] }), null)
  assert.equal(parseSessionSave({ ...save, history: new Array(HISTORY_LENGTH + 1).fill('win') }), null)
  assert.equal(parseSessionSave({ ...save, stats: null }), null)
  assert.equal(parseSessionSave({ ...save, stats: { ...save.stats, rounds: -1 } }), null)
})

test('history is capped at HISTORY_LENGTH', () => {
  const padded: Session = { ...fresh(), history: new Array(HISTORY_LENGTH).fill('win') }
  const staked = withBet(padded, 10)
  const scripted = withShoe(staked, [C('9'), C('10', 'H'), C('9', 'D'), C('A', 'C')])
  const t = deal(scripted)
  assert.equal(t.session.history.length, HISTORY_LENGTH)
  assert.equal(t.session.history[0], 'lose')
})

test('stats are counted across rounds', () => {
  const staked = withBet(fresh(), 10)
  const winShoe = withShoe(staked, [C('A'), C('9', 'H'), C('K', 'D'), C('6', 'C')])
  const afterWin = deal(winShoe).session
  assert.equal(afterWin.stats.rounds, 1)
  assert.equal(afterWin.stats.blackjacks, 1)
  assert.equal(afterWin.stats.handsWon, 1)

  const nextBet = withBet(afterWin, 10)
  const loseShoe = withShoe(nextBet, [C('9'), C('10', 'H'), C('9', 'D'), C('A', 'C')])
  const afterLose = deal(loseShoe).session
  assert.equal(afterLose.stats.rounds, 2)
  assert.equal(afterLose.stats.handsLost, 1)
})

test('isBigWin and the bigWin sound', () => {
  assert.equal(isBigWin(BIG_WIN_NET), true)
  assert.equal(isBigWin(BIG_WIN_NET - 1), false)

  const staked = placeChip(fresh(), 500).session
  const scripted = withShoe(staked, [C('A'), C('9', 'H'), C('K', 'D'), C('6', 'C')])
  const t = deal(scripted) // returned = 500 + 750 = 1250, net = 750 >= BIG_WIN_NET
  assert.ok(t.commands.some((c) => c.type === 'sound' && c.name === 'bigWin'))
})

test('availableActions reflects the rules for each phase', () => {
  const s0 = fresh()
  assert.equal(availableActions(s0).deal, false)
  assert.equal(availableActions(s0).clear, false)

  const staked = withBet(s0, TABLE_MIN_BET)
  assert.equal(availableActions(staked).deal, true)
  assert.equal(availableActions(staked).clear, true)
  assert.equal(availableActions(staked).undo, true)

  const scripted = withShoe(staked, [C('9'), C('9', 'H'), C('8', 'D'), C('6', 'C')])
  const dealt = deal(scripted).session
  const dealtActions = availableActions(dealt)
  assert.equal(dealtActions.hit, true)
  assert.equal(dealtActions.stand, true)
  assert.equal(dealtActions.double, true)
  assert.equal(dealtActions.split, false) // 9,8 is not a pair

  const insuranceOffered = deal(withShoe(staked, [C('9'), C('A', 'H'), C('8', 'D'), C('6', 'C')])).session
  assert.equal(availableActions(insuranceOffered).insurance, true)
})

test('hintFor returns the basic-strategy action during the player phase, and null elsewhere', () => {
  const s0 = fresh()
  assert.equal(hintFor(s0), null)

  const staked = withBet(s0, 10)
  const scripted = withShoe(staked, [C('10'), C('7', 'H'), C('6', 'D'), C('9', 'C')])
  const dealt = deal(scripted).session // player 16 vs dealer 7: basic strategy hits
  assert.equal(hintFor(dealt), 'hit')
})

test('isBroke and refill', () => {
  const s0 = fresh()
  assert.equal(isBroke(s0), false)

  const broke: Session = { ...s0, bankroll: 0, bet: 0 }
  assert.equal(isBroke(broke), true)

  const refilled = refill(broke)
  assert.equal(refilled.session.bankroll, STARTING_BANKROLL)
  assert.ok(refilled.commands.some((c) => c.type === 'sound' && c.name === 'refill'))
  assert.ok(refilled.commands.some((c) => c.type === 'save'))

  const stakedOnly: Session = { ...s0, bankroll: 0, bet: 5 }
  assert.equal(isBroke(stakedOnly), false)

  const midRound: Session = { ...s0, phase: 'player', bankroll: 0 }
  assert.equal(isBroke(midRound), false)
})

test('determinism: the same seed and the same actions give equal sessions', () => {
  function run(): Session {
    let session = createSession(null, 777)
    session = placeChip(session, 25).session
    session = placeChip(session, 5).session
    let t: Transition = deal(session)
    session = t.session
    if (session.phase === 'insurance') {
      t = answerInsurance(session, false)
      session = t.session
    }
    while (session.phase === 'player') {
      const hint = hintFor(session)
      const actions = availableActions(session)
      if (hint === 'double' && actions.double) t = double(session)
      else if (hint === 'split' && actions.split) t = split(session)
      else if (hint === 'stand') t = stand(session)
      else t = hit(session)
      session = t.session
    }
    return session
  }
  assert.deepEqual(run(), run())
})

test('a long random playthrough never throws, keeps the bankroll non-negative, and conserves credits outside settlement', () => {
  const rand = makeLcg(0xc0ffee)
  let session = createSession(null, 42)
  let expectedCredits = creditsValue(session)

  for (let i = 0; i < 3000; i++) {
    if (isBroke(session)) {
      session = refill(session).session
      expectedCredits = creditsValue(session)
      continue
    }

    const beforePhase = session.phase
    const actions = availableActions(session)
    const roll = rand()
    let t: Transition

    if (session.phase === 'betting') {
      if (actions.deal && roll < 0.5) t = deal(session)
      else if (actions.undo && roll < 0.6) t = undoChip(session)
      else if (actions.clear && roll < 0.65) t = clearBet(session)
      else if (actions.rebet && roll < 0.75) t = rebet(session)
      else if (actions.doubleBet && roll < 0.8) t = doubleBet(session)
      else {
        const chips = [1, 5, 25, 100, 500] as const
        t = placeChip(session, chips[Math.floor(rand() * chips.length)]!)
      }
    } else if (session.phase === 'insurance') {
      t = answerInsurance(session, roll < 0.5)
    } else if (session.phase === 'player') {
      if (actions.double && roll < 0.15) t = double(session)
      else if (actions.split && roll < 0.3) t = split(session)
      else if (actions.hit && roll < 0.75) t = hit(session)
      else t = stand(session)
    } else {
      t = actions.rebet && roll < 0.5 ? rebet(session) : { session: beginBetting(session), commands: [] }
    }

    session = t.session
    assert.ok(session.bankroll >= 0, `negative bankroll at step ${i}`)

    if (beforePhase !== 'result' && session.phase === 'result') {
      for (const hand of session.hands) assert.ok(hand.returned >= 0, `negative returned at step ${i}`)
      expectedCredits += session.lastResult!.net
    }

    assert.equal(creditsValue(session), expectedCredits, `credits mismatch at step ${i}`)
  }

  assert.ok(session.stats.rounds > 0)
})

test('deal saves the session with the stake already taken off the bankroll', () => {
  const staked = withBet(fresh(), 10)
  const scripted = withShoe(staked, [C('4'), C('9', 'H'), C('5', 'D'), C('6', 'C')])
  const t = deal(scripted)
  assert.ok(t.commands.some((c) => c.type === 'save'))
  assert.equal(toSave(t.session).bankroll, STARTING_BANKROLL - 10)
})

test('refill is a no-op unless the player is broke', () => {
  const s = withBet(fresh(), 10)
  assert.deepEqual(refill(s), { session: s, commands: [] })
  const broke: Session = { ...fresh(), bankroll: 0 }
  assert.equal(refill(broke).session.bankroll, STARTING_BANKROLL)
})

test('parseSessionSave rejects an absurd bankroll', () => {
  const save = { version: 1, bankroll: 1e300, history: [], stats: fresh().stats }
  assert.equal(parseSessionSave(save), null)
  assert.notEqual(parseSessionSave({ ...save, bankroll: 1e9 }), null)
})
