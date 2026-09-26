/**
 * Builds the three.js scene, camera, renderer and simulation loop for one canvas: the whole
 * playable blackjack table. Everything created here (geometries, materials, textures, render
 * targets, the renderer, the composer, the DOM listeners) is disposed by `dispose()`, and nothing
 * is created outside this function, so the returned `EngineApi` is safe to construct and tear down
 * repeatedly (React StrictMode double-invokes it).
 */

import * as THREE from 'three'
import { EffectComposer } from 'three/examples/jsm/postprocessing/EffectComposer.js'
import { RenderPass } from 'three/examples/jsm/postprocessing/RenderPass.js'
import { UnrealBloomPass } from 'three/examples/jsm/postprocessing/UnrealBloomPass.js'
import { OutputPass } from 'three/examples/jsm/postprocessing/OutputPass.js'

import type { CameraView, EngineApi, EngineEvents, EngineMode, HudDealer, HudHand, HudResult, HudSnapshot, ViewInsets } from './engineApi.ts'

import { createCasinoRoom } from './casinoRoom.ts'
import { createTableView } from './tableView.ts'
import { createCardView, easeInOutCubic } from './cardView.ts'
import { createCrowd } from './crowd.ts'
import { createConfetti } from './confetti.ts'

import {
  BET_CIRCLE_RADIUS,
  BET_CIRCLE_X,
  BET_CIRCLE_Z,
  DEALER_CARD_X,
  DEALER_CARD_Z,
  DEALER_X,
  DEALER_Z,
  FOCUS_X,
  FOCUS_Z,
  PLAYER_CARD_Z,
  PLAYER_EYE,
  TABLE_CENTER_X,
  TABLE_HEIGHT,
  TABLE_MAX_X,
  TABLE_MIN_X,
  TABLE_MIN_Z,
  TABLE_RADIUS,
  dealerCardPosition,
  handCenterX,
  playerCardPosition,
} from './layout.ts'
import type { Point3 } from './layout.ts'

import { CUT_CARD_REMAINING, DECK_COUNT, handValue } from '../game/cards.ts'
import {
  answerInsurance as sessionAnswerInsurance,
  availableActions,
  beginBetting as sessionBeginBetting,
  clearBet as sessionClearBet,
  createSession,
  deal as sessionDeal,
  double as sessionDouble,
  doubleBet as sessionDoubleBet,
  hintFor,
  isBroke,
  placeChip as sessionPlaceChip,
  rebet as sessionRebet,
  refill as sessionRefill,
  split as sessionSplit,
  stand as sessionStand,
  hit as sessionHit,
  toSave,
  undoChip as sessionUndoChip,
} from '../game/session.ts'
import { createRng, randomSeed } from '../game/rng.ts'
import { attractAction, attractBet } from '../game/autoplay.ts'
import { crowdReaction } from '../game/crowd.ts'
import type { Card, ChipValue, Command, HandOutcome, HandStatus, RoundResult, Session, SessionPhase, SessionSave, Transition } from '../game/types.ts'

// -------------------------------------------------------------------------------------------
// Renderer / post-processing look
// -------------------------------------------------------------------------------------------

const BACKGROUND_COLOR = 0x0b0706
const FOG_DENSITY = 0.0018
const TONE_MAPPING_EXPOSURE = 1.1
const ENVIRONMENT_INTENSITY = 0.5
const BLOOM_STRENGTH = 0.25
const BLOOM_RADIUS = 0.4
const BLOOM_THRESHOLD = 1.0
const SHADOW_MAP_SIZE = 2048

// -------------------------------------------------------------------------------------------
// Lights
// -------------------------------------------------------------------------------------------

const CARD_SPOT_INTENSITY = 3.2
const CIRCLE_SPOT_INTENSITY = 1.6
const HEMI_SKY_COLOR = 0x8a7550
const HEMI_GROUND_COLOR = 0x140a06
const HEMI_INTENSITY = 0.35
const RIM_LIGHT_COLOR = 0x9fc9ff
const RIM_LIGHT_INTENSITY = 0.3
/** On a win the table lamps flash brighter, then ease back over this many seconds. */
const LAMP_FLASH_SECONDS = 1
const LAMP_FLASH_PEAK = 0.6

// -------------------------------------------------------------------------------------------
// Environment capture
// -------------------------------------------------------------------------------------------

const ENVIRONMENT_SOFTBOX_INTENSITY = 2.2
const ENVIRONMENT_FILL_INTENSITY = 0.5

// -------------------------------------------------------------------------------------------
// Camera
// -------------------------------------------------------------------------------------------

const CAMERA_NEAR = 0.4
const CAMERA_FAR = 800
const CAMERA_FOV_DEGREES = 40
const VIEW_BLEND_SECONDS = 0.9
const MIN_FREE_FRACTION = 0.3
const CAMERA_FIT_MARGIN = 0.04
const FIT_ITERATIONS = 24
const FIT_MIN_EXTRA = 0
const FIT_MAX_EXTRA = 500
/** Fit points cover the table's half-moon footprint plus this much margin, in inches. */
const TABLE_FIT_MARGIN = 6

/**
 * Rendering cost steps, best first. The engine starts at the first step a device can likely hold
 * and only ever steps down, when frames stay slow, so a phone never flip-flops between two looks.
 */
const QUALITY_STEPS: { pixelRatio: number; bloom: boolean; shadowMapSize: number }[] = [
  { pixelRatio: 2, bloom: true, shadowMapSize: 2048 },
  { pixelRatio: 1.5, bloom: true, shadowMapSize: 1024 },
  { pixelRatio: 1, bloom: true, shadowMapSize: 1024 },
  { pixelRatio: 1, bloom: false, shadowMapSize: 1024 },
]
const TOUCH_START_QUALITY = 1
const SLOW_FRAME_SECONDS = 1 / 38
const SLOW_FRAMES_TO_STEP_DOWN = 90
const QUALITY_SETTLE_FRAMES = 60
const MAX_FRAME_SECONDS = 1 / 20

// -------------------------------------------------------------------------------------------
// Pointer input
// -------------------------------------------------------------------------------------------

const TAP_MAX_MOVE_PX = 8
const LONG_PRESS_MS = 450

// -------------------------------------------------------------------------------------------
// Command playback timings, seconds. Halved by quick deal.
// -------------------------------------------------------------------------------------------

const DISCARD_SECONDS = 0.45
const SHUFFLE_DISCARD_SECONDS = 0.5
const SHUFFLE_TOTAL_SECONDS = 1.0
const DEAL_SECONDS = 0.45
const REVEAL_SECONDS = 0.5
const SPLIT_MOVE_SECONDS = 0.4
const BUST_HOLD_SECONDS = 0.6
const SETTLE_HOLD_SECONDS = 0.5

// -------------------------------------------------------------------------------------------
// Attract mode
// -------------------------------------------------------------------------------------------

const ATTRACT_BET_PAUSE_SECONDS = 0.3
const ATTRACT_ACTION_PAUSE_SECONDS = 0.9
const ATTRACT_RESULT_PAUSE_SECONDS = 3

// -------------------------------------------------------------------------------------------
// Small maths helpers
// -------------------------------------------------------------------------------------------

// -------------------------------------------------------------------------------------------
// Engine
// -------------------------------------------------------------------------------------------

/**
 * Builds and runs the whole table on `canvas`, reporting sound/HUD/message/save events back
 * through `events`. See the module doc comment above.
 */
export function createEngine(canvas: HTMLCanvasElement, events: EngineEvents): EngineApi {
  // --- Renderer / scene -----------------------------------------------------------------------

  const renderer = new THREE.WebGLRenderer({ canvas, antialias: true, powerPreference: 'high-performance' })
  const requestedQuality = new URLSearchParams(window.location.search).get('quality')
  const qualityPinned = requestedQuality === 'high' || requestedQuality === 'low'
  const touchDevice = window.matchMedia('(pointer: coarse)').matches
  let qualityStep =
    requestedQuality === 'high' ? 0
    : requestedQuality === 'low' ? QUALITY_STEPS.length - 1
    : touchDevice ? TOUCH_START_QUALITY
    : 0
  renderer.setPixelRatio(Math.min(window.devicePixelRatio, QUALITY_STEPS[qualityStep]!.pixelRatio))
  renderer.toneMapping = THREE.ACESFilmicToneMapping
  renderer.toneMappingExposure = TONE_MAPPING_EXPOSURE
  renderer.outputColorSpace = THREE.SRGBColorSpace
  renderer.shadowMap.enabled = true
  renderer.shadowMap.type = THREE.PCFShadowMap

  const scene = new THREE.Scene()
  scene.background = new THREE.Color(BACKGROUND_COLOR)
  scene.fog = new THREE.FogExp2(BACKGROUND_COLOR, FOG_DENSITY)

  // --- Environment: the room's own glow lights the felt and lacquer, not a studio softbox ------

  const room = createCasinoRoom()
  const pmremGenerator = new THREE.PMREMGenerator(renderer)
  const environmentScene = new THREE.Scene()
  environmentScene.background = new THREE.Color(BACKGROUND_COLOR)
  const softboxGeometry = new THREE.PlaneGeometry(90, 60)
  const softboxMaterial = new THREE.MeshBasicMaterial({ color: 0xffe9cf, side: THREE.DoubleSide })
  softboxMaterial.color.multiplyScalar(ENVIRONMENT_SOFTBOX_INTENSITY)
  const softbox = new THREE.Mesh(softboxGeometry, softboxMaterial)
  softbox.rotation.x = Math.PI / 2
  softbox.position.set(TABLE_CENTER_X + 20, TABLE_HEIGHT + 90, TABLE_MIN_Z - 10)
  const environmentFill = new THREE.HemisphereLight(HEMI_SKY_COLOR, HEMI_GROUND_COLOR, ENVIRONMENT_FILL_INTENSITY)
  environmentScene.add(room.group, softbox, environmentFill)
  const environmentTarget = pmremGenerator.fromScene(environmentScene, 0.015, 1, 900, {
    position: new THREE.Vector3(TABLE_CENTER_X, TABLE_HEIGHT + 30, (TABLE_MIN_Z + TABLE_MIN_Z + TABLE_RADIUS) / 2),
  })
  scene.environment = environmentTarget.texture
  scene.environmentIntensity = ENVIRONMENT_INTENSITY
  environmentScene.remove(room.group, softbox, environmentFill)
  softboxGeometry.dispose()
  softboxMaterial.dispose()
  environmentFill.dispose()
  pmremGenerator.dispose()
  scene.add(room.group)

  // --- Post-processing -------------------------------------------------------------------------

  const camera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, CAMERA_NEAR, CAMERA_FAR)

  const composer = new EffectComposer(renderer)
  const renderPass = new RenderPass(scene, camera)
  const bloomPass = new UnrealBloomPass(new THREE.Vector2(1, 1), BLOOM_STRENGTH, BLOOM_RADIUS, BLOOM_THRESHOLD)
  const outputPass = new OutputPass()
  bloomPass.enabled = QUALITY_STEPS[qualityStep]!.bloom
  composer.addPass(renderPass)
  composer.addPass(bloomPass)
  composer.addPass(outputPass)

  // --- Scene content -----------------------------------------------------------------------------

  const table = createTableView()
  const cardView = createCardView()
  const crowd = createCrowd()
  const confetti = createConfetti()
  scene.add(table.group, cardView.group, crowd.group, confetti.group)

  // --- Lighting (decay = 0: the scene is in inches, not metres) ---------------------------------

  const cardSpot = new THREE.SpotLight(0xffdca8, CARD_SPOT_INTENSITY)
  cardSpot.position.set(FOCUS_X, TABLE_HEIGHT + 60, FOCUS_Z + 6)
  cardSpot.target.position.set(FOCUS_X, TABLE_HEIGHT, FOCUS_Z)
  cardSpot.angle = Math.atan2(TABLE_RADIUS * 0.7, 60)
  cardSpot.penumbra = 0.55
  cardSpot.decay = 0
  cardSpot.distance = 0
  cardSpot.castShadow = true
  cardSpot.shadow.mapSize.setScalar(Math.min(SHADOW_MAP_SIZE, QUALITY_STEPS[qualityStep]!.shadowMapSize))
  cardSpot.shadow.camera.near = 10
  cardSpot.shadow.camera.far = 160
  cardSpot.shadow.bias = -0.0006
  cardSpot.shadow.normalBias = 0.02
  scene.add(cardSpot, cardSpot.target)

  const circleSpot = new THREE.SpotLight(0xffdca8, CIRCLE_SPOT_INTENSITY)
  circleSpot.position.set(BET_CIRCLE_X, TABLE_HEIGHT + 50, BET_CIRCLE_Z + 4)
  circleSpot.target.position.set(BET_CIRCLE_X, TABLE_HEIGHT, BET_CIRCLE_Z)
  circleSpot.angle = Math.atan2(BET_CIRCLE_RADIUS * 2.5, 50)
  circleSpot.penumbra = 0.6
  circleSpot.decay = 0
  circleSpot.distance = 0
  scene.add(circleSpot, circleSpot.target)

  const hemiFill = new THREE.HemisphereLight(HEMI_SKY_COLOR, HEMI_GROUND_COLOR, HEMI_INTENSITY)
  scene.add(hemiFill)

  const rimLight = new THREE.DirectionalLight(RIM_LIGHT_COLOR, RIM_LIGHT_INTENSITY)
  rimLight.position.set(DEALER_X, TABLE_HEIGHT + 70, DEALER_Z - 40)
  scene.add(rimLight)

  let lampFlashElapsed: number | null = null
  let lampFlashStrength = 0

  function updateLampFlash(dt: number): void {
    let gain = 1
    if (lampFlashElapsed !== null) {
      lampFlashElapsed += dt
      if (lampFlashElapsed >= LAMP_FLASH_SECONDS) {
        lampFlashElapsed = null
      } else {
        gain = 1 + LAMP_FLASH_PEAK * lampFlashStrength * (1 - lampFlashElapsed / LAMP_FLASH_SECONDS)
      }
    }
    cardSpot.intensity = CARD_SPOT_INTENSITY * gain
    circleSpot.intensity = CIRCLE_SPOT_INTENSITY * gain
  }

  // --- Camera fit geometry -----------------------------------------------------------------------

  type FitView = 'seat' | 'cards' | 'overhead'

  function tableFitPoints(): THREE.Vector3[] {
    const radius = TABLE_RADIUS + TABLE_FIT_MARGIN
    const segments = 12
    const points: THREE.Vector3[] = []
    for (let i = 0; i <= segments; i++) {
      const angle = -Math.PI / 2 + (i / segments) * Math.PI
      points.push(new THREE.Vector3(TABLE_CENTER_X + Math.sin(angle) * radius, TABLE_HEIGHT, TABLE_MIN_Z + Math.cos(angle) * radius))
    }
    points.push(new THREE.Vector3(TABLE_MIN_X - TABLE_FIT_MARGIN, TABLE_HEIGHT, TABLE_MIN_Z - TABLE_FIT_MARGIN))
    points.push(new THREE.Vector3(TABLE_MAX_X + TABLE_FIT_MARGIN, TABLE_HEIGHT, TABLE_MIN_Z - TABLE_FIT_MARGIN))
    return points
  }

  const TABLE_FIT_POINTS = tableFitPoints()
  /** The 'cards' view frames only the playing area: the dealer's row down to the betting circle. */
  const CARDS_FIT_POINTS: THREE.Vector3[] = [
    new THREE.Vector3(-22, TABLE_HEIGHT, DEALER_CARD_Z - 4),
    new THREE.Vector3(22, TABLE_HEIGHT, DEALER_CARD_Z - 4),
    new THREE.Vector3(-22, TABLE_HEIGHT, BET_CIRCLE_Z + 5),
    new THREE.Vector3(22, TABLE_HEIGHT, BET_CIRCLE_Z + 5),
  ]

  const SEAT_EYE = new THREE.Vector3(PLAYER_EYE.x, PLAYER_EYE.y, PLAYER_EYE.z)
  const SEAT_LOOK = new THREE.Vector3(0, TABLE_HEIGHT, -4)
  const CARDS_EYE = new THREE.Vector3(0, TABLE_HEIGHT + 24, 24)
  const CARDS_LOOK = new THREE.Vector3(0, TABLE_HEIGHT, -2)
  const OVERHEAD_EYE = new THREE.Vector3(0, TABLE_HEIGHT + 78, 2)
  const OVERHEAD_LOOK = new THREE.Vector3(0, TABLE_HEIGHT, 1)
  const OVERHEAD_UP = new THREE.Vector3(0, 0, -1)
  const DEFAULT_UP = new THREE.Vector3(0, 1, 0)

  function buildRig(view: FitView): void {
    if (view === 'seat') {
      rigEyeScratch.copy(SEAT_EYE)
      rigLookScratch.copy(SEAT_LOOK)
      rigUpScratch.copy(DEFAULT_UP)
      return
    }
    if (view === 'cards') {
      rigEyeScratch.copy(CARDS_EYE)
      rigLookScratch.copy(CARDS_LOOK)
      rigUpScratch.copy(DEFAULT_UP)
      return
    }
    rigEyeScratch.copy(OVERHEAD_EYE)
    rigLookScratch.copy(OVERHEAD_LOOK)
    rigUpScratch.copy(OVERHEAD_UP)
  }

  function pullBackScratch(extra: number): void {
    if (extra <= 0) return
    const dx = rigEyeScratch.x - rigLookScratch.x
    const dy = rigEyeScratch.y - rigLookScratch.y
    const dz = rigEyeScratch.z - rigLookScratch.z
    const length = Math.hypot(dx, dy, dz)
    if (length < 1e-6) return
    const scale = (length + extra) / length
    rigEyeScratch.set(rigLookScratch.x + dx * scale, rigLookScratch.y + dy * scale, rigLookScratch.z + dz * scale)
  }

  const probeCamera = new THREE.PerspectiveCamera(CAMERA_FOV_DEGREES, 1, CAMERA_NEAR, CAMERA_FAR)
  const projectedScratch = new THREE.Vector3()

  function cornersFit(view: FitView, limitX: number, limitY: number): boolean {
    probeCamera.updateMatrixWorld(true)
    probeCamera.updateProjectionMatrix()
    const points = view === 'cards' ? CARDS_FIT_POINTS : TABLE_FIT_POINTS
    return points.every((corner) => {
      projectedScratch.copy(corner).project(probeCamera)
      return Math.abs(projectedScratch.x) <= limitX && Math.abs(projectedScratch.y) <= limitY
    })
  }

  function fitView(view: FitView): number {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return fitExtra[view]

    const freeX = Math.max(MIN_FREE_FRACTION, (width - insets.left - insets.right) / width)
    const freeY = Math.max(MIN_FREE_FRACTION, (height - insets.top - insets.bottom) / height)
    const limitX = freeX * (1 - CAMERA_FIT_MARGIN)
    const limitY = freeY * (1 - CAMERA_FIT_MARGIN)

    probeCamera.fov = CAMERA_FOV_DEGREES
    probeCamera.aspect = aspect
    probeCamera.near = CAMERA_NEAR
    probeCamera.far = CAMERA_FAR

    function fits(extra: number): boolean {
      buildRig(view)
      pullBackScratch(extra)
      probeCamera.position.copy(rigEyeScratch)
      probeCamera.up.copy(rigUpScratch)
      probeCamera.lookAt(rigLookScratch)
      return cornersFit(view, limitX, limitY)
    }

    let lo = FIT_MIN_EXTRA
    let hi = FIT_MAX_EXTRA
    if (!fits(hi)) return hi
    for (let i = 0; i < FIT_ITERATIONS; i++) {
      const mid = (lo + hi) / 2
      if (fits(mid)) hi = mid
      else lo = mid
    }
    return hi
  }

  const fitExtra: Record<FitView, number> = { seat: 0, cards: 0, overhead: 0 }

  function refitAllViews(): void {
    fitExtra.seat = fitView('seat')
    fitExtra.cards = fitView('cards')
    fitExtra.overhead = fitView('overhead')
  }

  function applyViewOffset(): void {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    camera.setViewOffset(width, height, -(insets.left - insets.right) / 2, -(insets.top - insets.bottom) / 2, width, height)
  }

  let insets: ViewInsets = { left: 0, top: 0, right: 0, bottom: 0 }
  let aspect = 1

  const rigEyeScratch = new THREE.Vector3()
  const rigLookScratch = new THREE.Vector3()
  const rigUpScratch = new THREE.Vector3(0, 1, 0)

  const cameraPosition = new THREE.Vector3()
  const cameraLookAt = new THREE.Vector3()
  const cameraUp = new THREE.Vector3(0, 1, 0)
  let cameraInitialized = false
  let blendFrom: { eye: THREE.Vector3; look: THREE.Vector3; up: THREE.Vector3 } | null = null
  let blendElapsed = 0
  let lastResolvedView: FitView | null = null

  function resolveView(): FitView {
    if (cameraView !== 'auto') return cameraView
    // Portrait screens cannot read the cards from the seat view, so stay close while playing.
    if (aspect < 1 && mode === 'play') return 'cards'
    if (dealerTurn || displayPhase === 'insurance' || displayPhase === 'player') return 'cards'
    return 'seat'
  }

  function updateCamera(dt: number): void {
    const resolved = resolveView()
    buildRig(resolved)
    pullBackScratch(fitExtra[resolved])

    if (!cameraInitialized) {
      cameraPosition.copy(rigEyeScratch)
      cameraLookAt.copy(rigLookScratch)
      cameraUp.copy(rigUpScratch)
      cameraInitialized = true
      lastResolvedView = resolved
    } else if (resolved !== lastResolvedView) {
      blendFrom = { eye: cameraPosition.clone(), look: cameraLookAt.clone(), up: cameraUp.clone() }
      blendElapsed = 0
      lastResolvedView = resolved
    }

    if (blendFrom) {
      blendElapsed += dt
      const t = Math.min(1, blendElapsed / VIEW_BLEND_SECONDS)
      const eased = easeInOutCubic(t)
      cameraPosition.lerpVectors(blendFrom.eye, rigEyeScratch, eased)
      cameraLookAt.lerpVectors(blendFrom.look, rigLookScratch, eased)
      cameraUp.lerpVectors(blendFrom.up, rigUpScratch, eased).normalize()
      if (t >= 1) blendFrom = null
    } else {
      cameraPosition.copy(rigEyeScratch)
      cameraLookAt.copy(rigLookScratch)
      cameraUp.copy(rigUpScratch)
    }

    camera.position.copy(cameraPosition)
    camera.up.copy(cameraUp)
    camera.lookAt(cameraLookAt)
  }

  // --- Session / display state -------------------------------------------------------------------

  let mode: EngineMode = 'attract'
  let session: Session = createSession(null, randomSeed())
  let selectedChip: ChipValue = 5
  let quickDeal = false
  let paused = false
  let cameraView: CameraView = 'auto'

  /** Lags `session.phase` until the current command queue drains, so the camera/crowd/HUD never
   * jump to 'result' while the dealer's cards are still being animated. */
  let displayPhase: SessionPhase = session.phase
  /** True from the moment a `reveal` command is processed until the queue drains: the dealer's turn. */
  let dealerTurn = false
  let laggedHistory: HandOutcome[] = []
  let laggedLastResult: RoundResult | null = null
  let laggedRounds = 0

  function syncLagged(): void {
    displayPhase = session.phase
    dealerTurn = false
    laggedHistory = session.history.slice(0, 20)
    laggedLastResult = session.lastResult
    laggedRounds = session.stats.rounds
  }
  syncLagged()

  // --- Progressive card reveal state (what has actually been shown on the felt so far) ----------

  let nextCardId = 0
  function newCardId(): string {
    return `c${nextCardId++}`
  }

  let handCardIds: string[][] = []
  let shownHandCards: Card[][] = []
  let dealerCardIds: string[] = []
  let shownDealerCards: Card[] = []
  let dealerHoleRevealed = false
  let bustHands = new Set<number | 'dealer'>()
  let settledHands = new Set<number>()
  let trayCount = 0

  function resetShownState(): void {
    handCardIds = []
    shownHandCards = []
    dealerCardIds = []
    shownDealerCards = []
    dealerHoleRevealed = false
    bustHands = new Set()
    settledHands = new Set()
  }

  function scaled(seconds: number): number {
    return quickDeal ? seconds / 2 : seconds
  }

  // --- Command queue --------------------------------------------------------------------------

  type QueuedItem = { command: Command } | { internal: 'preDiscard' }

  let queue: QueuedItem[] = []
  let queueIndex = 0
  let queueWaitRemaining = 0
  let queueActive = false
  let queueSilent = false

  function triggerRoundReaction(): void {
    const reaction = crowdReaction(session.lastResult)
    if (!reaction) return
    crowd.react(reaction.kind, reaction.strength)
    if (!queueSilent) events.onSound(reaction.kind, reaction.strength)
    if (reaction.kind === 'cheer') {
      confetti.burst(reaction.strength)
      lampFlashElapsed = 0
      lampFlashStrength = reaction.strength
    }
  }

  function processCommand(command: Command): number {
    switch (command.type) {
      case 'shuffle': {
        cardView.discardAll(scaled(SHUFFLE_DISCARD_SECONDS))
        resetShownState()
        trayCount = 0
        table.setDiscardCount(0)
        table.setShoeFill(1)
        return scaled(SHUFFLE_TOTAL_SECONDS)
      }
      case 'deal': {
        const id = newCardId()
        if (command.to === 'dealer') {
          dealerCardIds.push(id)
          shownDealerCards.push(command.card)
          const pos = dealerCardPosition(dealerCardIds.length - 1)
          cardView.dealTo(id, command.card, pos, command.faceDown, 0, scaled(DEAL_SECONDS))
        } else {
          const idx = command.to
          handCardIds[idx] = handCardIds[idx] ?? []
          shownHandCards[idx] = shownHandCards[idx] ?? []
          handCardIds[idx]!.push(id)
          shownHandCards[idx]!.push(command.card)
          const handCount = handCardIds.length
          const pos: Point3 = playerCardPosition(idx, handCount, handCardIds[idx]!.length - 1)
          cardView.dealTo(id, command.card, pos, command.faceDown, 0, scaled(DEAL_SECONDS))
        }
        return scaled(DEAL_SECONDS)
      }
      case 'reveal': {
        dealerTurn = true
        const holeId = dealerCardIds[1]
        if (holeId) cardView.flip(holeId, scaled(REVEAL_SECONDS))
        dealerHoleRevealed = true
        if (!queueSilent) events.onSound('flip', 1)
        return scaled(REVEAL_SECONDS)
      }
      case 'split': {
        const hand = command.hand
        const oldIds = handCardIds[hand] ?? []
        const oldCards = shownHandCards[hand] ?? []
        handCardIds.splice(hand, 1, oldIds[0] !== undefined ? [oldIds[0]] : [], oldIds[1] !== undefined ? [oldIds[1]] : [])
        shownHandCards.splice(hand, 1, oldCards[0] !== undefined ? [oldCards[0]] : [], oldCards[1] !== undefined ? [oldCards[1]] : [])
        const count = handCardIds.length
        for (let h = 0; h < count; h++) {
          const ids = handCardIds[h] ?? []
          for (let c = 0; c < ids.length; c++) cardView.moveTo(ids[c]!, playerCardPosition(h, count, c), scaled(SPLIT_MOVE_SECONDS))
          table.setChips(h, count, session.hands[h]?.bet ?? 0, session.insurance)
        }
        return scaled(SPLIT_MOVE_SECONDS)
      }
      case 'double': {
        table.setChips(command.hand, Math.max(1, handCardIds.length), session.hands[command.hand]?.bet ?? 0, session.insurance)
        return 0
      }
      case 'bust': {
        bustHands.add(command.hand)
        return scaled(BUST_HOLD_SECONDS)
      }
      case 'insurance': {
        table.setInsuranceChips(command.won ? command.returned : 0)
        return 0
      }
      case 'settle': {
        settledHands.add(command.hand)
        table.setChips(command.hand, Math.max(1, handCardIds.length), command.returned, session.insurance)
        if (command.returned === 0) {
          for (const id of handCardIds[command.hand] ?? []) cardView.setDimmed(id, true)
        }
        if (settledHands.size >= session.hands.length) triggerRoundReaction()
        return scaled(SETTLE_HOLD_SECONDS)
      }
      case 'sound': {
        if (!queueSilent) events.onSound(command.name, 1)
        return 0
      }
      case 'message': {
        if (!queueSilent) events.onMessage(command.text, command.seconds)
        return 0
      }
      case 'save': {
        if (!queueSilent) events.onSave(toSave(session))
        return 0
      }
    }
  }

  function processItem(item: QueuedItem): number {
    if ('internal' in item) {
      const cardCount = handCardIds.reduce((sum, ids) => sum + ids.length, 0) + dealerCardIds.length
      cardView.discardAll(scaled(DISCARD_SECONDS))
      trayCount += cardCount
      table.setDiscardCount(trayCount)
      resetShownState()
      return scaled(DISCARD_SECONDS)
    }
    return processCommand(item.command)
  }

  function processQueue(dt: number): void {
    if (!queueActive || paused) return
    if (queueWaitRemaining > 0) {
      queueWaitRemaining -= dt
      if (queueWaitRemaining > 0) return
      queueWaitRemaining = 0
    }
    for (;;) {
      if (queueIndex >= queue.length) {
        queueActive = false
        queue = []
        queueIndex = 0
        syncLagged()
        if (!queueSilent) emitHud()
        return
      }
      const item = queue[queueIndex]!
      queueIndex++
      const wait = processItem(item)
      table.setShoeFill(session.shoe.length / (DECK_COUNT * 52))
      if (!queueSilent) emitHud()
      if (wait > 0) {
        queueWaitRemaining = wait
        return
      }
    }
  }

  /** Applies a `Transition` immediately and queues its commands for animated playback. */
  function runAction(transition: Transition, opts: { silent: boolean; isDeal?: boolean }): void {
    session = transition.session
    if (session.hands.length === 0) table.setChips(0, 1, session.bet, session.insurance)
    if (transition.commands.length === 0) {
      if (!opts.silent) emitHud()
      return
    }
    if (opts.isDeal) {
      crowd.calm()
      confetti.clear()
      table.setChips(0, 1, session.hands[0]?.bet ?? 0, session.insurance)
    }
    const items: QueuedItem[] = []
    if (opts.isDeal) {
      const cardsOnTable = handCardIds.some((ids) => ids.length > 0) || dealerCardIds.length > 0
      if (cardsOnTable) items.push({ internal: 'preDiscard' })
    }
    for (const command of transition.commands) items.push({ command })
    queue = items
    queueIndex = 0
    queueActive = true
    queueSilent = opts.silent
  }

  // --- HUD -------------------------------------------------------------------------------------

  function computeHeadline(result: RoundResult): string {
    if (result.hands.some((h) => h.outcome === 'blackjack')) return 'Blackjack!'
    if (result.dealerTotal > 21 && result.net > 0) return 'Dealer busts'
    if (result.net > 0) return 'You win'
    if (result.net === 0) return 'Push'
    if (result.hands.every((h) => h.outcome === 'bust')) return 'Bust'
    return 'Dealer wins'
  }

  function buildHudSnapshot(): HudSnapshot {
    const hands: HudHand[] = session.hands.map((hand, i): HudHand => {
      const cards = shownHandCards[i] ?? []
      const value = handValue(cards)
      const settled = settledHands.has(i)
      const bust = bustHands.has(i)
      const status: HandStatus = bust ? 'bust' : hand.status === 'bust' && !settled ? 'playing' : hand.status
      return {
        cards,
        total: value.total,
        soft: value.soft,
        bet: hand.bet,
        status,
        outcome: settled ? hand.outcome : null,
        active: displayPhase === 'player' && i === session.activeHand,
      }
    })

    const dealerVisible = dealerHoleRevealed ? shownDealerCards : shownDealerCards.slice(0, 1)
    const dealerValue = handValue(dealerVisible)
    const dealer: HudDealer = { cards: dealerVisible, total: dealerValue.total, soft: dealerValue.soft, holeHidden: !dealerHoleRevealed }

    const lastResult: HudResult | null = laggedLastResult
      ? {
          staked: laggedLastResult.staked,
          returned: laggedLastResult.returned,
          net: laggedLastResult.net,
          outcome: laggedLastResult.outcome,
          headline: computeHeadline(laggedLastResult),
        }
      : null

    return {
      phase: displayPhase,
      bankroll: session.bankroll,
      bet: session.hands.length > 0 ? session.hands.reduce((sum, hand) => sum + hand.bet, 0) + session.insurance : session.bet,
      selectedChip,
      hands,
      dealer,
      insuranceBet: session.insurance,
      can: availableActions(session),
      hint: hintFor(session),
      lastResult,
      history: laggedHistory,
      broke: isBroke(session),
      rounds: laggedRounds,
      shoeRemaining: Math.max(0, session.shoe.length - CUT_CARD_REMAINING),
    }
  }

  let lastHudJson: string | null = null
  function emitHud(): void {
    if (mode !== 'play') return
    const snapshot = buildHudSnapshot()
    const json = JSON.stringify(snapshot)
    if (json !== lastHudJson) {
      lastHudJson = json
      events.onHud(snapshot)
    }
  }

  // --- Crowd watch target ------------------------------------------------------------------------

  const crowdWatchScratch = new THREE.Vector3()

  function updateCrowdWatch(): void {
    if (dealerTurn) {
      crowdWatchScratch.set(DEALER_CARD_X, TABLE_HEIGHT, DEALER_CARD_Z)
      crowd.setWatchTarget(crowdWatchScratch)
    } else if (displayPhase === 'player') {
      const count = Math.max(1, handCardIds.length)
      crowdWatchScratch.set(handCenterX(session.activeHand, count), TABLE_HEIGHT, PLAYER_CARD_Z)
      crowd.setWatchTarget(crowdWatchScratch)
    } else {
      crowd.setWatchTarget(null)
    }
  }

  // --- Game lifecycle ------------------------------------------------------------------------------

  function resetTableVisuals(): void {
    cardView.clear()
    table.setChips(0, 1, 0, 0)
    table.setInsuranceChips(0)
    table.setDiscardCount(0)
    table.setShoeFill(1)
    trayCount = 0
    queue = []
    queueIndex = 0
    queueActive = false
    queueWaitRemaining = 0
  }

  function beginPlay(save: SessionSave | null): void {
    mode = 'play'
    session = createSession(save, randomSeed())
    resetShownState()
    resetTableVisuals()
    syncLagged()
    crowd.calm()
    confetti.clear()
    lastHudJson = null
    emitHud()
  }

  let attractRng: () => number = createRng(randomSeed())
  type AttractPhase = 'bet-pending' | 'deal-pending' | 'acting' | 'result-pending'
  let attractPhase: AttractPhase = 'bet-pending'
  let attractDelay = 0

  function beginAttract(): void {
    runAction(sessionClearBet(session), { silent: true })
    mode = 'attract'
    session = createSession(null, randomSeed())
    attractRng = createRng(randomSeed())
    resetShownState()
    resetTableVisuals()
    syncLagged()
    crowd.calm()
    confetti.clear()
    attractPhase = 'bet-pending'
    attractDelay = 0
  }

  function stepAttract(dt: number): void {
    if (mode !== 'attract' || queueActive) return
    if (attractDelay > 0) {
      attractDelay -= dt
      if (attractDelay > 0) return
    }
    switch (attractPhase) {
      case 'bet-pending': {
        if (isBroke(session)) runAction(sessionRefill(session), { silent: true })
        const amount = attractBet(attractRng, session.bankroll)
        if (amount <= 0) {
          attractDelay = ATTRACT_BET_PAUSE_SECONDS
          return
        }
        runAction(sessionPlaceChip(session, amount as ChipValue), { silent: true })
        attractDelay = ATTRACT_BET_PAUSE_SECONDS
        attractPhase = 'deal-pending'
        return
      }
      case 'deal-pending': {
        runAction(sessionDeal(session), { silent: true, isDeal: true })
        attractPhase = 'acting'
        return
      }
      case 'acting': {
        if (session.phase === 'result') {
          attractDelay = ATTRACT_RESULT_PAUSE_SECONDS
          attractPhase = 'result-pending'
          return
        }
        if (session.phase === 'insurance') {
          runAction(sessionAnswerInsurance(session, false), { silent: true })
        } else if (session.phase === 'player') {
          const action = attractAction(session)
          if (action === 'hit') runAction(sessionHit(session), { silent: true })
          else if (action === 'double') runAction(sessionDouble(session), { silent: true })
          else if (action === 'split') runAction(sessionSplit(session), { silent: true })
          else runAction(sessionStand(session), { silent: true })
        }
        attractDelay = ATTRACT_ACTION_PAUSE_SECONDS
        return
      }
      case 'result-pending': {
        session = sessionBeginBetting(session)
        syncLagged()
        attractPhase = 'bet-pending'
        attractDelay = 0
        return
      }
    }
  }

  // --- Pointer input (play mode, betting only) ----------------------------------------------------

  const raycaster = new THREE.Raycaster()
  const pointerNdc = new THREE.Vector2()
  const feltPlane = new THREE.Plane(new THREE.Vector3(0, 1, 0), -TABLE_HEIGHT)
  const feltHit = new THREE.Vector3()

  let pointerDownInfo: { x: number; y: number; pointerId: number } | null = null
  let longPressTimer: ReturnType<typeof setTimeout> | null = null
  let circleHighlighted = false

  function pointerActive(): boolean {
    return mode === 'play' && !queueActive && (session.phase === 'betting' || session.phase === 'result')
  }

  function pointerOnCircle(clientX: number, clientY: number): boolean {
    const rect = canvas.getBoundingClientRect()
    if (rect.width === 0 || rect.height === 0) return false
    pointerNdc.set(((clientX - rect.left) / rect.width) * 2 - 1, -(((clientY - rect.top) / rect.height) * 2 - 1))
    raycaster.setFromCamera(pointerNdc, camera)
    if (!raycaster.ray.intersectPlane(feltPlane, feltHit)) return false
    const dist = Math.hypot(feltHit.x - BET_CIRCLE_X, feltHit.z - BET_CIRCLE_Z)
    return dist <= BET_CIRCLE_RADIUS + 1.5
  }

  function setCircleHighlight(on: boolean): void {
    if (on === circleHighlighted) return
    circleHighlighted = on
    table.setBetCircleHighlight(on)
    canvas.style.cursor = on ? 'pointer' : ''
  }

  function clearLongPressTimer(): void {
    if (longPressTimer !== null) {
      clearTimeout(longPressTimer)
      longPressTimer = null
    }
  }

  function doAddChip(): void {
    runAction(sessionPlaceChip(session, selectedChip), { silent: false })
  }

  function doUndo(): void {
    runAction(sessionUndoChip(session), { silent: false })
  }

  function handlePointerMove(e: PointerEvent): void {
    if (!pointerActive()) {
      setCircleHighlight(false)
      return
    }
    setCircleHighlight(pointerOnCircle(e.clientX, e.clientY))
  }

  function handlePointerDown(e: PointerEvent): void {
    if (!pointerActive() || e.button !== 0) return
    clearLongPressTimer()
    pointerDownInfo = { x: e.clientX, y: e.clientY, pointerId: e.pointerId }
    const { clientX, clientY } = e
    longPressTimer = setTimeout(() => {
      longPressTimer = null
      pointerDownInfo = null
      if (pointerActive() && pointerOnCircle(clientX, clientY)) doUndo()
    }, LONG_PRESS_MS)
  }

  function handlePointerUp(e: PointerEvent): void {
    const info = pointerDownInfo
    if (!info || info.pointerId !== e.pointerId) return
    clearLongPressTimer()
    pointerDownInfo = null
    if (!pointerActive()) return
    const moved = Math.hypot(e.clientX - info.x, e.clientY - info.y)
    if (moved <= TAP_MAX_MOVE_PX && pointerOnCircle(e.clientX, e.clientY)) doAddChip()
  }

  function handlePointerLeave(): void {
    clearLongPressTimer()
    pointerDownInfo = null
    setCircleHighlight(false)
  }

  function handleContextMenu(e: MouseEvent): void {
    e.preventDefault()
    if (!pointerActive()) return
    if (pointerOnCircle(e.clientX, e.clientY)) doUndo()
  }

  canvas.addEventListener('pointermove', handlePointerMove)
  canvas.addEventListener('pointerdown', handlePointerDown)
  canvas.addEventListener('pointerup', handlePointerUp)
  canvas.addEventListener('pointercancel', handlePointerLeave)
  canvas.addEventListener('pointerleave', handlePointerLeave)
  canvas.addEventListener('contextmenu', handleContextMenu)

  // --- Resize --------------------------------------------------------------------------------------

  function handleResize(): void {
    const width = canvas.clientWidth
    const height = canvas.clientHeight
    if (width === 0 || height === 0) return
    renderer.setSize(width, height, false)
    composer.setSize(width, height)
    aspect = width / height
    camera.aspect = aspect
    camera.clearViewOffset()
    camera.updateProjectionMatrix()
    refitAllViews()
    applyViewOffset()
  }

  const resizeObserver = new ResizeObserver(() => handleResize())
  resizeObserver.observe(canvas)
  handleResize()

  // --- Main loop -------------------------------------------------------------------------------------

  let rafId = 0
  let lastFrameTime = 0
  let hasLastFrameTime = false
  let simTime = 0

  let smoothedFrameSeconds = 0
  let slowFrames = 0
  let settleFrames = QUALITY_SETTLE_FRAMES

  function applyQualityStep(): void {
    const step = QUALITY_STEPS[qualityStep]!
    const pixelRatio = Math.min(window.devicePixelRatio, step.pixelRatio)
    renderer.setPixelRatio(pixelRatio)
    composer.setPixelRatio(pixelRatio)
    bloomPass.enabled = step.bloom
    cardSpot.shadow.mapSize.setScalar(Math.min(SHADOW_MAP_SIZE, step.shadowMapSize))
    handleResize()
  }

  function watchFrameRate(frameSeconds: number): void {
    if (qualityPinned || qualityStep >= QUALITY_STEPS.length - 1) return
    if (settleFrames > 0) {
      settleFrames--
      smoothedFrameSeconds = frameSeconds
      return
    }
    smoothedFrameSeconds += (frameSeconds - smoothedFrameSeconds) * 0.1
    slowFrames = smoothedFrameSeconds > SLOW_FRAME_SECONDS ? slowFrames + 1 : 0
    if (slowFrames < SLOW_FRAMES_TO_STEP_DOWN) return
    qualityStep++
    slowFrames = 0
    settleFrames = QUALITY_SETTLE_FRAMES
    applyQualityStep()
  }

  function animate(now: number): void {
    rafId = requestAnimationFrame(animate)
    if (!hasLastFrameTime) {
      hasLastFrameTime = true
      lastFrameTime = now
      return
    }
    const frameSeconds = (now - lastFrameTime) / 1000
    const dt = Math.min(MAX_FRAME_SECONDS, frameSeconds)
    lastFrameTime = now

    const hidden = document.visibilityState === 'hidden'
    const active = !paused && !hidden

    if (active) {
      processQueue(dt)
      stepAttract(dt)
    }
    if (!hidden) watchFrameRate(frameSeconds)

    if (active) simTime += dt
    room.update(simTime)
    table.update(simTime)
    cardView.update(active ? dt : 0, simTime)
    updateCrowdWatch()
    crowd.update(active ? dt : 0, simTime)
    confetti.update(active ? dt : 0)
    updateLampFlash(active ? dt : 0)

    updateCamera(active ? dt : 0)

    composer.render()
  }

  beginAttract()
  rafId = requestAnimationFrame(animate)

  // --- Public API --------------------------------------------------------------------------------

  return {
    startSession(save: SessionSave | null): void {
      beginPlay(save)
    },

    showAttract(): void {
      beginAttract()
    },

    selectChip(value: ChipValue): void {
      selectedChip = value
      emitHud()
    },

    addChip(): void {
      if (mode !== 'play' || queueActive) return
      doAddChip()
    },

    undo(): void {
      if (mode !== 'play' || queueActive) return
      doUndo()
    },

    clearBet(): void {
      if (mode !== 'play' || queueActive) return
      runAction(sessionClearBet(session), { silent: false })
    },

    rebet(): void {
      if (mode !== 'play' || queueActive) return
      runAction(sessionRebet(session), { silent: false })
    },

    doubleBet(): void {
      if (mode !== 'play' || queueActive) return
      runAction(sessionDoubleBet(session), { silent: false })
    },

    deal(): void {
      if (mode !== 'play' || queueActive) return
      runAction(sessionDeal(session), { silent: false, isDeal: true })
    },

    hit(): void {
      if (mode !== 'play' || queueActive) return
      runAction(sessionHit(session), { silent: false })
    },

    stand(): void {
      if (mode !== 'play' || queueActive) return
      runAction(sessionStand(session), { silent: false })
    },

    double(): void {
      if (mode !== 'play' || queueActive) return
      runAction(sessionDouble(session), { silent: false })
    },

    split(): void {
      if (mode !== 'play' || queueActive) return
      runAction(sessionSplit(session), { silent: false })
    },

    insurance(take: boolean): void {
      if (mode !== 'play' || queueActive) return
      runAction(sessionAnswerInsurance(session, take), { silent: false })
      table.setInsuranceChips(session.insurance)
    },

    refill(): void {
      if (mode !== 'play' || queueActive) return
      runAction(sessionRefill(session), { silent: false })
    },

    setCameraView(view: CameraView): void {
      cameraView = view
    },

    setQuickDeal(on: boolean): void {
      quickDeal = on
    },

    setViewInsets(next: ViewInsets): void {
      const clean = (value: number): number => (Number.isFinite(value) && value > 0 ? value : 0)
      insets = { left: clean(next.left), top: clean(next.top), right: clean(next.right), bottom: clean(next.bottom) }
      refitAllViews()
      applyViewOffset()
    },

    setPaused(next: boolean): void {
      paused = next
    },

    resize(): void {
      handleResize()
    },

    dispose(): void {
      cancelAnimationFrame(rafId)
      resizeObserver.disconnect()
      canvas.removeEventListener('pointermove', handlePointerMove)
      canvas.removeEventListener('pointerdown', handlePointerDown)
      canvas.removeEventListener('pointerup', handlePointerUp)
      canvas.removeEventListener('pointercancel', handlePointerLeave)
      canvas.removeEventListener('pointerleave', handlePointerLeave)
      canvas.removeEventListener('contextmenu', handleContextMenu)
      clearLongPressTimer()

      table.dispose()
      cardView.dispose()
      room.dispose()
      crowd.dispose()
      confetti.dispose()

      renderPass.dispose()
      bloomPass.dispose()
      outputPass.dispose()
      composer.dispose()
      environmentTarget.dispose()
      renderer.dispose()
    },
  }
}
