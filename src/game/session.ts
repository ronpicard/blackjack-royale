/**
 * Session rules: the pure state machine behind a play session (bankroll, the circle bet, the
 * shoe, the player's hands, the dealer, insurance, history and stats). Every transition takes a
 * `Session` and returns a new `Transition` (a new `Session` plus the `Command`s the engine should
 * run); nothing here mutates its input, touches the DOM, or calls `Math.random`/`Date`.
 */

import type {
  AvailableActions,
  ChipValue,
  Command,
  Hand,
  HandOutcome,
  HandStatus,
  PlayerAction,
  RoundResult,
  Session,
  SessionSave,
  SessionStats,
  Transition,
} from './types.ts'
import { CUT_CARD_REMAINING, buildShoe, handValue, isBlackjack, isPair, shuffle } from './cards.ts'
import { createRng } from './rng.ts'
import { basicStrategy } from './strategy.ts'

export const STARTING_BANKROLL = 1000
export const TABLE_MIN_BET = 5
export const TABLE_MAX_BET = 500
/** Most recent round outcomes kept in `Session.history`. `toSave` caps further, at 50. */
export const HISTORY_LENGTH = 200
export const SAVE_HISTORY_LENGTH = 50
/** A round netting at least this much draws the `bigWin` sound and the crowd's loudest cheer. */
export const BIG_WIN_NET = 250

const INSURANCE_MESSAGE_SECONDS = 4
const RESULT_MESSAGE_SECONDS = 3

/** Whether a round's net win is big enough for the `bigWin` sound. */
export function isBigWin(net: number): boolean {
  return net >= BIG_WIN_NET
}

function freshStats(): SessionStats {
  return {
    rounds: 0,
    handsWon: 0,
    handsLost: 0,
    handsPushed: 0,
    blackjacks: 0,
    biggestWin: 0,
    peakBankroll: STARTING_BANKROLL,
  }
}

function noChange(session: Session): Transition {
  return { session, commands: [] }
}

/** Creates a fresh session, or restores one from a validated save; the shoe always starts fresh. */
export function createSession(save: SessionSave | null, seed: number): Session {
  return {
    phase: 'betting',
    bankroll: save ? save.bankroll : STARTING_BANKROLL,
    bet: 0,
    undo: [],
    lastBet: null,
    shoe: shuffle(buildShoe(), createRng(seed)),
    discards: 0,
    shuffles: 1,
    hands: [],
    activeHand: 0,
    dealer: { cards: [], holeRevealed: false },
    insurance: 0,
    lastResult: null,
    history: save ? save.history.slice(0, HISTORY_LENGTH) : [],
    stats: save ? { ...save.stats } : freshStats(),
  }
}

/** Opens betting again after a result: clears the round but keeps `lastBet` for `rebet`. */
export function beginBetting(s: Session): Session {
  return {
    ...s,
    phase: 'betting',
    bet: 0,
    undo: [],
    hands: [],
    activeHand: 0,
    dealer: { cards: [], holeRevealed: false },
    insurance: 0,
    lastResult: null,
  }
}

function toBetting(s: Session): Session {
  return s.phase === 'result' ? beginBetting(s) : s
}

/** Stakes `value` on the circle; clamped to nothing (rejected) past the bankroll or the table max. */
export function placeChip(s: Session, value: ChipValue): Transition {
  if (s.phase !== 'betting' && s.phase !== 'result') return noChange(s)
  const session = toBetting(s)
  if (session.bankroll < value || session.bet + value > TABLE_MAX_BET) return { session, commands: [] }
  return {
    session: { ...session, bankroll: session.bankroll - value, bet: session.bet + value, undo: [...session.undo, value] },
    commands: [{ type: 'sound', name: 'chip' }],
  }
}

/** Pops the last chip placed this betting round and returns it to the bankroll. */
export function undoChip(s: Session): Transition {
  if (s.phase !== 'betting' || s.undo.length === 0) return noChange(s)
  const value = s.undo[s.undo.length - 1]!
  return {
    session: { ...s, bankroll: s.bankroll + value, bet: s.bet - value, undo: s.undo.slice(0, -1) },
    commands: [{ type: 'sound', name: 'chipRemove' }],
  }
}

/** Returns the whole circle bet to the bankroll and empties the undo stack. */
export function clearBet(s: Session): Transition {
  if (s.phase !== 'betting' || s.bet === 0) return noChange(s)
  return {
    session: { ...s, bankroll: s.bankroll + s.bet, bet: 0, undo: [] },
    commands: [{ type: 'sound', name: 'clear' }],
  }
}

/** Stakes `lastBet` again, capped by the bankroll and the table max. */
export function rebet(s: Session): Transition {
  if (s.phase !== 'betting' && s.phase !== 'result') return noChange(s)
  const session = toBetting(s)
  if (session.lastBet === null || session.bankroll < session.lastBet) return { session, commands: [] }
  const room = TABLE_MAX_BET - session.bet
  const amount = Math.min(session.lastBet, session.bankroll, room)
  if (amount <= 0) return { session, commands: [] }
  return {
    session: { ...session, bankroll: session.bankroll - amount, bet: session.bet + amount, undo: [] },
    commands: [{ type: 'sound', name: 'chip' }],
  }
}

/** Doubles the circle bet, capped by the bankroll and the table max; rejected with nothing staked. */
export function doubleBet(s: Session): Transition {
  if (s.phase !== 'betting' || s.bet <= 0) return noChange(s)
  const cost = Math.min(s.bet, TABLE_MAX_BET - s.bet, s.bankroll)
  if (cost <= 0) return noChange(s)
  return {
    session: { ...s, bankroll: s.bankroll - cost, bet: s.bet + cost, undo: [] },
    commands: [{ type: 'sound', name: 'chip' }],
  }
}

/** Deals a fresh round: reshuffles under the cut card, then player/dealer/player/dealer-down. */
export function deal(s: Session): Transition {
  if (s.phase !== 'betting' || s.bet < TABLE_MIN_BET) return noChange(s)

  const commands: Command[] = []
  let session = s

  if (session.shoe.length < CUT_CARD_REMAINING) {
    session = {
      ...session,
      shoe: shuffle(buildShoe(), createRng(session.shuffles * 7919 + 17)),
      shuffles: session.shuffles + 1,
      discards: 0,
    }
    commands.push({ type: 'shuffle' })
    commands.push({ type: 'sound', name: 'shuffle' })
  }

  const betAmount = session.bet
  const openingHand: Hand = {
    cards: [],
    bet: betAmount,
    status: 'playing',
    doubled: false,
    fromSplit: false,
    splitAces: false,
    outcome: null,
    returned: 0,
  }
  session = {
    ...session,
    hands: [openingHand],
    lastBet: betAmount,
    bet: 0,
    activeHand: 0,
    undo: [],
    dealer: { cards: [], holeRevealed: false },
    insurance: 0,
    lastResult: null,
  }

  const steps: readonly { target: 'player' | 'dealer'; faceDown: boolean }[] = [
    { target: 'player', faceDown: false },
    { target: 'dealer', faceDown: false },
    { target: 'player', faceDown: false },
    { target: 'dealer', faceDown: true },
  ]

  // Persist the stake now so a reload mid-round cannot refund a losing hand.
  commands.push({ type: 'save' })

  for (const step of steps) {
    const [card, ...rest] = session.shoe
    session = { ...session, shoe: rest, discards: session.discards + 1 }
    commands.push({ type: 'sound', name: 'deal' })
    if (step.target === 'player') {
      const hand0 = session.hands[0]!
      session = { ...session, hands: [{ ...hand0, cards: [...hand0.cards, card!] }] }
      commands.push({ type: 'deal', to: 0, card: card!, faceDown: false })
    } else {
      session = { ...session, dealer: { ...session.dealer, cards: [...session.dealer.cards, card!] } }
      commands.push({ type: 'deal', to: 'dealer', card: card!, faceDown: step.faceDown })
    }
  }

  const dealerUp = session.dealer.cards[0]!
  if (dealerUp.rank === 'A') {
    const premium = Math.max(1, Math.floor(session.hands[0]!.bet / 2))
    if (session.bankroll >= premium) {
      session = { ...session, phase: 'insurance' }
      commands.push({ type: 'message', text: 'Insurance?', seconds: INSURANCE_MESSAGE_SECONDS })
      return { session, commands }
    }
  }

  const peeked = resolvePeek(session)
  return { session: peeked.session, commands: [...commands, ...peeked.commands] }
}

/** Answers the insurance offer; either way, the dealer then peeks for blackjack. */
export function answerInsurance(s: Session, take: boolean): Transition {
  if (s.phase !== 'insurance') return noChange(s)
  const commands: Command[] = []
  let session = s
  if (take) {
    const premium = Math.max(1, Math.floor(session.hands[0]!.bet / 2))
    session = { ...session, bankroll: session.bankroll - premium, insurance: premium }
    commands.push({ type: 'sound', name: 'insurance' })
  }
  const peeked = resolvePeek(session)
  return { session: peeked.session, commands: [...commands, ...peeked.commands] }
}

/**
 * The dealer peeks under a ten or an ace. Blackjack ends the round at once; a player blackjack
 * (with no dealer blackjack) also settles at once, before any dealer draw; otherwise a taken
 * insurance loses its premium and play moves to the first hand.
 */
function resolvePeek(s: Session): Transition {
  const commands: Command[] = []
  let session = s
  const hand = s.hands[0]!
  const dealerHasBlackjack = s.dealer.cards.length === 2 && handValue(s.dealer.cards).total === 21

  if (dealerHasBlackjack) {
    commands.push({ type: 'reveal', card: s.dealer.cards[1]! })
    session = { ...session, dealer: { ...session.dealer, holeRevealed: true } }
    let insuranceWon = false
    if (session.insurance > 0) {
      insuranceWon = true
      const insuranceReturned = session.insurance * 3
      commands.push({ type: 'insurance', won: true, returned: insuranceReturned })
      session = { ...session, bankroll: session.bankroll + insuranceReturned }
    }
    const playerBlackjack = isBlackjack(hand)
    const outcome: HandOutcome = playerBlackjack ? 'push' : 'lose'
    const returned = playerBlackjack ? hand.bet : 0
    commands.push({ type: 'settle', hand: 0, outcome, returned })
    session = { ...session, hands: [{ ...hand, outcome, returned }], bankroll: session.bankroll + returned }
    return finishRound(session, commands, insuranceWon)
  }

  if (isBlackjack(hand)) {
    commands.push({ type: 'reveal', card: s.dealer.cards[1]! })
    session = { ...session, dealer: { ...session.dealer, holeRevealed: true } }
    if (session.insurance > 0) commands.push({ type: 'insurance', won: false, returned: 0 })
    const returned = hand.bet + Math.floor((hand.bet * 3) / 2)
    commands.push({ type: 'settle', hand: 0, outcome: 'blackjack', returned })
    session = { ...session, hands: [{ ...hand, outcome: 'blackjack', returned }], bankroll: session.bankroll + returned }
    return finishRound(session, commands, false)
  }

  if (session.insurance > 0) commands.push({ type: 'insurance', won: false, returned: 0 })
  return { session: { ...session, phase: 'player', activeHand: 0 }, commands }
}

/** Hits the active hand: one card, then bust or an automatic stand on 21. */
export function hit(s: Session): Transition {
  if (s.phase !== 'player') return noChange(s)
  const hand = s.hands[s.activeHand]
  if (!hand || hand.status !== 'playing') return noChange(s)

  const [card, ...rest] = s.shoe
  const newCards = [...hand.cards, card!]
  const total = handValue(newCards).total
  const status: HandStatus = total > 21 ? 'bust' : total === 21 ? 'stood' : 'playing'
  const hands = [...s.hands]
  hands[s.activeHand] = { ...hand, cards: newCards, status }

  const commands: Command[] = [
    { type: 'sound', name: 'hit' },
    { type: 'deal', to: s.activeHand, card: card!, faceDown: false },
  ]
  if (status === 'bust') {
    commands.push({ type: 'bust', hand: s.activeHand })
    commands.push({ type: 'sound', name: 'bust' })
  }

  return advance({ ...s, shoe: rest, discards: s.discards + 1, hands }, commands)
}

/** Stands on the active hand. */
export function stand(s: Session): Transition {
  if (s.phase !== 'player') return noChange(s)
  const hand = s.hands[s.activeHand]
  if (!hand || hand.status !== 'playing') return noChange(s)
  const hands = [...s.hands]
  hands[s.activeHand] = { ...hand, status: 'stood' }
  return advance({ ...s, hands }, [{ type: 'sound', name: 'stand' }])
}

/** Doubles the active hand's stake for exactly one more card, then stands (or busts). */
export function double(s: Session): Transition {
  if (s.phase !== 'player') return noChange(s)
  const hand = s.hands[s.activeHand]
  if (!hand || hand.status !== 'playing' || hand.cards.length !== 2 || s.bankroll < hand.bet) return noChange(s)

  const [card, ...rest] = s.shoe
  const newCards = [...hand.cards, card!]
  const total = handValue(newCards).total
  const status: HandStatus = total > 21 ? 'bust' : 'stood'
  const hands = [...s.hands]
  hands[s.activeHand] = { ...hand, cards: newCards, bet: hand.bet * 2, doubled: true, status }

  const commands: Command[] = [
    { type: 'double', hand: s.activeHand },
    { type: 'sound', name: 'hit' },
    { type: 'deal', to: s.activeHand, card: card!, faceDown: false },
  ]
  if (status === 'bust') {
    commands.push({ type: 'bust', hand: s.activeHand })
    commands.push({ type: 'sound', name: 'bust' })
  }

  const session: Session = { ...s, bankroll: s.bankroll - hand.bet, shoe: rest, discards: s.discards + 1, hands }
  return advance(session, commands)
}

/** Splits a pair into two hands (up to four total), dealing one card to each. */
export function split(s: Session): Transition {
  if (s.phase !== 'player') return noChange(s)
  const hand = s.hands[s.activeHand]
  if (!hand || hand.status !== 'playing' || !isPair(hand.cards) || s.hands.length >= 4 || s.bankroll < hand.bet) {
    return noChange(s)
  }

  const isAces = hand.cards[0]!.rank === 'A'
  const handA: Hand = { cards: [hand.cards[0]!], bet: hand.bet, status: 'playing', doubled: false, fromSplit: true, splitAces: isAces, outcome: null, returned: 0 }
  const handB: Hand = { cards: [hand.cards[1]!], bet: hand.bet, status: 'playing', doubled: false, fromSplit: true, splitAces: isAces, outcome: null, returned: 0 }
  const hands = [...s.hands]
  hands.splice(s.activeHand, 1, handA, handB)

  let session: Session = { ...s, bankroll: s.bankroll - hand.bet, hands }
  const commands: Command[] = [{ type: 'split', hand: s.activeHand }]

  for (const offset of [0, 1]) {
    const idx = s.activeHand + offset
    const [card, ...rest] = session.shoe
    const target = session.hands[idx]!
    const newCards = [...target.cards, card!]
    let status: HandStatus = 'playing'
    if (isAces) status = 'stood'
    else if (offset === 0 && handValue(newCards).total === 21) status = 'stood'
    const updatedHands = [...session.hands]
    updatedHands[idx] = { ...target, cards: newCards, status }
    session = { ...session, shoe: rest, discards: session.discards + 1, hands: updatedHands }
    commands.push({ type: 'sound', name: 'hit' })
    commands.push({ type: 'deal', to: idx, card: card!, faceDown: false })
  }

  return advance(session, commands)
}

/** Moves to the next hand still `playing`; when none is left, plays out and settles the dealer. */
function advance(s: Session, commands: Command[]): Transition {
  for (let i = s.activeHand; i < s.hands.length; i++) {
    if (s.hands[i]!.status === 'playing') {
      const session = i === s.activeHand ? s : { ...s, activeHand: i }
      return { session, commands }
    }
  }
  const played = playDealer(s)
  return { session: played.session, commands: [...commands, ...played.commands] }
}

/** Reveals the hole card and draws to 17+ (standing on soft 17), unless every hand already busted. */
function playDealer(s: Session): Transition {
  let session: Session = { ...s, dealer: { ...s.dealer, holeRevealed: true } }
  const commands: Command[] = [{ type: 'reveal', card: s.dealer.cards[1]! }, { type: 'sound', name: 'flip' }]

  const everyHandBust = session.hands.every((hand) => hand.status === 'bust')
  if (!everyHandBust) {
    while (handValue(session.dealer.cards).total < 17) {
      const [card, ...rest] = session.shoe
      session = {
        ...session,
        shoe: rest,
        discards: session.discards + 1,
        dealer: { ...session.dealer, cards: [...session.dealer.cards, card!] },
      }
      commands.push({ type: 'sound', name: 'deal' })
      commands.push({ type: 'deal', to: 'dealer', card: card!, faceDown: false })
    }
    if (handValue(session.dealer.cards).total > 21) {
      commands.push({ type: 'bust', hand: 'dealer' })
      commands.push({ type: 'message', text: 'Dealer busts', seconds: RESULT_MESSAGE_SECONDS })
    }
  }

  const dealerValue = handValue(session.dealer.cards)
  const dealerBust = dealerValue.total > 21
  const settledHands = session.hands.map((hand): Hand => {
    let outcome: HandOutcome
    let returned: number
    if (hand.status === 'bust') {
      outcome = 'bust'
      returned = 0
    } else if (dealerBust) {
      outcome = 'win'
      returned = hand.bet * 2
    } else {
      const total = handValue(hand.cards).total
      if (total > dealerValue.total) {
        outcome = 'win'
        returned = hand.bet * 2
      } else if (total < dealerValue.total) {
        outcome = 'lose'
        returned = 0
      } else {
        outcome = 'push'
        returned = hand.bet
      }
    }
    return { ...hand, outcome, returned }
  })

  for (let i = 0; i < settledHands.length; i++) {
    commands.push({ type: 'settle', hand: i, outcome: settledHands[i]!.outcome!, returned: settledHands[i]!.returned })
  }

  const bankroll = session.bankroll + settledHands.reduce((sum, hand) => sum + hand.returned, 0)
  session = { ...session, hands: settledHands, bankroll }

  return finishRound(session, commands, false)
}

/** Ends the round: computes `lastResult`, updates history/stats, and plays the closing sounds. */
function finishRound(session: Session, commands: Command[], insuranceWon: boolean): Transition {
  const dealerTotal = handValue(session.dealer.cards).total
  const dealerBlackjack = session.dealer.cards.length === 2 && dealerTotal === 21
  const insuranceReturned = insuranceWon ? session.insurance * 3 : 0
  const staked = session.hands.reduce((sum, hand) => sum + hand.bet, 0) + session.insurance
  const returned = session.hands.reduce((sum, hand) => sum + hand.returned, 0) + insuranceReturned
  const net = returned - staked
  const outcome = session.hands[0]!.outcome!

  const result: RoundResult = {
    staked,
    returned,
    net,
    outcome,
    hands: session.hands.map((hand) => ({ outcome: hand.outcome!, total: handValue(hand.cards).total, bet: hand.bet, returned: hand.returned })),
    dealerTotal,
    dealerBlackjack,
    insuranceWon,
  }

  const history = [outcome, ...session.history].slice(0, HISTORY_LENGTH)
  const hasBlackjack = session.hands.some((hand) => hand.outcome === 'blackjack')
  const stats: SessionStats = {
    rounds: session.stats.rounds + 1,
    handsWon: session.stats.handsWon + session.hands.filter((hand) => hand.outcome === 'win' || hand.outcome === 'blackjack').length,
    handsLost: session.stats.handsLost + session.hands.filter((hand) => hand.outcome === 'lose' || hand.outcome === 'bust').length,
    handsPushed: session.stats.handsPushed + session.hands.filter((hand) => hand.outcome === 'push').length,
    blackjacks: session.stats.blackjacks + session.hands.filter((hand) => hand.outcome === 'blackjack').length,
    biggestWin: Math.max(session.stats.biggestWin, net),
    peakBankroll: Math.max(session.stats.peakBankroll, session.bankroll),
  }

  const resultCommands: Command[] = [...commands]
  if (hasBlackjack) resultCommands.push({ type: 'sound', name: 'blackjack' })
  else if (net > 0) resultCommands.push({ type: 'sound', name: 'win' })
  else if (net === 0 && staked > 0) resultCommands.push({ type: 'sound', name: 'push' })
  else if (net < 0) resultCommands.push({ type: 'sound', name: 'lose' })
  if (isBigWin(net)) resultCommands.push({ type: 'sound', name: 'bigWin' })

  const message = hasBlackjack ? 'Blackjack!' : net > 0 ? 'You win' : net === 0 ? 'Push' : 'Dealer wins'
  resultCommands.push({ type: 'message', text: message, seconds: RESULT_MESSAGE_SECONDS })
  resultCommands.push({ type: 'save' })

  return {
    session: { ...session, phase: 'result', lastResult: result, history, stats },
    commands: resultCommands,
  }
}

/** What the player may currently do, matching the rules the transitions above enforce. */
export function availableActions(s: Session): AvailableActions {
  const canDeal = s.phase === 'betting' && s.bet >= TABLE_MIN_BET
  const canUndo = s.phase === 'betting' && s.undo.length > 0
  const canClear = s.phase === 'betting' && s.bet > 0
  const canRebet =
    ((s.phase === 'betting' && s.bet === 0) || s.phase === 'result') && s.lastBet !== null && s.bankroll >= s.lastBet
  const doubleBetCost = s.phase === 'betting' ? Math.min(s.bet, TABLE_MAX_BET - s.bet) : 0
  const canDoubleBet = s.phase === 'betting' && s.bet > 0 && doubleBetCost > 0 && s.bankroll >= doubleBetCost

  const hand = s.phase === 'player' ? s.hands[s.activeHand] : undefined
  const isActingHand = s.phase === 'player' && hand !== undefined && hand.status === 'playing'
  const canDouble = isActingHand && hand!.cards.length === 2 && s.bankroll >= hand!.bet
  const canSplit = isActingHand && isPair(hand!.cards) && s.hands.length < 4 && s.bankroll >= hand!.bet

  return {
    deal: canDeal,
    hit: isActingHand,
    stand: isActingHand,
    double: canDouble,
    split: canSplit,
    insurance: s.phase === 'insurance',
    undo: canUndo,
    clear: canClear,
    rebet: canRebet,
    doubleBet: canDoubleBet,
  }
}

/** The textbook action for the active hand, or `null` outside the player's turn. */
export function hintFor(s: Session): PlayerAction | null {
  if (s.phase !== 'player') return null
  const hand = s.hands[s.activeHand]
  if (!hand || hand.status !== 'playing') return null
  const actions = availableActions(s)
  return basicStrategy(hand.cards, s.dealer.cards[0]!, { canDouble: actions.double, canSplit: actions.split })
}

/** Restores the starting bankroll and clears the round; used once the player is broke. */
export function refill(s: Session): Transition {
  if (!isBroke(s)) return noChange(s)
  return {
    session: {
      ...s,
      bankroll: STARTING_BANKROLL,
      phase: 'betting',
      bet: 0,
      undo: [],
      hands: [],
      activeHand: 0,
      dealer: { cards: [], holeRevealed: false },
      insurance: 0,
      lastResult: null,
    },
    commands: [{ type: 'sound', name: 'refill' }, { type: 'save' }],
  }
}

/** True when the player has nothing left to bet with and no round is in progress. */
export function isBroke(s: Session): boolean {
  return (s.phase === 'betting' || s.phase === 'result') && s.bankroll + s.bet < TABLE_MIN_BET
}

/** What gets written to storage; folds any (uncommitted) circle bet back into the bankroll. */
export function toSave(s: Session): SessionSave {
  return {
    version: 1,
    bankroll: s.bankroll + s.bet,
    history: s.history.slice(0, SAVE_HISTORY_LENGTH),
    stats: { ...s.stats },
  }
}

/** Hand-edited saves above this are treated as corrupt rather than shown on the HUD. */
const MAX_SAVED_BANKROLL = 1e9

function isFiniteNonNegative(n: unknown): n is number {
  return typeof n === 'number' && Number.isFinite(n) && n >= 0
}

const VALID_OUTCOMES: ReadonlySet<string> = new Set(['blackjack', 'win', 'push', 'lose', 'bust'])

/** Validates a value read from localStorage. Anything malformed becomes `null`. */
export function parseSessionSave(raw: unknown): SessionSave | null {
  if (typeof raw !== 'object' || raw === null) return null
  const value = raw as Record<string, unknown>
  if (value.version !== 1) return null

  const bankroll = value.bankroll
  if (!isFiniteNonNegative(bankroll) || bankroll > MAX_SAVED_BANKROLL) return null

  const historyRaw = value.history
  if (!Array.isArray(historyRaw) || historyRaw.length > HISTORY_LENGTH) return null
  const history: HandOutcome[] = []
  for (const outcome of historyRaw) {
    if (typeof outcome !== 'string' || !VALID_OUTCOMES.has(outcome)) return null
    history.push(outcome as HandOutcome)
  }

  const statsRaw = value.stats
  if (typeof statsRaw !== 'object' || statsRaw === null) return null
  const stats = statsRaw as Record<string, unknown>
  const { rounds, handsWon, handsLost, handsPushed, blackjacks, biggestWin, peakBankroll } = stats
  if (!isFiniteNonNegative(rounds) || !isFiniteNonNegative(handsWon) || !isFiniteNonNegative(handsLost)) return null
  if (!isFiniteNonNegative(handsPushed) || !isFiniteNonNegative(blackjacks)) return null
  if (typeof biggestWin !== 'number' || !Number.isFinite(biggestWin)) return null
  if (!isFiniteNonNegative(peakBankroll)) return null

  return {
    version: 1,
    bankroll,
    history: history.slice(0, SAVE_HISTORY_LENGTH),
    stats: { rounds, handsWon, handsLost, handsPushed, blackjacks, biggestWin, peakBankroll },
  }
}
