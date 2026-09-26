/**
 * Plays a batch of rounds through the real rules in `src/game/session.ts`, betting a flat 10
 * credits and always taking the basic-strategy action (`hintFor`), declining insurance. Reports
 * hand outcomes, blackjack/double/split rates, and the realised return per credit staked, which
 * should land close to the theoretical house edge for six-deck S17 basic strategy (about -0.5%).
 *
 * Usage: `node --experimental-strip-types scripts/simulate.ts [rounds]` (default 20000 rounds).
 */

import type { Session } from '../src/game/types.ts'
import {
  answerInsurance,
  availableActions,
  createSession,
  deal,
  double,
  hintFor,
  hit,
  isBroke,
  placeChip,
  refill,
  split,
  stand,
} from '../src/game/session.ts'

const DEFAULT_ROUND_COUNT = 20000
/** A flat bet of two 5-credit chips, comfortably above the 5-credit table minimum. */
const FLAT_BET = 10

function placeFlatBet(session: Session): Session {
  let s = placeChip(session, 5).session
  s = placeChip(s, 5).session
  return s
}

const roundCount = Number(process.argv[2] ?? DEFAULT_ROUND_COUNT)

console.log(`Simulating ${roundCount} rounds of basic strategy...\n`)

let session = createSession(null, 1)
let hands = 0
let wins = 0
let pushes = 0
let losses = 0
let blackjacks = 0
let doublesTaken = 0
let splitsTaken = 0
let refills = 0
let staked = 0
let returned = 0

for (let i = 0; i < roundCount; i++) {
  if (isBroke(session) || session.bankroll < FLAT_BET) {
    session = refill(session).session
    refills++
  }

  session = placeFlatBet(session)
  session = deal(session).session

  if (session.phase === 'insurance') {
    session = answerInsurance(session, false).session
  }

  while (session.phase === 'player') {
    const hint = hintFor(session)
    if (hint === 'double' && availableActions(session).double) {
      doublesTaken++
      session = double(session).session
    } else if (hint === 'split' && availableActions(session).split) {
      splitsTaken++
      session = split(session).session
    } else if (hint === 'hit') {
      session = hit(session).session
    } else {
      session = stand(session).session
    }
  }

  const result = session.lastResult!
  hands += result.hands.length
  staked += result.staked
  returned += result.returned
  for (const hand of result.hands) {
    if (hand.outcome === 'blackjack') blackjacks++
    if (hand.outcome === 'win' || hand.outcome === 'blackjack') wins++
    else if (hand.outcome === 'push') pushes++
    else losses++
  }
}

const realised = staked > 0 ? returned / staked : 0
const houseEdge = 1 - realised

console.log(`Rounds: ${roundCount}`)
console.log(`Hands played (including splits): ${hands}`)
console.log(`Win rate: ${((wins / hands) * 100).toFixed(2)}%`)
console.log(`Push rate: ${((pushes / hands) * 100).toFixed(2)}%`)
console.log(`Loss rate: ${((losses / hands) * 100).toFixed(2)}%`)
console.log(`Blackjack rate: ${((blackjacks / hands) * 100).toFixed(2)}%`)
console.log(`Doubles taken: ${doublesTaken}`)
console.log(`Splits taken: ${splitsTaken}`)
console.log(`Refills: ${refills}`)
console.log(`Total staked: ${staked.toFixed(0)}`)
console.log(`Total returned: ${returned.toFixed(0)}`)
console.log(`Realised return per credit staked: ${((realised - 1) * 100).toFixed(3)}%`)
console.log(`Realised house edge: ${(houseEdge * 100).toFixed(3)}% (expect about 0.5% +/- 1%)`)
