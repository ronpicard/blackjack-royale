/**
 * The table itself: felt, the padded rail, the mahogany apron and pedestal, the shoe, the discard
 * tray, the dealer's chip tray and the player's chip stacks. World space, already positioned -
 * every mesh is built directly at its absolute world coordinates (see `layout.ts`), so `group`
 * carries no transform of its own.
 */

import * as THREE from 'three'
import type { ChipValue } from '../game/types.ts'
import {
  BET_CIRCLE_RADIUS,
  BET_CIRCLE_X,
  BET_CIRCLE_Z,
  CARD_THICKNESS,
  CHIP_TRAY_X,
  CHIP_TRAY_Z,
  DEALER_CARD_Z,
  DISCARD_X,
  DISCARD_Z,
  SHOE_X,
  SHOE_Z,
  TABLE_CENTER_X,
  TABLE_HEIGHT,
  TABLE_MIN_Z,
  TABLE_RADIUS,
  handCenterX,
} from './layout.ts'
import { makeBrushedMetalBump, makeBrushedMetalRoughness, makePebbleBump, makeWoodBump, makeWoodGrain } from './materialTextures.ts'
import { makeChipTextures } from './chipTextures.ts'
import { FELT_FLAT_Z, FELT_MAX_X, FELT_MAX_Z, FELT_MIN_X, FELT_MIN_Z, FELT_RADIUS, makeFeltTexture } from './feltTexture.ts'

export interface TableView {
  /** World space, already positioned. */
  group: THREE.Group
  /** Pulses the betting circle's gold ring on/off. */
  setBetCircleHighlight(on: boolean): void
  /** Rebuilds hand `handIndex`'s chip stack (of `handCount` hands on the table) and the insurance stack. */
  setChips(handIndex: number, handCount: number, amount: number, insurance: number): void
  /** Rebuilds the insurance stack on its own (equivalent to the trailing argument of `setChips`). */
  setInsuranceChips(amount: number): void
  /** Cards in the discard tray; its stack rises `CARD_THICKNESS` per card. */
  setDiscardCount(n: number): void
  /** How full the shoe looks, `0` (empty) to `1` (a fresh six-deck shoe). */
  setShoeFill(fraction: number): void
  update(time: number): void
  dispose(): void
}

// -------------------------------------------------------------------------------------------
// Dimensions, inches
// -------------------------------------------------------------------------------------------

const RAIL_HEIGHT = 2.5
const WOOD_STRIP_HEIGHT = 0.35
const BRASS_LINE_HEIGHT = 0.06
const APRON_DEPTH = 5
const APRON_FELT_GAP = 0.08
const APRON_BOTTOM_Y = TABLE_HEIGHT - APRON_DEPTH
const PEDESTAL_INSET = 6
const KICK_HEIGHT = 3.5

const CHIP_DIAMETER = 1.55
const CHIP_RADIUS = CHIP_DIAMETER / 2
const CHIP_THICKNESS = 0.13
const CHIPS_PER_COLUMN = 20
const COLUMN_OFFSET = 0.35
const CHIP_INSTANCE_INITIAL_CAPACITY = 32

/** Largest denomination first, so a greedy breakdown puts the biggest chips at the bottom. */
const CHIP_DENOMINATIONS: readonly ChipValue[] = [500, 100, 25, 5, 1]

const SHOE_WIDTH = 4.7
const SHOE_DEPTH = 4.4
const SHOE_WALL_HEIGHT = 5
const SHOE_FRONT_WALL_HEIGHT = 2.1
const SHOE_WALL_THICKNESS = 0.3
/** Six decks (312 cards), each `CARD_THICKNESS` thick, stacked flat inside the shoe. */
const SHOE_STACK_MAX_HEIGHT = 312 * CARD_THICKNESS

const DISCARD_WIDTH = 4.9
const DISCARD_DEPTH = 4.6
const DISCARD_WALL_HEIGHT = 2.4
const DISCARD_WALL_THICKNESS = 0.2

const CHIP_TRAY_ROW_SPACING = 3.4
const CHIP_TRAY_ROW_COUNT = 10

// -------------------------------------------------------------------------------------------
// Small deterministic helpers
// -------------------------------------------------------------------------------------------

function hash32(text: string): number {
  let h = 2166136261
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function jitterFor(key: string, index: number): { dx: number; dz: number; rot: number } {
  const seed = hash32(`${key}#${index}`)
  // A tiny deterministic spread from a hashed seed - no PRNG state to carry between calls.
  const a = ((seed & 0xff) / 255 - 0.5) * 0.12
  const b = (((seed >> 8) & 0xff) / 255 - 0.5) * 0.12
  const rot = (((seed >> 16) & 0xff) / 255) * Math.PI * 2
  return { dx: a, dz: b, rot }
}

interface Disposable {
  dispose(): void
}

function disposeAll(items: readonly Disposable[]): void {
  for (const item of items) item.dispose()
}

/** Largest denominations first, e.g. `250` -> `[100, 100, 25, 25]`. */
function chipBreakdown(amount: number): ChipValue[] {
  let remaining = Math.max(0, Math.floor(amount))
  const out: ChipValue[] = []
  for (const value of CHIP_DENOMINATIONS) {
    while (remaining >= value) {
      out.push(value)
      remaining -= value
    }
  }
  return out
}

// -------------------------------------------------------------------------------------------
// Table outline: a half-moon - a straight dealer edge and a semicircular player edge sharing one
// arc centre (see `layout.ts`'s module doc). Every inset (the felt inside the rail, the apron and
// pedestal below it) shrinks the radius and moves the flat edge by the same margin, so the rail
// reads as a uniform width all the way round.
// -------------------------------------------------------------------------------------------

/** Outline points in world `(x, z)`, wound so the flat edge is the implicit closing segment. */
function halfMoonOutline(radius: number, flatZ: number, segments = 48): { x: number; z: number }[] {
  const centerZ = TABLE_MIN_Z
  const ratio = Math.min(1, Math.max(-1, (flatZ - centerZ) / radius))
  const t0 = Math.asin(ratio)
  const points: { x: number; z: number }[] = []
  for (let i = 0; i <= segments; i++) {
    const t = t0 + (i / segments) * (Math.PI - 2 * t0)
    points.push({ x: TABLE_CENTER_X + radius * Math.cos(t), z: centerZ + radius * Math.sin(t) })
  }
  return points
}

function toVec2Points(points: readonly { x: number; z: number }[]): THREE.Vector2[] {
  return points.map((p) => new THREE.Vector2(p.x, -p.z))
}

/** A flat, UV-mapped `ShapeGeometry` for the felt's own half-moon, lying at `y = 0`. */
function buildFeltGeometry(): THREE.BufferGeometry {
  const shape = new THREE.Shape(toVec2Points(halfMoonOutline(FELT_RADIUS, FELT_FLAT_Z)))
  const geometry = new THREE.ShapeGeometry(shape, 32)
  geometry.rotateX(-Math.PI / 2)
  const position = geometry.getAttribute('position')
  const uv = new Float32Array(position.count * 2)
  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i)
    const z = position.getZ(i)
    uv[i * 2] = (x - FELT_MIN_X) / (FELT_MAX_X - FELT_MIN_X)
    uv[i * 2 + 1] = (z - FELT_MIN_Z) / (FELT_MAX_Z - FELT_MIN_Z)
  }
  geometry.setAttribute('uv', new THREE.BufferAttribute(uv, 2))
  return geometry
}

/** A ring between an outer and an inner half-moon outline, extruded to `height`. */
function buildRingGeometry(outerRadius: number, outerFlatZ: number, innerRadius: number, innerFlatZ: number, height: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(toVec2Points(halfMoonOutline(outerRadius, outerFlatZ)))
  shape.holes.push(new THREE.Path(toVec2Points(halfMoonOutline(innerRadius, innerFlatZ))))
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: height, bevelEnabled: false, curveSegments: 32 })
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

/** A solid half-moon slab, extruded downward by `depth` from its outline. */
function buildSolidGeometry(radius: number, flatZ: number, depth: number): THREE.BufferGeometry {
  const shape = new THREE.Shape(toVec2Points(halfMoonOutline(radius, flatZ)))
  const geometry = new THREE.ExtrudeGeometry(shape, { depth: -depth, bevelEnabled: false, curveSegments: 32 })
  geometry.rotateX(-Math.PI / 2)
  return geometry
}

// -------------------------------------------------------------------------------------------
// Felt, rail, apron, pedestal and foot rail
// -------------------------------------------------------------------------------------------

function buildFelt(): { mesh: THREE.Mesh } & Disposable {
  const geometry = buildFeltGeometry()
  geometry.translate(0, TABLE_HEIGHT, 0)
  const texture = makeFeltTexture()
  const bump = makePebbleBump()
  const material = new THREE.MeshPhysicalMaterial({
    map: texture,
    bumpMap: bump,
    bumpScale: 0.006,
    roughness: 0.92,
    clearcoat: 0,
    sheen: 0.4,
    sheenColor: new THREE.Color('#123a24'),
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.receiveShadow = true
  return {
    mesh,
    dispose() {
      geometry.dispose()
      material.dispose()
      texture.dispose()
      bump.dispose()
    },
  }
}

/** Padded black leather rail with a wood strip and a brass trim line, following the table outline. */
function buildRail(): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  const leatherGeometry = buildRingGeometry(TABLE_RADIUS, TABLE_MIN_Z, FELT_RADIUS, FELT_FLAT_Z, RAIL_HEIGHT)
  const leatherBump = makePebbleBump()
  const leatherMaterial = new THREE.MeshStandardMaterial({
    color: 0x141414,
    roughness: 0.6,
    bumpMap: leatherBump,
    bumpScale: 0.05,
  })
  const leather = new THREE.Mesh(leatherGeometry, leatherMaterial)
  leather.position.y = TABLE_HEIGHT
  leather.castShadow = true
  leather.receiveShadow = true
  disposables.push(leatherGeometry, leatherMaterial, leatherBump)
  group.add(leather)

  const stripGeometry = buildRingGeometry(TABLE_RADIUS, TABLE_MIN_Z, FELT_RADIUS, FELT_FLAT_Z, WOOD_STRIP_HEIGHT)
  const woodColor = makeWoodGrain('#241209', '#3a2110')
  const woodBump = makeWoodBump()
  const woodMaterial = new THREE.MeshPhysicalMaterial({
    map: woodColor,
    bumpMap: woodBump,
    bumpScale: 0.02,
    roughness: 0.4,
    clearcoat: 0.6,
    clearcoatRoughness: 0.25,
  })
  const strip = new THREE.Mesh(stripGeometry, woodMaterial)
  strip.position.y = TABLE_HEIGHT - WOOD_STRIP_HEIGHT
  strip.castShadow = true
  strip.receiveShadow = true
  disposables.push(stripGeometry, woodMaterial, woodColor, woodBump)
  group.add(strip)

  const brassGeometry = buildRingGeometry(TABLE_RADIUS, TABLE_MIN_Z, FELT_RADIUS, FELT_FLAT_Z, BRASS_LINE_HEIGHT)
  const brassMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 1, roughness: 0.3 })
  const brass = new THREE.Mesh(brassGeometry, brassMaterial)
  brass.position.y = TABLE_HEIGHT - WOOD_STRIP_HEIGHT - BRASS_LINE_HEIGHT
  brass.castShadow = true
  disposables.push(brassGeometry, brassMaterial)
  group.add(brass)

  return { group, dispose: () => disposeAll(disposables) }
}

/** The mahogany apron below the rail, a dark pedestal/cabinet base, and a brass foot rail. */
function buildApronAndBase(): { group: THREE.Group } & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  const apronGeometry = buildSolidGeometry(TABLE_RADIUS - 1, TABLE_MIN_Z + 1, APRON_DEPTH)
  apronGeometry.translate(0, TABLE_HEIGHT - APRON_FELT_GAP, 0)
  const woodColor = makeWoodGrain('#241209', '#5a3018')
  const woodBump = makeWoodBump()
  const apronMaterial = new THREE.MeshPhysicalMaterial({
    map: woodColor,
    bumpMap: woodBump,
    bumpScale: 0.02,
    roughness: 0.35,
    clearcoat: 0.7,
    clearcoatRoughness: 0.2,
    side: THREE.DoubleSide,
  })
  const apron = new THREE.Mesh(apronGeometry, apronMaterial)
  apron.castShadow = true
  apron.receiveShadow = true
  disposables.push(apronGeometry, apronMaterial, woodColor, woodBump)
  group.add(apron)

  const pedestalRadius = TABLE_RADIUS - PEDESTAL_INSET
  const pedestalFlatZ = TABLE_MIN_Z + PEDESTAL_INSET
  const pedestalHeight = Math.max(0.1, APRON_BOTTOM_Y - KICK_HEIGHT)
  const pedestalGeometry = buildSolidGeometry(pedestalRadius, pedestalFlatZ, pedestalHeight)
  pedestalGeometry.translate(0, APRON_BOTTOM_Y, 0)
  const cabinetMaterial = new THREE.MeshStandardMaterial({ color: 0x140b08, roughness: 0.6, side: THREE.DoubleSide })
  const pedestal = new THREE.Mesh(pedestalGeometry, cabinetMaterial)
  pedestal.castShadow = true
  pedestal.receiveShadow = true
  disposables.push(pedestalGeometry, cabinetMaterial)
  group.add(pedestal)

  const kickBump = makeBrushedMetalBump()
  const kickRoughness = makeBrushedMetalRoughness()
  const kickMaterial = new THREE.MeshStandardMaterial({
    color: 0x2b2f36,
    metalness: 0.8,
    roughness: 0.6,
    roughnessMap: kickRoughness,
    bumpMap: kickBump,
    bumpScale: 0.01,
    side: THREE.DoubleSide,
  })
  const kickGeometry = buildSolidGeometry(pedestalRadius, pedestalFlatZ, KICK_HEIGHT)
  kickGeometry.translate(0, KICK_HEIGHT, 0)
  const kick = new THREE.Mesh(kickGeometry, kickMaterial)
  kick.receiveShadow = true
  disposables.push(kickGeometry, kickMaterial, kickBump, kickRoughness)
  group.add(kick)

  // Brass foot rail: an open tube tracing the pedestal's front arc, for the player's feet.
  const footOutline = halfMoonOutline(pedestalRadius + 2, pedestalFlatZ - 2, 40)
  const footPoints = footOutline.map((p) => new THREE.Vector3(p.x, KICK_HEIGHT, p.z))
  const footCurve = new THREE.CatmullRomCurve3(footPoints, false)
  const footGeometry = new THREE.TubeGeometry(footCurve, 64, 0.4, 12, false)
  const footMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 1, roughness: 0.3 })
  const foot = new THREE.Mesh(footGeometry, footMaterial)
  foot.castShadow = true
  disposables.push(footGeometry, footMaterial)
  group.add(foot)

  return { group, dispose: () => disposeAll(disposables) }
}

// -------------------------------------------------------------------------------------------
// Betting circle highlight
// -------------------------------------------------------------------------------------------

function buildBetCircleRing(): { mesh: THREE.Mesh; material: THREE.MeshStandardMaterial } & Disposable {
  const geometry = new THREE.RingGeometry(BET_CIRCLE_RADIUS - 0.15, BET_CIRCLE_RADIUS + 0.15, 48)
  geometry.rotateX(-Math.PI / 2)
  const material = new THREE.MeshStandardMaterial({
    color: 0xd4af37,
    emissive: 0xd4af37,
    emissiveIntensity: 0.12,
    roughness: 0.4,
    side: THREE.DoubleSide,
  })
  const mesh = new THREE.Mesh(geometry, material)
  mesh.position.set(BET_CIRCLE_X, TABLE_HEIGHT + 0.03, BET_CIRCLE_Z)
  return {
    mesh,
    material,
    dispose() {
      geometry.dispose()
      material.dispose()
    },
  }
}

// -------------------------------------------------------------------------------------------
// Shoe and discard tray
// -------------------------------------------------------------------------------------------

interface Shoe {
  group: THREE.Group
  setFill(fraction: number): void
}

/** A black acrylic wedge with a card-back stack that rises to `setFill`, and a brass roller lip. */
function buildShoe(): Shoe & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  const shellMaterial = new THREE.MeshPhysicalMaterial({ color: 0x0a0a0a, roughness: 0.15, clearcoat: 0.9, clearcoatRoughness: 0.1 })
  disposables.push(shellMaterial)

  const baseGeometry = new THREE.BoxGeometry(SHOE_WIDTH, 0.3, SHOE_DEPTH)
  const base = new THREE.Mesh(baseGeometry, shellMaterial)
  base.position.set(SHOE_X, TABLE_HEIGHT + 0.15, SHOE_Z)
  base.castShadow = true
  base.receiveShadow = true
  disposables.push(baseGeometry)
  group.add(base)

  const backGeometry = new THREE.BoxGeometry(SHOE_WIDTH, SHOE_WALL_HEIGHT, SHOE_WALL_THICKNESS)
  const back = new THREE.Mesh(backGeometry, shellMaterial)
  back.position.set(SHOE_X, TABLE_HEIGHT + SHOE_WALL_HEIGHT / 2, SHOE_Z + SHOE_DEPTH / 2)
  back.castShadow = true
  disposables.push(backGeometry)
  group.add(back)

  const sideGeometry = new THREE.BoxGeometry(SHOE_WALL_THICKNESS, SHOE_WALL_HEIGHT, SHOE_DEPTH)
  const sideLeft = new THREE.Mesh(sideGeometry, shellMaterial)
  sideLeft.position.set(SHOE_X - SHOE_WIDTH / 2, TABLE_HEIGHT + SHOE_WALL_HEIGHT / 2, SHOE_Z)
  sideLeft.castShadow = true
  const sideRight = new THREE.Mesh(sideGeometry, shellMaterial)
  sideRight.position.set(SHOE_X + SHOE_WIDTH / 2, TABLE_HEIGHT + SHOE_WALL_HEIGHT / 2, SHOE_Z)
  sideRight.castShadow = true
  disposables.push(sideGeometry)
  group.add(sideLeft, sideRight)

  const frontGeometry = new THREE.BoxGeometry(SHOE_WIDTH, SHOE_FRONT_WALL_HEIGHT, SHOE_WALL_THICKNESS)
  const front = new THREE.Mesh(frontGeometry, shellMaterial)
  front.position.set(SHOE_X, TABLE_HEIGHT + SHOE_FRONT_WALL_HEIGHT / 2, SHOE_Z - SHOE_DEPTH / 2)
  front.rotation.x = -0.35
  front.castShadow = true
  disposables.push(frontGeometry)
  group.add(front)

  const rollerGeometry = new THREE.CylinderGeometry(0.28, 0.28, SHOE_WIDTH - 0.4, 16)
  const rollerMaterial = new THREE.MeshStandardMaterial({ color: 0xc9a54a, metalness: 1, roughness: 0.25 })
  const roller = new THREE.Mesh(rollerGeometry, rollerMaterial)
  roller.rotation.z = Math.PI / 2
  roller.position.set(SHOE_X, TABLE_HEIGHT + SHOE_FRONT_WALL_HEIGHT + 0.1, SHOE_Z - SHOE_DEPTH / 2 + 0.25)
  roller.castShadow = true
  disposables.push(rollerGeometry, rollerMaterial)
  group.add(roller)

  const stackFloorY = TABLE_HEIGHT + 0.3
  const stackGeometry = new THREE.BoxGeometry(SHOE_WIDTH - 0.6, 1, SHOE_DEPTH - 0.6)
  const stackMaterial = new THREE.MeshStandardMaterial({ color: 0x5e1220, roughness: 0.5 })
  const stack = new THREE.Mesh(stackGeometry, stackMaterial)
  stack.position.set(SHOE_X, stackFloorY, SHOE_Z)
  stack.scale.y = 0.001
  stack.castShadow = true
  stack.receiveShadow = true
  disposables.push(stackGeometry, stackMaterial)
  group.add(stack)

  function setFill(fraction: number): void {
    const clamped = Math.max(0, Math.min(1, fraction))
    const height = Math.max(0.001, SHOE_STACK_MAX_HEIGHT * clamped)
    stack.scale.y = height
    stack.position.y = stackFloorY + height / 2
  }

  return { group, setFill, dispose: () => disposeAll(disposables) }
}

interface DiscardTray {
  group: THREE.Group
  setCount(n: number): void
}

/** A clear acrylic tray whose card-back stack rises `CARD_THICKNESS` per discarded card. */
function buildDiscardTray(): DiscardTray & Disposable {
  const group = new THREE.Group()
  const disposables: Disposable[] = []

  const shellMaterial = new THREE.MeshPhysicalMaterial({
    color: 0xdff2ec,
    transparent: true,
    opacity: 0.22,
    roughness: 0.05,
    metalness: 0,
    clearcoat: 1,
    side: THREE.DoubleSide,
  })
  disposables.push(shellMaterial)

  const baseGeometry = new THREE.BoxGeometry(DISCARD_WIDTH, 0.25, DISCARD_DEPTH)
  const base = new THREE.Mesh(baseGeometry, shellMaterial)
  base.position.set(DISCARD_X, TABLE_HEIGHT + 0.125, DISCARD_Z)
  base.receiveShadow = true
  disposables.push(baseGeometry)
  group.add(base)

  const longWallGeometry = new THREE.BoxGeometry(DISCARD_WIDTH, DISCARD_WALL_HEIGHT, DISCARD_WALL_THICKNESS)
  const backWall = new THREE.Mesh(longWallGeometry, shellMaterial)
  backWall.position.set(DISCARD_X, TABLE_HEIGHT + DISCARD_WALL_HEIGHT / 2, DISCARD_Z + DISCARD_DEPTH / 2)
  const frontWall = new THREE.Mesh(longWallGeometry, shellMaterial)
  frontWall.position.set(DISCARD_X, TABLE_HEIGHT + DISCARD_WALL_HEIGHT / 2, DISCARD_Z - DISCARD_DEPTH / 2)
  disposables.push(longWallGeometry)
  group.add(backWall, frontWall)

  const shortWallGeometry = new THREE.BoxGeometry(DISCARD_WALL_THICKNESS, DISCARD_WALL_HEIGHT, DISCARD_DEPTH)
  const leftWall = new THREE.Mesh(shortWallGeometry, shellMaterial)
  leftWall.position.set(DISCARD_X - DISCARD_WIDTH / 2, TABLE_HEIGHT + DISCARD_WALL_HEIGHT / 2, DISCARD_Z)
  const rightWall = new THREE.Mesh(shortWallGeometry, shellMaterial)
  rightWall.position.set(DISCARD_X + DISCARD_WIDTH / 2, TABLE_HEIGHT + DISCARD_WALL_HEIGHT / 2, DISCARD_Z)
  disposables.push(shortWallGeometry)
  group.add(leftWall, rightWall)

  const stackFloorY = TABLE_HEIGHT + 0.25
  const stackGeometry = new THREE.BoxGeometry(DISCARD_WIDTH - 0.6, 1, DISCARD_DEPTH - 0.6)
  const stackMaterial = new THREE.MeshStandardMaterial({ color: 0x5e1220, roughness: 0.5 })
  const stack = new THREE.Mesh(stackGeometry, stackMaterial)
  stack.position.set(DISCARD_X, stackFloorY, DISCARD_Z)
  stack.scale.y = 0.001
  stack.castShadow = true
  stack.receiveShadow = true
  disposables.push(stackGeometry, stackMaterial)
  group.add(stack)

  function setCount(n: number): void {
    const height = Math.max(0.001, Math.max(0, n) * CARD_THICKNESS)
    stack.scale.y = height
    stack.position.y = stackFloorY + height / 2
  }

  return { group, setCount, dispose: () => disposeAll(disposables) }
}

// -------------------------------------------------------------------------------------------
// Chips: one instanced mesh per denomination, shared by the dealer's tray (static) and the
// player's/insurance stacks (rebuilt whenever they change).
// -------------------------------------------------------------------------------------------

interface ChipMeshSet {
  mesh: THREE.InstancedMesh
  capacity: number
  faceTexture: THREE.CanvasTexture
  edgeTexture: THREE.CanvasTexture
  geometry: THREE.CylinderGeometry
  sideMaterial: THREE.MeshStandardMaterial
  capMaterial: THREE.MeshStandardMaterial
}

function buildChipGeometry(): THREE.CylinderGeometry {
  return new THREE.CylinderGeometry(CHIP_RADIUS, CHIP_RADIUS, CHIP_THICKNESS, 28, 1, false)
}

function buildChipMeshSet(value: ChipValue, parent: THREE.Group, capacity: number): ChipMeshSet {
  const { face, edge } = makeChipTextures(value)
  const geometry = buildChipGeometry()
  const sideMaterial = new THREE.MeshStandardMaterial({ map: edge, roughness: 0.55, metalness: 0 })
  const capMaterial = new THREE.MeshStandardMaterial({ map: face, roughness: 0.4, metalness: 0 })
  const mesh = new THREE.InstancedMesh(geometry, [sideMaterial, capMaterial, capMaterial], capacity)
  mesh.count = 0
  mesh.castShadow = true
  mesh.receiveShadow = true
  mesh.frustumCulled = false
  parent.add(mesh)
  return { mesh, capacity, faceTexture: face, edgeTexture: edge, geometry, sideMaterial, capMaterial }
}

interface ChipInstance {
  denom: ChipValue
  /** Offset from the stack's anchor, world inches. */
  x: number
  y: number
  z: number
  rot: number
}

/** `chipBreakdown(amount)` laid out largest-first from the anchor, columns of `CHIPS_PER_COLUMN`. */
function layoutChips(key: string, amount: number): ChipInstance[] {
  const chips = chipBreakdown(amount)
  const out: ChipInstance[] = []
  chips.forEach((denom, index) => {
    const column = Math.floor(index / CHIPS_PER_COLUMN)
    const heightIndex = index % CHIPS_PER_COLUMN
    const { dx, dz, rot } = jitterFor(key, index)
    out.push({
      denom,
      x: dx + column * COLUMN_OFFSET,
      y: heightIndex * CHIP_THICKNESS + CHIP_THICKNESS / 2,
      z: dz,
      rot,
    })
  })
  return out
}

/** A static column of one denomination, for the dealer's tray. */
function trayColumn(key: string, value: ChipValue, count: number): ChipInstance[] {
  const out: ChipInstance[] = []
  for (let i = 0; i < count; i++) {
    const { dx, dz, rot } = jitterFor(key, i)
    out.push({ denom: value, x: dx * 0.4, y: i * CHIP_THICKNESS + CHIP_THICKNESS / 2, z: dz * 0.4, rot })
  }
  return out
}

interface ChipStack {
  anchor: { x: number; y: number; z: number }
  chips: ChipInstance[]
}

/** The dealer's chip tray: one static row per denomination along the dealer edge. */
function buildTrayStacks(): ChipStack[] {
  const middle = (CHIP_DENOMINATIONS.length - 1) / 2
  return CHIP_DENOMINATIONS.map((value, index) => ({
    anchor: { x: CHIP_TRAY_X + (index - middle) * CHIP_TRAY_ROW_SPACING, y: TABLE_HEIGHT, z: CHIP_TRAY_Z },
    chips: trayColumn(`tray${value}`, value, CHIP_TRAY_ROW_COUNT),
  }))
}

// -------------------------------------------------------------------------------------------
// createTableView
// -------------------------------------------------------------------------------------------

export function createTableView(): TableView {
  const group = new THREE.Group()

  const felt = buildFelt()
  const rail = buildRail()
  const base = buildApronAndBase()
  group.add(felt.mesh, rail.group, base.group)

  const betCircleRing = buildBetCircleRing()
  group.add(betCircleRing.mesh)
  let betCircleHighlightOn = false

  const shoe = buildShoe()
  group.add(shoe.group)

  const discardTray = buildDiscardTray()
  group.add(discardTray.group)

  const chipParent = new THREE.Group()
  group.add(chipParent)
  const chipSets = new Map<ChipValue, ChipMeshSet>()
  for (const value of CHIP_DENOMINATIONS) chipSets.set(value, buildChipMeshSet(value, chipParent, CHIP_INSTANCE_INITIAL_CAPACITY))

  const trayStacks = buildTrayStacks()
  const handStacks = new Map<number, ChipStack>()
  let insuranceStack: ChipStack | null = null

  function growCapacity(value: ChipValue, needed: number): ChipMeshSet {
    const set = chipSets.get(value)!
    if (needed <= set.capacity) return set
    let capacity = set.capacity
    while (capacity < needed) capacity *= 2
    chipParent.remove(set.mesh)
    set.mesh.dispose()
    const rebuilt = new THREE.InstancedMesh(set.geometry, [set.sideMaterial, set.capMaterial, set.capMaterial], capacity)
    rebuilt.castShadow = true
    rebuilt.receiveShadow = true
    rebuilt.frustumCulled = false
    rebuilt.count = 0
    chipParent.add(rebuilt)
    const next: ChipMeshSet = { ...set, mesh: rebuilt, capacity }
    chipSets.set(value, next)
    return next
  }

  function setChips(handIndex: number, handCount: number, amount: number, insurance: number): void {
    if (amount <= 0) handStacks.delete(handIndex)
    else {
      const anchor = { x: handCenterX(handIndex, handCount), y: TABLE_HEIGHT, z: BET_CIRCLE_Z }
      handStacks.set(handIndex, { anchor, chips: layoutChips(`hand${handIndex}`, amount) })
    }
    for (const key of Array.from(handStacks.keys())) {
      if (key >= handCount) handStacks.delete(key)
    }
    setInsuranceChips(insurance)
  }

  function setInsuranceChips(amount: number): void {
    if (amount <= 0) {
      insuranceStack = null
      return
    }
    const anchor = { x: BET_CIRCLE_X, y: TABLE_HEIGHT, z: DEALER_CARD_Z + 4 }
    insuranceStack = { anchor, chips: layoutChips('insurance', amount) }
  }

  function setBetCircleHighlight(on: boolean): void {
    betCircleHighlightOn = on
  }

  const tmpMatrix = new THREE.Matrix4()
  const tmpQuat = new THREE.Quaternion()
  const tmpScale = new THREE.Vector3(1, 1, 1)
  const tmpPos = new THREE.Vector3()
  const tmpEuler = new THREE.Euler()

  function writeInstance(set: ChipMeshSet, index: number, x: number, y: number, z: number, rot: number): void {
    tmpEuler.set(0, rot, 0)
    tmpQuat.setFromEuler(tmpEuler)
    tmpPos.set(x, y, z)
    tmpMatrix.compose(tmpPos, tmpQuat, tmpScale)
    set.mesh.setMatrixAt(index, tmpMatrix)
  }

  function rebuildChipInstances(): void {
    const counts = new Map<ChipValue, number>()
    for (const value of CHIP_DENOMINATIONS) counts.set(value, 0)

    const place = (stack: ChipStack): void => {
      for (const chip of stack.chips) {
        const index = counts.get(chip.denom)!
        const set = growCapacity(chip.denom, index + 1)
        writeInstance(set, index, stack.anchor.x + chip.x, stack.anchor.y + chip.y, stack.anchor.z + chip.z, chip.rot)
        counts.set(chip.denom, index + 1)
      }
    }

    for (const stack of trayStacks) place(stack)
    for (const stack of handStacks.values()) place(stack)
    if (insuranceStack) place(insuranceStack)

    for (const [value, set] of chipSets) {
      const count = counts.get(value)!
      set.mesh.count = count
      if (count > 0) set.mesh.instanceMatrix.needsUpdate = true
    }
  }

  // The tray's chips never change, so lay them out once; hand/insurance stacks are rebuilt by
  // `rebuildChipInstances` whenever `update` runs (cheap: a few dozen chips at most).
  rebuildChipInstances()

  function update(time: number): void {
    betCircleRing.material.emissiveIntensity = betCircleHighlightOn ? 0.4 + 0.35 * Math.sin(time * 4) : 0.12
    rebuildChipInstances()
  }

  function dispose(): void {
    felt.dispose()
    rail.dispose()
    base.dispose()
    betCircleRing.dispose()
    shoe.dispose()
    discardTray.dispose()
    for (const set of chipSets.values()) {
      set.mesh.dispose()
      set.geometry.dispose()
      set.sideMaterial.dispose()
      set.capMaterial.dispose()
      set.faceTexture.dispose()
      set.edgeTexture.dispose()
    }
  }

  return {
    group,
    setBetCircleHighlight,
    setChips,
    setInsuranceChips,
    setDiscardCount: discardTray.setCount,
    setShoeFill: shoe.setFill,
    update,
    dispose,
  }
}
