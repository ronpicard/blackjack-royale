/**
 * Every card on the table: one `THREE.Mesh` each, a `BoxGeometry(CARD_WIDTH, CARD_THICKNESS,
 * CARD_HEIGHT)` with a six-material array (edges ivory, top the face texture, bottom the back
 * texture - see `cardTextures.ts`). Face down is the mesh rotated pi about its local z axis, which
 * swaps the top (+y, face) and bottom (-y, back) faces without touching x/z, so `flip` just adds
 * pi to that same angle.
 *
 * Every animation is driven only by `update(dt, time)`: state is a start/duration/elapsed record
 * per card, advanced by `dt` each call, never by `requestAnimationFrame` or `Date`. `dt = 0`
 * freezes every animation in place.
 */

import * as THREE from 'three'
import type { Card } from '../game/types.ts'
import { CARD_HEIGHT, CARD_THICKNESS, CARD_WIDTH, DISCARD_X, DISCARD_Z, SHOE_X, SHOE_Z, TABLE_HEIGHT } from './layout.ts'
import type { Point3 } from './layout.ts'
import { disposeCardTextures, makeCardBackTexture, makeCardFaceTexture } from './cardTextures.ts'

export interface CardView {
  /** Add to the scene. */
  group: THREE.Group
  /** Spawns (or respawns) card `id` at the shoe mouth and arcs it to `to` over `seconds`. */
  dealTo(id: string, card: Card, to: Point3, faceDown: boolean, rotationY: number, seconds: number): void
  /** Turns card `id` over in place (toggles face up/down), lifting briefly. */
  flip(id: string, seconds: number): void
  /** Slides card `id` to a new position, e.g. a hand re-spread by a split. */
  moveTo(id: string, to: Point3, seconds: number): void
  /** Slides every card on the table to the discard tray, stacking them, then removes them. */
  discardAll(seconds: number): void
  /** Darkens (or restores) one card, for a hand that lost. */
  setDimmed(id: string, dimmed: boolean): void
  /** Removes every card immediately, with no animation. */
  clear(): void
  /** Advances every animation by `dt` seconds. `dt = 0` freezes them. */
  update(dt: number, time: number): void
  dispose(): void
}

// -------------------------------------------------------------------------------------------
// Tuning
// -------------------------------------------------------------------------------------------

const SHOE_MOUTH_X_OFFSET = 2
const SHOE_MOUTH_Y = TABLE_HEIGHT + 3
const DEAL_LIFT = 4
const FLIP_LIFT = 2
const DIM_SHADE = 0.45
const MIN_DURATION = 1 / 60
const EDGE_COLOR = 0xf7f2e6

// -------------------------------------------------------------------------------------------
// Easing
// -------------------------------------------------------------------------------------------

export function easeOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return 1 - (1 - c) ** 3
}

export function easeInOutCubic(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return c < 0.5 ? 4 * c ** 3 : 1 - (-2 * c + 2) ** 3 / 2
}

/** A small overshoot past 1 that settles back to exactly 1 at t = 1: used only for the deal yaw. */
function overshoot(t: number): number {
  const c = Math.min(1, Math.max(0, t))
  return easeOutCubic(c) + Math.sin(c * Math.PI) * 0.12 * (1 - c)
}

function lerp(a: number, b: number, t: number): number {
  return a + (b - a) * t
}

// -------------------------------------------------------------------------------------------
// Per-card state
// -------------------------------------------------------------------------------------------

interface CardEntry {
  mesh: THREE.Mesh
  faceMaterial: THREE.MeshStandardMaterial
  backMaterial: THREE.MeshStandardMaterial
  edgeMaterial: THREE.MeshStandardMaterial
  faceDown: boolean
  dimmed: boolean
}

interface MotionAnim {
  fromX: number
  fromY: number
  fromZ: number
  toX: number
  toY: number
  toZ: number
  fromYaw: number
  toYaw: number
  /** Extra height added at the arc's midpoint; 0 for a flat slide. */
  lift: number
  duration: number
  elapsed: number
  onDone?: () => void
}

interface FlipAnim {
  fromRotZ: number
  toRotZ: number
  baseY: number
  lift: number
  duration: number
  elapsed: number
  faceDownAfter: boolean
}

export function createCardView(): CardView {
  const group = new THREE.Group()
  const geometry = new THREE.BoxGeometry(CARD_WIDTH, CARD_THICKNESS, CARD_HEIGHT)

  const cards = new Map<string, CardEntry>()
  const motions = new Map<string, MotionAnim>()
  const flips = new Map<string, FlipAnim>()
  const discarding = new Set<string>()

  function createEntry(card: Card, faceDown: boolean): CardEntry {
    const edgeMaterial = new THREE.MeshStandardMaterial({ color: EDGE_COLOR, roughness: 0.55 })
    const faceMaterial = new THREE.MeshStandardMaterial({
      map: makeCardFaceTexture(card),
      roughness: 0.55,
      transparent: true,
      alphaTest: 0.5,
    })
    const backMaterial = new THREE.MeshStandardMaterial({
      map: makeCardBackTexture(),
      roughness: 0.55,
      transparent: true,
      alphaTest: 0.5,
    })
    const mesh = new THREE.Mesh(geometry, [edgeMaterial, edgeMaterial, faceMaterial, backMaterial, edgeMaterial, edgeMaterial])
    mesh.castShadow = true
    mesh.receiveShadow = true
    mesh.rotation.z = faceDown ? Math.PI : 0
    return { mesh, faceMaterial, backMaterial, edgeMaterial, faceDown, dimmed: false }
  }

  function removeCard(id: string): void {
    const entry = cards.get(id)
    if (!entry) return
    group.remove(entry.mesh)
    entry.faceMaterial.dispose()
    entry.backMaterial.dispose()
    entry.edgeMaterial.dispose()
    cards.delete(id)
    motions.delete(id)
    flips.delete(id)
    discarding.delete(id)
  }

  function dealTo(id: string, card: Card, to: Point3, faceDown: boolean, rotationY: number, seconds: number): void {
    removeCard(id)
    const entry = createEntry(card, faceDown)
    const fromX = SHOE_X - SHOE_MOUTH_X_OFFSET
    const fromY = SHOE_MOUTH_Y
    const fromZ = SHOE_Z
    entry.mesh.position.set(fromX, fromY, fromZ)
    entry.mesh.rotation.y = 0
    group.add(entry.mesh)
    cards.set(id, entry)
    motions.set(id, {
      fromX,
      fromY,
      fromZ,
      toX: to.x,
      toY: to.y,
      toZ: to.z,
      fromYaw: 0,
      toYaw: rotationY,
      lift: DEAL_LIFT,
      duration: Math.max(seconds, MIN_DURATION),
      elapsed: 0,
    })
  }

  function flip(id: string, seconds: number): void {
    const entry = cards.get(id)
    if (!entry) return
    const fromRotZ = entry.mesh.rotation.z
    flips.set(id, {
      fromRotZ,
      toRotZ: fromRotZ + Math.PI,
      baseY: entry.mesh.position.y,
      lift: FLIP_LIFT,
      duration: Math.max(seconds, MIN_DURATION),
      elapsed: 0,
      faceDownAfter: !entry.faceDown,
    })
  }

  function moveTo(id: string, to: Point3, seconds: number): void {
    const entry = cards.get(id)
    if (!entry) return
    const yaw = entry.mesh.rotation.y
    motions.set(id, {
      fromX: entry.mesh.position.x,
      fromY: entry.mesh.position.y,
      fromZ: entry.mesh.position.z,
      toX: to.x,
      toY: to.y,
      toZ: to.z,
      fromYaw: yaw,
      toYaw: yaw,
      lift: 0,
      duration: Math.max(seconds, MIN_DURATION),
      elapsed: 0,
    })
  }

  function discardAll(seconds: number): void {
    let index = 0
    for (const [id, entry] of cards) {
      if (discarding.has(id)) continue
      discarding.add(id)
      const toX = DISCARD_X
      const toY = TABLE_HEIGHT + 0.5 + index * CARD_THICKNESS
      const toZ = DISCARD_Z
      index++
      const yaw = entry.mesh.rotation.y
      motions.set(id, {
        fromX: entry.mesh.position.x,
        fromY: entry.mesh.position.y,
        fromZ: entry.mesh.position.z,
        toX,
        toY,
        toZ,
        fromYaw: yaw,
        toYaw: yaw,
        lift: 0,
        duration: Math.max(seconds, MIN_DURATION),
        elapsed: 0,
        onDone: () => removeCard(id),
      })
    }
  }

  function setDimmed(id: string, dimmed: boolean): void {
    const entry = cards.get(id)
    if (!entry) return
    entry.dimmed = dimmed
    const shade = dimmed ? DIM_SHADE : 1
    entry.faceMaterial.color.setScalar(shade)
    entry.backMaterial.color.setScalar(shade)
    entry.edgeMaterial.color.setHex(EDGE_COLOR).multiplyScalar(shade)
  }

  function clear(): void {
    for (const id of Array.from(cards.keys())) removeCard(id)
  }

  function update(dt: number, _time: number): void {
    if (dt <= 0) return

    for (const [id, anim] of motions) {
      const entry = cards.get(id)
      if (!entry) {
        motions.delete(id)
        continue
      }
      anim.elapsed += dt
      const t = Math.min(1, anim.elapsed / anim.duration)
      const eased = easeOutCubic(t)
      entry.mesh.position.x = lerp(anim.fromX, anim.toX, eased)
      entry.mesh.position.z = lerp(anim.fromZ, anim.toZ, eased)
      const straightY = lerp(anim.fromY, anim.toY, eased)
      const arc = anim.lift * 4 * t * (1 - t)
      entry.mesh.position.y = straightY + arc
      entry.mesh.rotation.y = lerp(anim.fromYaw, anim.toYaw, overshoot(t))
      if (t >= 1) {
        entry.mesh.position.set(anim.toX, anim.toY, anim.toZ)
        entry.mesh.rotation.y = anim.toYaw
        motions.delete(id)
        anim.onDone?.()
      }
    }

    for (const [id, anim] of flips) {
      const entry = cards.get(id)
      if (!entry) {
        flips.delete(id)
        continue
      }
      anim.elapsed += dt
      const t = Math.min(1, anim.elapsed / anim.duration)
      entry.mesh.rotation.z = lerp(anim.fromRotZ, anim.toRotZ, easeInOutCubic(t))
      entry.mesh.position.y = anim.baseY + anim.lift * Math.sin(Math.PI * t)
      if (t >= 1) {
        entry.mesh.rotation.z = anim.toRotZ
        entry.mesh.position.y = anim.baseY
        entry.faceDown = anim.faceDownAfter
        flips.delete(id)
      }
    }
  }

  function dispose(): void {
    clear()
    geometry.dispose()
    disposeCardTextures()
  }

  return { group, dealTo, flip, moveTo, discardAll, setDimmed, clear, update, dispose }
}
