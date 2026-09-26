/**
 * Where everything stands in the world, in inches. three.js world axes: `y` is up, the player
 * sits on the `+z` side of the table looking toward `-z`, the dealer stands on the `-z` side.
 * The floor is `y = 0`.
 *
 * The table is a half-moon: a straight dealer edge along `z = TABLE_MIN_Z` and a semicircular
 * player edge of radius `TABLE_RADIUS` centred on `(TABLE_CENTER_X, TABLE_MIN_Z)`. The player's
 * betting circle sits on the felt at `BET_CIRCLE_Z`; the dealer's cards lie at `DEALER_CARD_Z`.
 */

/** Height of the felt. */
export const TABLE_HEIGHT = 30

export const TABLE_CENTER_X = 0
export const TABLE_RADIUS = 42

/**
 * Outer edge of the table top, including its padded rail, in world `x` and `z`. The dealer edge
 * is straight at `TABLE_MIN_Z`; the player edge is the semicircle, so `TABLE_MAX_Z` is
 * `TABLE_MIN_Z + TABLE_RADIUS`.
 */
export const TABLE_MIN_X = TABLE_CENTER_X - TABLE_RADIUS
export const TABLE_MAX_X = TABLE_CENTER_X + TABLE_RADIUS
export const TABLE_MIN_Z = -18
export const TABLE_MAX_Z = TABLE_MIN_Z + TABLE_RADIUS

/** The padded rail is this wide; the felt is the table top inside it. */
export const RAIL_WIDTH = 4

/** Centre of the player's betting circle on the felt. */
export const BET_CIRCLE_X = 0
export const BET_CIRCLE_Z = 10
export const BET_CIRCLE_RADIUS = 3.6

/** The player's cards are dealt just beyond (toward the dealer from) the betting circle. */
export const PLAYER_CARD_Z = 1
/** Split hands are spread along `x`, this far apart, centred on `BET_CIRCLE_X`. */
export const SPLIT_HAND_SPACING = 12

/** The dealer's cards lie in a row along `x`, centred on the table, this far from the dealer edge. */
export const DEALER_CARD_X = 0
export const DEALER_CARD_Z = -9

/** Dealt cards overlap in a diagonal cascade: each card is offset this much from the previous one. */
export const CARD_STEP_X = 1.6
export const CARD_STEP_Z = -1.1

/** Playing card size (a bridge card), and the thickness of one card. */
export const CARD_WIDTH = 2.25
export const CARD_HEIGHT = 3.5
export const CARD_THICKNESS = 0.012

/** The shoe stands on the felt at the dealer's left (the player's right). Cards leave it toward -x. */
export const SHOE_X = 26
export const SHOE_Z = -12
/** The discard tray stands at the dealer's right. */
export const DISCARD_X = -26
export const DISCARD_Z = -12
/** The chip tray is set into the felt in front of the dealer, along the dealer edge. */
export const CHIP_TRAY_X = 0
export const CHIP_TRAY_Z = -15.5

/** Where the dealer stands (the croupier figure of `crowd.ts`), and where the player's eye is. */
export const DEALER_X = 0
export const DEALER_Z = TABLE_MIN_Z - 8
export const PLAYER_EYE = { x: 0, y: 58, z: TABLE_MAX_Z + 18 }

/** The point spectators watch by default: the middle of the cards. */
export const FOCUS_X = 0
export const FOCUS_Y = TABLE_HEIGHT + 2
export const FOCUS_Z = -3

/**
 * The casino room keeps this box clear around the table (floor to ceiling), apart from the stools
 * along the player's side, so every camera view sees the table unobstructed.
 */
export const ROOM_CLEAR_MIN_X = -70
export const ROOM_CLEAR_MAX_X = 70
export const ROOM_CLEAR_MIN_Z = -45
export const ROOM_CLEAR_MAX_Z = 55

export interface Point3 {
  x: number
  y: number
  z: number
}

/** World position of the `x` centre of a player hand, given how many hands are on the table. */
export function handCenterX(handIndex: number, handCount: number): number {
  return BET_CIRCLE_X + (handIndex - (handCount - 1) / 2) * SPLIT_HAND_SPACING
}

/** World position of the centre of card `cardIndex` of a player hand. Cards cascade toward +x and -z. */
export function playerCardPosition(handIndex: number, handCount: number, cardIndex: number): Point3 {
  return {
    x: handCenterX(handIndex, handCount) - CARD_STEP_X * 1.5 + cardIndex * CARD_STEP_X,
    y: TABLE_HEIGHT + CARD_THICKNESS * (cardIndex + 0.5),
    z: PLAYER_CARD_Z + cardIndex * CARD_STEP_Z,
  }
}

/** World position of the centre of dealer card `cardIndex`. The dealer's cards run in a row along +x. */
export function dealerCardPosition(cardIndex: number): Point3 {
  return {
    x: DEALER_CARD_X - CARD_WIDTH * 0.6 + cardIndex * (CARD_WIDTH + 0.35),
    y: TABLE_HEIGHT + CARD_THICKNESS * 0.5,
    z: DEALER_CARD_Z,
  }
}
