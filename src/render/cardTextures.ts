/**
 * Procedural playing-card textures: a face (per rank/suit) and the single shared back, drawn on
 * canvas at 264x410 (the 2.25:3.5 bridge-card ratio). No image files - drawn fresh per call and
 * cached in a module `Map` keyed by card (`disposeCardTextures()` clears the cache). The caller
 * (`cardView.ts`) owns the materials that reference these textures; it must not dispose them
 * itself - only `disposeCardTextures()` does.
 */

import * as THREE from 'three'
import type { Card, Rank, Suit } from '../game/types.ts'

const CANVAS_WIDTH = 264
const CANVAS_HEIGHT = 410
const CORNER_RADIUS = 18

const CORNER_MARGIN = 24
const RANK_FONT_SIZE = 38
const SUIT_CORNER_FONT_SIZE = 28

const SERIF_FONT = `'Bodoni 72', Didot, Georgia, serif`
const IVORY = '#f7f2e6'
const RED = '#b3121b'
const INK = '#141414'
const GOLD = '#d4af37'
const BURGUNDY = '#5e1220'

/** One number/pip position: fraction of half-width, fraction of half-height, and whether it is rotated 180 (lower half). */
type PipSpec = readonly [number, number, boolean]

type NumberRank = Exclude<Rank, 'A' | 'J' | 'Q' | 'K'>

const PIP_LAYOUTS: Readonly<Record<NumberRank, readonly PipSpec[]>> = {
  '2': [
    [0, -0.78, false],
    [0, 0.78, true],
  ],
  '3': [
    [0, -0.78, false],
    [0, 0, false],
    [0, 0.78, true],
  ],
  '4': [
    [-0.34, -0.7, false],
    [0.34, -0.7, false],
    [-0.34, 0.7, true],
    [0.34, 0.7, true],
  ],
  '5': [
    [-0.34, -0.7, false],
    [0.34, -0.7, false],
    [0, 0, false],
    [-0.34, 0.7, true],
    [0.34, 0.7, true],
  ],
  '6': [
    [-0.34, -0.76, false],
    [0.34, -0.76, false],
    [-0.34, 0, false],
    [0.34, 0, false],
    [-0.34, 0.76, true],
    [0.34, 0.76, true],
  ],
  '7': [
    [-0.34, -0.76, false],
    [0.34, -0.76, false],
    [0, -0.4, false],
    [-0.34, 0, false],
    [0.34, 0, false],
    [-0.34, 0.76, true],
    [0.34, 0.76, true],
  ],
  '8': [
    [-0.34, -0.76, false],
    [0.34, -0.76, false],
    [0, -0.4, false],
    [-0.34, 0, false],
    [0.34, 0, false],
    [0, 0.4, true],
    [-0.34, 0.76, true],
    [0.34, 0.76, true],
  ],
  '9': [
    [-0.34, -0.82, false],
    [0.34, -0.82, false],
    [-0.34, -0.28, false],
    [0.34, -0.28, false],
    [0, 0, false],
    [-0.34, 0.28, true],
    [0.34, 0.28, true],
    [-0.34, 0.82, true],
    [0.34, 0.82, true],
  ],
  '10': [
    [-0.34, -0.85, false],
    [0.34, -0.85, false],
    [0, -0.5, true],
    [-0.34, -0.32, false],
    [0.34, -0.32, false],
    [-0.34, 0.32, true],
    [0.34, 0.32, true],
    [0, 0.5, false],
    [-0.34, 0.85, true],
    [0.34, 0.85, true],
  ],
}

const faceCache = new Map<string, THREE.CanvasTexture>()
let backTexture: THREE.CanvasTexture | null = null

/** `cards.ts` is being written alongside this file; fall back to a private key until it lands. */
function keyOf(card: Card): string {
  return `${card.rank}${card.suit}`
}

function suitColor(suit: Suit): string {
  return suit === 'H' || suit === 'D' ? RED : INK
}

function suitGlyph(suit: Suit): string {
  switch (suit) {
    case 'S':
      return '♠'
    case 'H':
      return '♥'
    case 'D':
      return '♦'
    case 'C':
      return '♣'
  }
}

function withAlpha(hex: string, alpha: number): string {
  const value = hex.replace('#', '')
  const r = Number.parseInt(value.slice(0, 2), 16)
  const g = Number.parseInt(value.slice(2, 4), 16)
  const b = Number.parseInt(value.slice(4, 6), 16)
  return `rgba(${r}, ${g}, ${b}, ${alpha})`
}

function makeCanvas(width: number, height: number): { canvas: HTMLCanvasElement; ctx: CanvasRenderingContext2D } {
  const canvas = document.createElement('canvas')
  canvas.width = width
  canvas.height = height
  const ctx = canvas.getContext('2d')
  if (!ctx) throw new Error('2D canvas context unavailable for card texture')
  return { canvas, ctx }
}

function finishTexture(canvas: HTMLCanvasElement): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(canvas)
  texture.colorSpace = THREE.SRGBColorSpace
  texture.anisotropy = 8
  texture.needsUpdate = true
  return texture
}

function roundedRectPath(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath()
  ctx.moveTo(x + r, y)
  ctx.lineTo(x + w - r, y)
  ctx.quadraticCurveTo(x + w, y, x + w, y + r)
  ctx.lineTo(x + w, y + h - r)
  ctx.quadraticCurveTo(x + w, y + h, x + w - r, y + h)
  ctx.lineTo(x + r, y + h)
  ctx.quadraticCurveTo(x, y + h, x, y + h - r)
  ctx.lineTo(x, y + r)
  ctx.quadraticCurveTo(x, y, x + r, y)
  ctx.closePath()
}

/** A diagonal diamond-lattice, clipped to a rectangle, in one colour at low alpha. */
function drawDiamondLattice(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  color: string,
  alpha: number,
): void {
  ctx.save()
  ctx.beginPath()
  ctx.rect(x, y, w, h)
  ctx.clip()
  ctx.strokeStyle = withAlpha(color, alpha)
  ctx.lineWidth = 1
  const step = 16
  for (let ox = x - h; ox < x + w + h; ox += step) {
    ctx.beginPath()
    ctx.moveTo(ox, y)
    ctx.lineTo(ox + h, y + h)
    ctx.stroke()
    ctx.beginPath()
    ctx.moveTo(ox, y + h)
    ctx.lineTo(ox + h, y)
    ctx.stroke()
  }
  ctx.restore()
}

function drawCornerIndex(ctx: CanvasRenderingContext2D, rank: Rank, glyph: string, color: string, flip: boolean): void {
  const x = flip ? CANVAS_WIDTH - CORNER_MARGIN : CORNER_MARGIN
  const y = flip ? CANVAS_HEIGHT - CORNER_MARGIN : CORNER_MARGIN
  ctx.save()
  ctx.translate(x, y)
  if (flip) ctx.rotate(Math.PI)
  ctx.fillStyle = color
  ctx.textAlign = 'center'
  ctx.textBaseline = 'alphabetic'
  ctx.font = `700 ${RANK_FONT_SIZE}px ${SERIF_FONT}`
  ctx.fillText(rank, 0, RANK_FONT_SIZE * 0.42)
  ctx.font = `${SUIT_CORNER_FONT_SIZE}px serif`
  ctx.fillText(glyph, 0, RANK_FONT_SIZE * 0.42 + SUIT_CORNER_FONT_SIZE * 0.95)
  ctx.restore()
}

function drawPips(ctx: CanvasRenderingContext2D, w: number, h: number, rank: NumberRank, color: string, glyph: string): void {
  const layout = PIP_LAYOUTS[rank]
  const cx = w / 2
  const cy = h / 2
  const halfW = w / 2
  const halfH = h / 2
  const dense = rank === '9' || rank === '10'
  const size = Math.round(h * (dense ? 0.09 : 0.115))
  ctx.fillStyle = color
  ctx.font = `${size}px serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  for (const [fx, fy, flip] of layout) {
    ctx.save()
    ctx.translate(cx + fx * halfW, cy + fy * halfH)
    if (flip) ctx.rotate(Math.PI)
    ctx.fillText(glyph, 0, 0)
    ctx.restore()
  }
}

/** A single large pip, centred: the ordinary treatment for every ace but the spade. */
function drawSimpleAce(ctx: CanvasRenderingContext2D, w: number, h: number, color: string, glyph: string): void {
  ctx.fillStyle = color
  ctx.font = `${Math.round(h * 0.34)}px serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText(glyph, w / 2, h / 2)
}

/** The printer's mark: an oversized spade inside a thin gold ring. */
function drawSpadeAce(ctx: CanvasRenderingContext2D, w: number, h: number, color: string): void {
  const cx = w / 2
  const cy = h / 2
  const ringRadius = h * 0.2
  ctx.strokeStyle = GOLD
  ctx.lineWidth = 3
  ctx.beginPath()
  ctx.arc(cx, cy, ringRadius, 0, Math.PI * 2)
  ctx.stroke()
  ctx.strokeStyle = withAlpha(GOLD, 0.5)
  ctx.lineWidth = 1
  ctx.beginPath()
  ctx.arc(cx, cy, ringRadius * 0.82, 0, Math.PI * 2)
  ctx.stroke()
  ctx.fillStyle = color
  ctx.font = `${Math.round(h * 0.42)}px serif`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('♠', cx, cy)
}

/** A gold-framed panel: a diamond lattice behind a large monogram, mirrored top/bottom. */
function drawCourt(ctx: CanvasRenderingContext2D, w: number, h: number, rank: Rank, color: string): void {
  const marginX = 30
  const marginY = 58
  const panelX = marginX
  const panelY = marginY
  const panelW = w - marginX * 2
  const panelH = h - marginY * 2

  drawDiamondLattice(ctx, panelX, panelY, panelW, panelH, color, 0.14)

  ctx.strokeStyle = GOLD
  ctx.lineWidth = 4
  ctx.strokeRect(panelX, panelY, panelW, panelH)
  ctx.lineWidth = 1
  ctx.strokeStyle = withAlpha(GOLD, 0.7)
  ctx.strokeRect(panelX + 6, panelY + 6, panelW - 12, panelH - 12)

  const cx = w / 2
  const cy = h / 2
  const fontSize = Math.round(h * 0.15)
  for (const flip of [false, true]) {
    ctx.save()
    ctx.translate(cx, cy)
    if (flip) ctx.rotate(Math.PI)
    ctx.translate(-cx, -cy)
    ctx.fillStyle = color
    ctx.font = `700 ${fontSize}px ${SERIF_FONT}`
    ctx.textAlign = 'center'
    ctx.textBaseline = 'middle'
    ctx.fillText(rank, cx, cy - h * 0.16)
    ctx.restore()
  }
}

function drawFace(ctx: CanvasRenderingContext2D, card: Card): void {
  const w = CANVAS_WIDTH
  const h = CANVAS_HEIGHT
  ctx.clearRect(0, 0, w, h)

  roundedRectPath(ctx, 1, 1, w - 2, h - 2, CORNER_RADIUS)
  ctx.save()
  ctx.clip()

  ctx.fillStyle = IVORY
  ctx.fillRect(0, 0, w, h)

  const vignette = ctx.createRadialGradient(w / 2, h / 2, h * 0.2, w / 2, h / 2, h * 0.72)
  vignette.addColorStop(0, 'rgba(20, 10, 5, 0)')
  vignette.addColorStop(1, 'rgba(20, 10, 5, 0.16)')
  ctx.fillStyle = vignette
  ctx.fillRect(0, 0, w, h)

  const color = suitColor(card.suit)
  const glyph = suitGlyph(card.suit)

  drawCornerIndex(ctx, card.rank, glyph, color, false)
  drawCornerIndex(ctx, card.rank, glyph, color, true)

  if (card.rank === 'A') {
    if (card.suit === 'S') drawSpadeAce(ctx, w, h, color)
    else drawSimpleAce(ctx, w, h, color, glyph)
  } else if (card.rank === 'J' || card.rank === 'Q' || card.rank === 'K') {
    drawCourt(ctx, w, h, card.rank, color)
  } else {
    drawPips(ctx, w, h, card.rank, color, glyph)
  }

  // Border, drawn while still clipped so it reads cleanly against the rounded corner.
  roundedRectPath(ctx, 3, 3, w - 6, h - 6, CORNER_RADIUS - 2)
  ctx.lineWidth = 3
  ctx.strokeStyle = 'rgba(20, 10, 5, 0.4)'
  ctx.stroke()

  ctx.restore()
}

function drawBack(ctx: CanvasRenderingContext2D): void {
  const w = CANVAS_WIDTH
  const h = CANVAS_HEIGHT
  ctx.clearRect(0, 0, w, h)

  roundedRectPath(ctx, 1, 1, w - 2, h - 2, CORNER_RADIUS)
  ctx.save()
  ctx.clip()

  ctx.fillStyle = BURGUNDY
  ctx.fillRect(0, 0, w, h)
  drawDiamondLattice(ctx, 12, 12, w - 24, h - 24, GOLD, 0.55)

  roundedRectPath(ctx, 9, 9, w - 18, h - 18, CORNER_RADIUS - 5)
  ctx.lineWidth = 4
  ctx.strokeStyle = GOLD
  ctx.stroke()

  const cx = w / 2
  const cy = h / 2
  const crestRadius = h * 0.13
  ctx.beginPath()
  ctx.arc(cx, cy, crestRadius, 0, Math.PI * 2)
  ctx.fillStyle = BURGUNDY
  ctx.fill()
  ctx.lineWidth = 3
  ctx.strokeStyle = GOLD
  ctx.stroke()
  ctx.fillStyle = GOLD
  ctx.font = `700 ${Math.round(crestRadius * 0.9)}px ${SERIF_FONT}`
  ctx.textAlign = 'center'
  ctx.textBaseline = 'middle'
  ctx.fillText('BR', cx, cy + 1)

  ctx.restore()
}

/** The face texture for one card, cached by rank+suit. */
export function makeCardFaceTexture(card: Card): THREE.CanvasTexture {
  const key = keyOf(card)
  const cached = faceCache.get(key)
  if (cached) return cached
  const { canvas, ctx } = makeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT)
  drawFace(ctx, card)
  const texture = finishTexture(canvas)
  faceCache.set(key, texture)
  return texture
}

/** The single shared back texture, built once and cached. */
export function makeCardBackTexture(): THREE.CanvasTexture {
  if (backTexture) return backTexture
  const { canvas, ctx } = makeCanvas(CANVAS_WIDTH, CANVAS_HEIGHT)
  drawBack(ctx)
  backTexture = finishTexture(canvas)
  return backTexture
}

/** Disposes every cached texture. Call once, e.g. from `cardView.ts`'s `dispose()`. */
export function disposeCardTextures(): void {
  for (const texture of faceCache.values()) texture.dispose()
  faceCache.clear()
  if (backTexture) {
    backTexture.dispose()
    backTexture = null
  }
}
