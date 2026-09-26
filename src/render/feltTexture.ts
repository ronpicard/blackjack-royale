/**
 * The blackjack felt: deep green baize with printed casino markings (the two payout arcs, the
 * insurance band, and the gold betting-circle ring) plus fine fibre grain and a soft vignette. No
 * image files - a fresh canvas drawn per call; the caller owns and disposes the resulting texture.
 *
 * The canvas covers the felt's world footprint exactly: the felt is a half-moon (a straight dealer
 * edge and a semicircular player edge, see `layout.ts`'s module doc) inset from the outer table by
 * the padded rail's `RAIL_WIDTH`, sharing its arc centre with the outer table so the rail reads as
 * a uniform width all the way round. `FELT_MIN_X`/`FELT_MAX_X`/`FELT_MIN_Z`/`FELT_MAX_Z` are that
 * half-moon's bounding box; `texture.flipY = false` keeps canvas row 0 (top, drawn first) at
 * `FELT_MIN_Z` and canvas column 0 at `FELT_MIN_X`, so world `(x, z)` maps to canvas pixels with no
 * separate flip bookkeeping anywhere else (`tableView.ts` builds the felt mesh's UVs the same way).
 */

import * as THREE from 'three'
import {
  BET_CIRCLE_RADIUS,
  BET_CIRCLE_X,
  BET_CIRCLE_Z,
  DEALER_CARD_Z,
  RAIL_WIDTH,
  TABLE_CENTER_X,
  TABLE_MIN_Z,
  TABLE_RADIUS,
} from './layout.ts'

/** The felt's own half-moon: same arc centre as the outer table, radius and flat edge inset by the rail. */
export const FELT_RADIUS = TABLE_RADIUS - RAIL_WIDTH
export const FELT_FLAT_Z = TABLE_MIN_Z + RAIL_WIDTH

export const FELT_MIN_X = TABLE_CENTER_X - FELT_RADIUS
export const FELT_MAX_X = TABLE_CENTER_X + FELT_RADIUS
export const FELT_MIN_Z = FELT_FLAT_Z
export const FELT_MAX_Z = TABLE_MIN_Z + FELT_RADIUS

const FELT_WORLD_WIDTH = FELT_MAX_X - FELT_MIN_X
const FELT_WORLD_HEIGHT = FELT_MAX_Z - FELT_MIN_Z

const CANVAS_WIDTH = 2048
const CANVAS_HEIGHT = Math.round((FELT_WORLD_HEIGHT / FELT_WORLD_WIDTH) * CANVAS_WIDTH)
const PX_PER_INCH = CANVAS_WIDTH / FELT_WORLD_WIDTH

const FELT_GREEN = '#0c3d24'
const CREAM = '#e8dcc0'
const GOLD = '#d4af37'

function mulberry32(seed: number): () => number {
  let a = seed >>> 0
  return () => {
    a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for felt texture')
  return { canvas, ctx }
}

/** World `(x, z)` to canvas pixels. See the module doc comment for the (unflipped) convention. */
function worldToCanvas(x: number, z: number): { px: number; py: number } {
  return { px: (x - FELT_MIN_X) * PX_PER_INCH, py: (z - FELT_MIN_Z) * PX_PER_INCH }
}

function fillBackground(ctx: CanvasRenderingContext2D): void {
  ctx.fillStyle = FELT_GREEN
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)

  // Fine fibre grain: short faint strokes at random angles, seeded for a stable look.
  const rand = mulberry32(0x8b1af2)
  ctx.save()
  ctx.globalAlpha = 0.05
  for (let i = 0; i < 14000; i++) {
    const x = rand() * CANVAS_WIDTH
    const y = rand() * CANVAS_HEIGHT
    const len = 1.5 + rand() * 3
    const angle = rand() * Math.PI
    ctx.strokeStyle = rand() > 0.5 ? '#155232' : '#062315'
    ctx.lineWidth = 1
    ctx.beginPath()
    ctx.moveTo(x, y)
    ctx.lineTo(x + Math.cos(angle) * len, y + Math.sin(angle) * len)
    ctx.stroke()
  }
  ctx.restore()

  // Subtle vignette toward the rail.
  const cx = CANVAS_WIDTH / 2
  const cy = CANVAS_HEIGHT * 0.65
  const gradient = ctx.createRadialGradient(cx, cy, Math.min(cx, cy) * 0.3, cx, cy, Math.max(cx, cy) * 1.2)
  gradient.addColorStop(0, 'rgba(0, 0, 0, 0)')
  gradient.addColorStop(1, 'rgba(0, 0, 0, 0.4)')
  ctx.save()
  ctx.globalCompositeOperation = 'multiply'
  ctx.fillStyle = gradient
  ctx.fillRect(0, 0, CANVAS_WIDTH, CANVAS_HEIGHT)
  ctx.restore()
}

/**
 * Draws `text` letter by letter along an arc of `radius` canvas px centred at `(cx, cy)`, opening
 * toward `+z` (canvas down - the player's side, since the arc's own centre sits up near the dealer
 * edge). Each glyph is rotated so its top points back toward the centre, the usual convention for
 * text printed around a table's rim so it reads upright from outside the circle.
 */
function drawArcText(
  ctx: CanvasRenderingContext2D,
  text: string,
  cx: number,
  cy: number,
  radius: number,
  fontPx: number,
  color: string,
): void {
  ctx.save()
  ctx.font = `700 ${fontPx}px 'Georgia', serif`
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  const widths = Array.from(text, (ch) => ctx.measureText(ch).width)
  const totalWidth = widths.reduce((a, b) => a + b, 0)
  const totalAngle = totalWidth / radius
  let angle = Math.PI / 2 + totalAngle / 2
  for (let i = 0; i < text.length; i++) {
    const charAngle = widths[i]! / radius
    angle -= charAngle / 2
    ctx.save()
    ctx.translate(cx + radius * Math.cos(angle), cy + radius * Math.sin(angle))
    ctx.rotate(angle - Math.PI / 2)
    ctx.fillText(text[i]!, 0, 0)
    ctx.restore()
    angle -= charAngle / 2
  }
  ctx.restore()
}

/** The printed markings: the two payout arcs, the insurance band, and the betting circle ring. */
function drawMarkings(ctx: CanvasRenderingContext2D): void {
  // Both arcs share the felt's own arc centre (up near the dealer edge, possibly off-canvas).
  const center = worldToCanvas(TABLE_CENTER_X, TABLE_MIN_Z)

  drawArcText(ctx, 'BLACKJACK PAYS 3 TO 2', center.px, center.py, FELT_RADIUS * PX_PER_INCH * 0.86, 46, CREAM)
  drawArcText(ctx, 'DEALER MUST STAND ON 17 AND DRAW TO 16', center.px, center.py, FELT_RADIUS * PX_PER_INCH * 0.66, 28, GOLD)

  const insuranceY = worldToCanvas(TABLE_CENTER_X, DEALER_CARD_Z + 4).py
  ctx.save()
  ctx.font = `700 34px 'Georgia', serif`
  ctx.fillStyle = CREAM
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('INSURANCE PAYS 2 TO 1', CANVAS_WIDTH / 2, insuranceY)
  ctx.strokeStyle = GOLD
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.moveTo(CANVAS_WIDTH * 0.26, insuranceY - 28)
  ctx.lineTo(CANVAS_WIDTH * 0.74, insuranceY - 28)
  ctx.stroke()
  ctx.beginPath()
  ctx.moveTo(CANVAS_WIDTH * 0.26, insuranceY + 28)
  ctx.lineTo(CANVAS_WIDTH * 0.74, insuranceY + 28)
  ctx.stroke()
  ctx.restore()

  const circle = worldToCanvas(BET_CIRCLE_X, BET_CIRCLE_Z)
  const radiusPx = BET_CIRCLE_RADIUS * PX_PER_INCH
  ctx.save()
  ctx.strokeStyle = GOLD
  ctx.lineWidth = Math.max(2, radiusPx * 0.06)
  ctx.beginPath()
  ctx.arc(circle.px, circle.py, radiusPx, 0, Math.PI * 2)
  ctx.stroke()
  ctx.restore()
}

function finishTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.flipY = false
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

/** The felt colour map: grain, the two payout arcs, the insurance band and the betting circle. */
export function makeFeltTexture(): THREE.CanvasTexture {
  const { canvas, ctx } = makeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT)
  fillBackground(ctx)
  drawMarkings(ctx)
  return finishTexture(canvas)
}
