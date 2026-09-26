import { useEffect, useRef, useState } from 'react'
import { createAudio } from './audio.ts'
import type { GameAudio } from './audio.ts'
import type { ChipValue } from './game/types.ts'
import type { CameraView, EngineApi, EngineEvents, HudSnapshot, ViewInsets } from './render/engineApi.ts'
import GameCanvas from './ui/GameCanvas.tsx'
import Hud from './ui/Hud.tsx'
import Menu from './ui/Menu.tsx'
import ResultBanner from './ui/ResultBanner.tsx'
import {
  clearSession,
  loadCamera,
  loadMuted,
  loadQuickDeal,
  loadSession,
  safeLocalStorage,
  saveCamera,
  saveMuted,
  saveQuickDeal,
  saveSession,
} from './ui/storage.ts'

/** The two screens the shell can show. The engine itself always keeps rendering behind them. */
type Mode = 'menu' | 'play'

/** A menu panel narrower than this share of the window is docked to the side, not a bottom sheet. */
const DOCKED_PANEL_MAX_FRACTION = 0.7

/** Pressing the camera button (or the `C` key) steps through these views in order, then wraps. */
const CAMERA_CYCLE: CameraView[] = ['auto', 'seat', 'cards', 'overhead']

/**
 * Top-level app shell. Owns the engine handle, the HUD snapshot, the dealer call-out text,
 * `muted`/`quickDeal`/`cameraView` settings (persisted to `localStorage`), the menu/play mode,
 * and `paused`. The canvas is mounted once, full-screen, behind every screen; `Menu` and `Hud`
 * are just overlays on top of it.
 *
 * The engine's own pointer handling (placing/removing chips on the felt) listens on the canvas
 * directly, so this component only owns the keys documented in `Menu`'s keyboard legend and the
 * buttons in `Hud`/`Menu`.
 */
export default function App() {
  const [storage] = useState(() => safeLocalStorage())
  const [audio] = useState<GameAudio>(() => createAudio())
  const [muted, setMuted] = useState<boolean>(() => loadMuted(storage))
  const [quickDeal, setQuickDeal] = useState<boolean>(() => loadQuickDeal(storage))
  const [cameraView, setCameraView] = useState<CameraView>(() => loadCamera(storage))

  const [mode, setMode] = useState<Mode>('menu')
  const [paused, setPaused] = useState(false)
  const [api, setApi] = useState<EngineApi | null>(null)
  const [hud, setHud] = useState<HudSnapshot | null>(null)
  const [selectedChip, setSelectedChip] = useState<ChipValue>(5)
  const [message, setMessage] = useState<{ id: number; text: string } | null>(null)
  const [savedSession, setSavedSession] = useState(() => loadSession(storage))

  const messageTimerRef = useRef<number | undefined>(undefined)
  const messageIdRef = useRef(0)
  const unlockedAudioRef = useRef(false)
  // Read inside the mode-change effect without making every autosave re-trigger it.
  const savedSessionRef = useRef(savedSession)
  savedSessionRef.current = savedSession
  // Read inside the keydown handler (Space/Enter's deal-or-hit choice) without re-registering the
  // listener on every HUD snapshot.
  const hudRef = useRef<HudSnapshot | null>(null)
  hudRef.current = hud

  useEffect(() => () => window.clearTimeout(messageTimerRef.current), [])
  useEffect(() => () => audio.dispose(), [audio])

  // Put the engine in the right mode whenever it changes: attract behind the menu, the saved (or
  // fresh) session when play starts. Going to the menu returns any chips on the circle to the
  // bankroll, per `EngineApi.showAttract`'s contract, so play always resumes clean.
  useEffect(() => {
    if (!api) return
    if (mode === 'menu') {
      api.showAttract()
    } else {
      api.startSession(savedSessionRef.current)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, api])

  // Apply the persisted settings once the engine is ready; later changes go straight through the
  // toggle handlers below instead of round-tripping through an effect.
  useEffect(() => {
    if (!api) return
    api.setCameraView(cameraView)
    api.setQuickDeal(quickDeal)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [api])

  // Keep the table clear of whichever panel currently covers the canvas: the docked/sheet menu
  // panel, or the HUD's top and bottom bars during play. A ResizeObserver catches content
  // changes (e.g. expanding "How to play") as well as viewport resizes.
  useEffect(() => {
    if (!api) return
    function currentInsets(): ViewInsets {
      const insets: ViewInsets = { left: 0, top: 0, right: 0, bottom: 0 }
      const panel = document.querySelector<HTMLElement>('.menu-panel')
      const topBar = document.querySelector<HTMLElement>('.hud-top-bar')
      const bottomBar = document.querySelector<HTMLElement>('.hud-bottom-bar')
      if (panel) {
        const docked = panel.offsetWidth < window.innerWidth * DOCKED_PANEL_MAX_FRACTION
        if (docked) insets.left = panel.offsetWidth
        else insets.bottom = panel.offsetHeight
      }
      if (topBar) insets.top = topBar.offsetTop + topBar.offsetHeight
      if (bottomBar) {
        // On a short landscape phone the bottom bar becomes a full-height panel on the right.
        const rect = bottomBar.getBoundingClientRect()
        const sidePanel = rect.height > window.innerHeight / 2 && rect.width < window.innerWidth / 2
        if (sidePanel) insets.right = window.innerWidth - rect.left
        else insets.bottom = Math.max(insets.bottom, window.innerHeight - rect.top)
      }
      return insets
    }
    function update() {
      api?.setViewInsets(currentInsets())
    }
    update()
    const observer = new ResizeObserver(update)
    const watched = ['.menu-panel', '.hud-top-bar', '.hud-bottom-bar']
      .map((selector) => document.querySelector<HTMLElement>(selector))
      .filter((el): el is HTMLElement => el !== null)
    watched.forEach((el) => observer.observe(el))
    window.addEventListener('resize', update)
    return () => {
      observer.disconnect()
      window.removeEventListener('resize', update)
    }
    // Bars/panel exist in the DOM as soon as `mode` settles; re-running per `hud` snapshot would
    // tear down and rebuild the observer on every hand update.
  }, [api, mode])

  // Unlock audio on the very first user gesture, as browsers require.
  useEffect(() => {
    function unlock() {
      if (unlockedAudioRef.current) return
      unlockedAudioRef.current = true
      audio.resume()
    }
    window.addEventListener('pointerdown', unlock)
    window.addEventListener('keydown', unlock)
    return () => {
      window.removeEventListener('pointerdown', unlock)
      window.removeEventListener('keydown', unlock)
    }
  }, [audio])

  // Freeze the animations when the tab is hidden; the engine keeps rendering the last frame.
  useEffect(() => {
    function onVisibility() {
      const next = document.hidden
      setPaused(next)
      api?.setPaused(next)
    }
    document.addEventListener('visibilitychange', onVisibility)
    return () => document.removeEventListener('visibilitychange', onVisibility)
  }, [api])

  function handlePlay() {
    setMode('play')
  }

  function handleOpenMenu() {
    setMode('menu')
  }

  function handleCycleCamera() {
    setCameraView((current) => {
      const next = CAMERA_CYCLE[(CAMERA_CYCLE.indexOf(current) + 1) % CAMERA_CYCLE.length]!
      api?.setCameraView(next)
      saveCamera(storage, next)
      return next
    })
  }

  function handleToggleQuickDeal() {
    setQuickDeal((current) => {
      const next = !current
      api?.setQuickDeal(next)
      saveQuickDeal(storage, next)
      return next
    })
  }

  function handleToggleMute() {
    setMuted((current) => {
      const next = !current
      audio.setMuted(next)
      saveMuted(storage, next)
      return next
    })
  }

  function handleSelectChip(value: ChipValue) {
    setSelectedChip(value)
    api?.selectChip(value)
  }

  function handleResetCredits() {
    clearSession(storage)
    savedSessionRef.current = null
    setSavedSession(null)
    if (mode === 'play') api?.startSession(null)
  }

  function handleDealAgain() {
    // `rebet` is synchronous (it replaces the session immediately), so `deal` can follow at once.
    api?.rebet()
    api?.deal()
  }

  // Menu: Enter/Space starts play. Play: the keys in `Menu`'s keyboard legend. Every other key
  // (and all pointer input) belongs to the engine itself.
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      const target = e.target
      if (target instanceof HTMLElement && ['INPUT', 'TEXTAREA', 'SELECT'].includes(target.tagName)) return
      if (paused) return
      if (mode === 'menu') {
        if ((e.key === 'Enter' || e.key === ' ') && !e.repeat) {
          e.preventDefault()
          handlePlay()
        }
        return
      }
      if (e.repeat) return
      switch (e.key) {
        case ' ':
        case 'Enter':
          e.preventDefault()
          if (hudRef.current?.can.deal) api?.deal()
          else api?.hit()
          break
        case 'h':
        case 'H':
          api?.hit()
          break
        case 's':
        case 'S':
          api?.stand()
          break
        case 'd':
        case 'D':
          api?.double()
          break
        case 'p':
        case 'P':
          api?.split()
          break
        case '1':
          handleSelectChip(1)
          break
        case '2':
          handleSelectChip(5)
          break
        case '3':
          handleSelectChip(25)
          break
        case '4':
          handleSelectChip(100)
          break
        case '5':
          handleSelectChip(500)
          break
        case 'a':
        case 'A':
          api?.addChip()
          break
        case 'z':
        case 'Z':
        case 'Backspace':
          api?.undo()
          break
        case 'x':
        case 'X':
        case 'Delete':
          api?.clearBet()
          break
        case 'r':
        case 'R':
          api?.rebet()
          break
        case 'b':
        case 'B':
          api?.doubleBet()
          break
        case 'y':
        case 'Y':
          api?.insurance(true)
          break
        case 'n':
        case 'N':
          api?.insurance(false)
          break
        case 'c':
        case 'C':
          handleCycleCamera()
          break
        case 'q':
        case 'Q':
          handleToggleQuickDeal()
          break
        case 'm':
        case 'M':
          handleToggleMute()
          break
        case 'Escape':
          handleOpenMenu()
          break
        default:
          break
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mode, api, paused])

  const events: EngineEvents = {
    onHud: (snapshot) => setHud(snapshot),
    onSound: (name, intensity) => audio.play(name, intensity),
    onMessage: (text, seconds) => {
      messageIdRef.current += 1
      const id = messageIdRef.current
      setMessage({ id, text })
      window.clearTimeout(messageTimerRef.current)
      messageTimerRef.current = window.setTimeout(() => {
        setMessage((current) => (current && current.id === id ? null : current))
      }, seconds * 1000)
    },
    onSave: (save) => {
      saveSession(storage, save)
      savedSessionRef.current = save
      setSavedSession(save)
    },
  }

  return (
    <div className="app-root">
      <GameCanvas events={events} onReady={setApi} />

      <div className="overlay-layer">
        {mode === 'menu' && (
          <Menu
            hasSave={savedSession !== null}
            savedBankroll={savedSession?.bankroll ?? 0}
            muted={muted}
            quickDeal={quickDeal}
            cameraView={cameraView}
            onPlay={handlePlay}
            onToggleMute={handleToggleMute}
            onToggleQuickDeal={handleToggleQuickDeal}
            onCycleCamera={handleCycleCamera}
            onResetCredits={handleResetCredits}
          />
        )}

        {mode === 'play' && (
          <>
            <Hud
              hud={hud}
              selectedChip={selectedChip}
              cameraView={cameraView}
              quickDeal={quickDeal}
              muted={muted}
              onSelectChip={handleSelectChip}
              onDeal={() => api?.deal()}
              onHit={() => api?.hit()}
              onStand={() => api?.stand()}
              onDouble={() => api?.double()}
              onSplit={() => api?.split()}
              onInsurance={(take) => api?.insurance(take)}
              onUndo={() => api?.undo()}
              onClear={() => api?.clearBet()}
              onRebet={() => api?.rebet()}
              onDoubleBet={() => api?.doubleBet()}
              onDealAgain={handleDealAgain}
              onNewBet={() => api?.clearBet()}
              onRefill={() => api?.refill()}
              onCycleCamera={handleCycleCamera}
              onToggleQuickDeal={handleToggleQuickDeal}
              onToggleMute={handleToggleMute}
              onOpenMenu={handleOpenMenu}
            />
            <ResultBanner hud={hud} message={message?.text ?? null} />
          </>
        )}
      </div>
    </div>
  )
}
