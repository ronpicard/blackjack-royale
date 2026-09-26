import type { Card, HandOutcome, Suit } from '../game/types.ts'
import type { HudHand, HudSnapshot } from '../render/engineApi.ts'
import { formatCredits } from './Hud.tsx'

interface CardOverlayProps {
  hud: HudSnapshot | null
}

const SUIT_GLYPH: Record<Suit, string> = { S: '♠', H: '♥', D: '♦', C: '♣' }

function suitClass(suit: Suit): string {
  return suit === 'H' || suit === 'D' ? 'card-face-red' : 'card-face-black'
}

function outcomeLabel(outcome: HandOutcome): string {
  return outcome === 'blackjack' ? 'Blackjack' : outcome.charAt(0).toUpperCase() + outcome.slice(1)
}

function outcomeClass(outcome: HandOutcome): string {
  return outcome === 'bust' ? 'hud-outcome-lose' : `hud-outcome-${outcome}`
}

/** One large card face. Keyed by position so a newly dealt card fades in while the rest stay put. */
function CardFace({ card }: { card: Card }) {
  const glyph = SUIT_GLYPH[card.suit]
  return (
    <div className={`card-face ${suitClass(card.suit)}`} aria-label={`${card.rank} of ${card.suit}`}>
      <span className="card-face-corner">
        <span className="card-face-rank">{card.rank}</span>
        <span className="card-face-suit">{glyph}</span>
      </span>
      <span className="card-face-pip">{glyph}</span>
      <span className="card-face-corner card-face-corner-bottom">
        <span className="card-face-rank">{card.rank}</span>
        <span className="card-face-suit">{glyph}</span>
      </span>
    </div>
  )
}

function CardBack() {
  return <div className="card-face card-back" aria-label="Face-down card" />
}

function totalText(total: number, soft: boolean): string {
  return `${total}${soft ? ' soft' : ''}`
}

function HandRow({ hand, index }: { hand: HudHand; index: number }) {
  const className = `card-overlay-row${hand.active ? ' card-overlay-row-active' : ''}${
    hand.outcome ? ` ${outcomeClass(hand.outcome)}` : ''
  }`
  return (
    <div className={className}>
      <div className="card-overlay-label">
        <span className="card-overlay-title">Hand {index + 1}</span>
        <span className="card-overlay-total">{totalText(hand.total, hand.soft)}</span>
        <span className="card-overlay-meta">
          {hand.outcome ? outcomeLabel(hand.outcome) : `Bet ${formatCredits(hand.bet)}`}
        </span>
      </div>
      <div className="card-overlay-cards">
        {hand.cards.map((card, i) => (
          <CardFace key={`${i}-${card.rank}${card.suit}`} card={card} />
        ))}
      </div>
    </div>
  )
}

/**
 * A 2D copy of the cards in play, fading in over the 3D table as each card lands so the hand is
 * readable at any camera distance. Shows the dealer's visible cards (with a face-down back for
 * the hole card) and every player hand, and hides itself between rounds.
 */
export default function CardOverlay({ hud }: CardOverlayProps) {
  const visible = hud !== null && (hud.hands.length > 0 || hud.dealer.cards.length > 0)
  return (
    <div className={`card-overlay${visible ? ' card-overlay-visible' : ''}`} aria-hidden={!visible}>
      {hud && visible && (
        <>
          <div className="card-overlay-row card-overlay-dealer">
            <div className="card-overlay-label">
              <span className="card-overlay-title">Dealer</span>
              <span className="card-overlay-total">
                {totalText(hud.dealer.total, hud.dealer.soft)}
                {hud.dealer.holeHidden ? ' + ?' : ''}
              </span>
            </div>
            <div className="card-overlay-cards">
              {hud.dealer.cards.map((card, i) => (
                <CardFace key={`${i}-${card.rank}${card.suit}`} card={card} />
              ))}
              {hud.dealer.holeHidden && hud.dealer.cards.length > 0 && <CardBack key="hole" />}
            </div>
          </div>
          {hud.hands.map((hand, i) => (
            <HandRow key={i} hand={hand} index={i} />
          ))}
        </>
      )}
    </div>
  )
}
