"use client"

import { useEffect, useMemo, useRef, useState } from "react"
import { APP_REGISTRY } from "@/lib/appRegistry"
import P5Background from "@/components/P5Background"

type WindowItem = {
  id: string
  appId: string
  title: string
  source: string
  x: number
  y: number
  width: number
  height: number
  color: string
  vx: number
  vy: number
  driftEnergy: number
  zIndex: number
}

type DragState = {
  type: "drag" | "resize"
  windowId: string
  startPointerX: number
  startPointerY: number
  startX: number
  startY: number
  startWidth: number
}

const MIN_SIZE = 16
const MAX_INITIAL_FACES = 4
const RED_BORDER_OUTSET_RATIO = 0.05
const MIN_SQUARE_SIZE = 100
const MAX_SQUARE_SIZE = 200
const CENTER_PANEL_STICK_RANGE = 56
const CENTER_PANEL_STICK_PULL = 0.006
const CENTER_PANEL_MAX_DAMPING = 0.9
const PANEL_SURFACE_SNAP_DISTANCE = 2
const DRIFT_ACCEL = 0.02
const DRIFT_EASE_DECAY = 0.996
const DRIFT_MIN_ENERGY = 0.08
const DRIFT_BASE_DAMPING = 0.985
const DRIFT_SPEED_FRICTION = 0.02
const DRIFT_MIN_DAMPING = 0.94
const MAX_DRIFT_SPEED = 1.4
const SPAWN_RATIO_PERCENT = clamp(
  Number(process.env.NEXT_PUBLIC_SPAWN_RATIO_PERCENT ?? "100"),
  1,
  100
)

function makeWindowId() {
  return `w-${Math.random().toString(36).slice(2, 9)}`
}

function clamp(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

function pickSquareColor() {
  return "rgb(255, 255, 255)"
}

function randomSquareSize(stageWidth: number, stageHeight: number) {
  const viewportCap = Math.max(MIN_SIZE, Math.floor(Math.min(stageWidth, stageHeight) * 0.28))
  const maxSize = clamp(viewportCap, MIN_SIZE, MAX_SQUARE_SIZE)
  const minSize = Math.min(MIN_SQUARE_SIZE, maxSize)
  return Math.floor(Math.random() * (maxSize - minSize + 1)) + minSize
}

function hashToPhase(input: string) {
  let hash = 2166136261
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return ((hash >>> 0) % 360) * (Math.PI / 180)
}

function randomCanvasPosition(stageWidth: number, stageHeight: number, size: number) {
  const maxX = Math.max(0, stageWidth - size)
  const maxY = Math.max(0, stageHeight - size)
  return {
    x: Math.round(Math.random() * maxX),
    y: Math.round(Math.random() * maxY)
  }
}

function nearestPointOnRectBoundary(px: number, py: number, left: number, top: number, right: number, bottom: number) {
  const clampedX = clamp(px, left, right)
  const clampedY = clamp(py, top, bottom)
  const inside = px >= left && px <= right && py >= top && py <= bottom

  if (!inside) {
    return { x: clampedX, y: clampedY }
  }

  const toLeft = Math.abs(px - left)
  const toRight = Math.abs(right - px)
  const toTop = Math.abs(py - top)
  const toBottom = Math.abs(bottom - py)
  const edge = Math.min(toLeft, toRight, toTop, toBottom)

  if (edge === toLeft) return { x: left, y: py }
  if (edge === toRight) return { x: right, y: py }
  if (edge === toTop) return { x: px, y: top }
  return { x: px, y: bottom }
}

function resolveRedBoundsPanelCollision(
  x: number,
  y: number,
  width: number,
  height: number,
  panelLeft: number,
  panelTop: number,
  panelRight: number,
  panelBottom: number
) {
  const insetX = width * RED_BORDER_OUTSET_RATIO
  const insetY = height * RED_BORDER_OUTSET_RATIO
  const redLeft = x - insetX
  const redTop = y - insetY
  const redRight = x + width + insetX
  const redBottom = y + height + insetY

  const overlaps = redLeft < panelRight && redRight > panelLeft && redTop < panelBottom && redBottom > panelTop
  if (!overlaps) {
    return { x, y, hitX: false, hitY: false }
  }

  const pushLeft = redRight - panelLeft
  const pushRight = panelRight - redLeft
  const pushUp = redBottom - panelTop
  const pushDown = panelBottom - redTop
  const minPush = Math.min(pushLeft, pushRight, pushUp, pushDown)

  if (minPush === pushLeft) return { x: x - pushLeft, y, hitX: true, hitY: false }
  if (minPush === pushRight) return { x: x + pushRight, y, hitX: true, hitY: false }
  if (minPush === pushUp) return { x, y: y - pushUp, hitX: false, hitY: true }
  return { x, y: y + pushDown, hitX: false, hitY: true }
}

function lockToPanelSurface(
  x: number,
  y: number,
  width: number,
  height: number,
  panelLeft: number,
  panelTop: number,
  panelRight: number,
  panelBottom: number
) {
  const insetX = width * RED_BORDER_OUTSET_RATIO
  const insetY = height * RED_BORDER_OUTSET_RATIO
  const redLeft = x - insetX
  const redTop = y - insetY
  const redRight = x + width + insetX
  const redBottom = y + height + insetY
  const overlapsY = redBottom > panelTop && redTop < panelBottom
  const overlapsX = redRight > panelLeft && redLeft < panelRight

  if (overlapsY && Math.abs(redRight - panelLeft) <= PANEL_SURFACE_SNAP_DISTANCE) {
    return { x: panelLeft - width - insetX, y, lockX: true, lockY: false }
  }
  if (overlapsY && Math.abs(redLeft - panelRight) <= PANEL_SURFACE_SNAP_DISTANCE) {
    return { x: panelRight + insetX, y, lockX: true, lockY: false }
  }
  if (overlapsX && Math.abs(redBottom - panelTop) <= PANEL_SURFACE_SNAP_DISTANCE) {
    return { x, y: panelTop - height - insetY, lockX: false, lockY: true }
  }
  if (overlapsX && Math.abs(redTop - panelBottom) <= PANEL_SURFACE_SNAP_DISTANCE) {
    return { x, y: panelBottom + insetY, lockX: false, lockY: true }
  }

  return { x, y, lockX: false, lockY: false }
}

function getSquarePanelBounds(stageWidth: number, stageHeight: number) {
  const panelSize = Math.min(420, stageWidth * 0.42, stageHeight * 0.42)
  const panelLeftRaw = (stageWidth - panelSize) * 0.5
  const panelTopRaw = (stageHeight - panelSize) * 0.5
  const panelOutset = panelSize * RED_BORDER_OUTSET_RATIO

  return {
    panelLeft: panelLeftRaw - panelOutset,
    panelTop: panelTopRaw - panelOutset,
    panelRight: panelLeftRaw + panelSize + panelOutset,
    panelBottom: panelTopRaw + panelSize + panelOutset
  }
}

function anchoredSpawnPosition(
  side: "top" | "right" | "bottom" | "left",
  size: number,
  stageWidth: number,
  stageHeight: number,
  panelLeft: number,
  panelTop: number,
  panelRight: number,
  panelBottom: number
) {
  const inset = size * RED_BORDER_OUTSET_RATIO
  const centeredX = (panelLeft + panelRight) * 0.5 - size * 0.5
  const centeredY = (panelTop + panelBottom) * 0.5 - size * 0.5

  if (side === "top") {
    return {
      x: clamp(centeredX, 0, Math.max(0, stageWidth - size)),
      y: clamp(panelTop - size - inset, 0, Math.max(0, stageHeight - size))
    }
  }

  if (side === "right") {
    return {
      x: clamp(panelRight + inset, 0, Math.max(0, stageWidth - size)),
      y: clamp(centeredY, 0, Math.max(0, stageHeight - size))
    }
  }

  if (side === "bottom") {
    return {
      x: clamp(centeredX, 0, Math.max(0, stageWidth - size)),
      y: clamp(panelBottom + inset, 0, Math.max(0, stageHeight - size))
    }
  }

  return {
    x: clamp(panelLeft - size - inset, 0, Math.max(0, stageWidth - size)),
    y: clamp(centeredY, 0, Math.max(0, stageHeight - size))
  }
}

function anchoredSpawnVelocity(side: "top" | "right" | "bottom" | "left") {
  const drift = (Math.random() - 0.5) * 0.5
  const settle = (Math.random() - 0.5) * 0.1

  if (side === "top" || side === "bottom") {
    return { vx: drift, vy: settle }
  }

  return { vx: settle, vy: drift }
}

export default function DesktopShell() {
  const stageRef = useRef<HTMLDivElement>(null)
  const nextZRef = useRef(1)
  const bootedRef = useRef(false)
  const interactionRef = useRef<DragState | null>(null)

  const [stageSize, setStageSize] = useState({ width: 1280, height: 720 })
  const [windows, setWindows] = useState<WindowItem[]>([])
  const [hoveredId, setHoveredId] = useState<string | null>(null)
  const [selectedId, setSelectedId] = useState<string | null>(null)

  function spawnBatchCount(base: number) {
    return Math.max(1, Math.round(base * (SPAWN_RATIO_PERCENT / 100)))
  }

  function buildWindow(index: number, color: string = "rgb(255, 255, 255)"): WindowItem {
    const app = APP_REGISTRY[index % APP_REGISTRY.length]
    const title = app.id.toLowerCase()
    const size = randomSquareSize(stageSize.width, stageSize.height)
    const point = randomCanvasPosition(stageSize.width, stageSize.height, size)

    return {
      id: makeWindowId(),
      appId: title,
      title,
      source: app.source,
      x: point.x,
      y: point.y,
      width: size,
      height: size,
      color,
      vx: (Math.random() - 0.5) * 0.6,
      vy: (Math.random() - 0.5) * 0.6,
      driftEnergy: 1,
      zIndex: 1
    }
  }

  useEffect(() => {
    function syncSize() {
      const el = stageRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      setStageSize({ width: Math.floor(rect.width), height: Math.floor(rect.height) })
    }

    syncSize()
    window.addEventListener("resize", syncSize)
    return () => window.removeEventListener("resize", syncSize)
  }, [])

  useEffect(() => {
    let raf = 0

    const tick = () => {
      const t = performance.now() * 0.001
      setWindows((prev) => {
        if (prev.length === 0) return prev

        const activeId = interactionRef.current?.windowId ?? null
        const next = prev.map((w) => ({ ...w }))
        const { panelLeft, panelTop, panelRight, panelBottom } = getSquarePanelBounds(stageSize.width, stageSize.height)

        for (let i = 0; i < next.length; i += 1) {
          const a = next[i]
          const aActive = a.id === activeId

          for (let j = i + 1; j < next.length; j += 1) {
            const b = next[j]
            const bActive = b.id === activeId
            const acx = a.x + a.width / 2
            const acy = a.y + a.height / 2
            const bcx = b.x + b.width / 2
            const bcy = b.y + b.height / 2
            const dx = bcx - acx
            const dy = bcy - acy
            const dist = Math.max(1, Math.hypot(dx, dy))
            const redAWidth = a.width * (1 + RED_BORDER_OUTSET_RATIO * 2)
            const redBWidth = b.width * (1 + RED_BORDER_OUTSET_RATIO * 2)
            const minGap = (redAWidth + redBWidth) / 2

            if (dist < minGap) {
              const repel = (minGap - dist) * 0.015
              const ux = dx / dist
              const uy = dy / dist
              if (!aActive) {
                a.vx -= ux * repel
                a.vy -= uy * repel
              }
              if (!bActive) {
                b.vx += ux * repel
                b.vy += uy * repel
              }
            } else {
              const attract = Math.min(0.02, (dist - minGap) * 0.0003)
              const ux = dx / dist
              const uy = dy / dist
              if (!aActive) {
                a.vx += ux * attract
                a.vy += uy * attract
              }
              if (!bActive) {
                b.vx -= ux * attract
                b.vy -= uy * attract
              }
            }

            if (!aActive && !bActive && dist < 190) {
              const cell = Math.max(40, Math.round((a.width + b.width) * 0.25))
              if (Math.abs(dx) >= Math.abs(dy)) {
                const snapX = acx + Math.sign(dx || 1) * cell
                b.vx += (snapX - bcx) * 0.0045
                b.vy += (acy - bcy) * 0.0045
              } else {
                const snapY = acy + Math.sign(dy || 1) * cell
                b.vx += (acx - bcx) * 0.0045
                b.vy += (snapY - bcy) * 0.0045
              }
            }

            // Keep pair overlap under 50% of the smaller square size.
            const aOutsetX = a.width * RED_BORDER_OUTSET_RATIO
            const aOutsetY = a.height * RED_BORDER_OUTSET_RATIO
            const bOutsetX = b.width * RED_BORDER_OUTSET_RATIO
            const bOutsetY = b.height * RED_BORDER_OUTSET_RATIO
            const ax1 = a.x - aOutsetX
            const ay1 = a.y - aOutsetY
            const ax2 = a.x + a.width + aOutsetX
            const ay2 = a.y + a.height + aOutsetY
            const bx1 = b.x - bOutsetX
            const by1 = b.y - bOutsetY
            const bx2 = b.x + b.width + bOutsetX
            const by2 = b.y + b.height + bOutsetY
            const overlapX = Math.min(ax2, bx2) - Math.max(ax1, bx1)
            const overlapY = Math.min(ay2, by2) - Math.max(ay1, by1)

            if (overlapX > 0 && overlapY > 0) {
              const allowedX = Math.min(ax2 - ax1, bx2 - bx1) * 0.5
              const allowedY = Math.min(ay2 - ay1, by2 - by1) * 0.5
              const excessX = overlapX - allowedX
              const excessY = overlapY - allowedY

              if (excessX > 0 || excessY > 0) {
                const separateX = excessX >= excessY
                if (separateX) {
                  const shift = Math.max(0, excessX) + 0.5
                  const dirA = acx <= bcx ? -1 : 1
                  if (aActive && !bActive) {
                    b.x -= dirA * shift
                  } else if (!aActive && bActive) {
                    a.x += dirA * shift
                  } else {
                    a.x += dirA * (shift * 0.5)
                    b.x -= dirA * (shift * 0.5)
                  }
                } else {
                  const shift = Math.max(0, excessY) + 0.5
                  const dirA = acy <= bcy ? -1 : 1
                  if (aActive && !bActive) {
                    b.y -= dirA * shift
                  } else if (!aActive && bActive) {
                    a.y += dirA * shift
                  } else {
                    a.y += dirA * (shift * 0.5)
                    b.y -= dirA * (shift * 0.5)
                  }
                }
              }
            }
          }
        }

        for (const w of next) {
          if (w.id === activeId) continue

          const cx = w.x + w.width / 2
          const cy = w.y + w.height / 2
          const p = hashToPhase(w.id)
          const driftAngle = p + t * 0.35
          w.driftEnergy = Math.max(DRIFT_MIN_ENERGY, w.driftEnergy * DRIFT_EASE_DECAY)
          w.vx += Math.cos(driftAngle) * DRIFT_ACCEL * w.driftEnergy
          w.vy += Math.sin(driftAngle) * DRIFT_ACCEL * w.driftEnergy

          const nearest = nearestPointOnRectBoundary(cx, cy, panelLeft, panelTop, panelRight, panelBottom)
          const panelDx = nearest.x - cx
          const panelDy = nearest.y - cy
          const panelDist = Math.hypot(panelDx, panelDy)

          if (panelDist < CENTER_PANEL_STICK_RANGE) {
            const stick = 1 - panelDist / CENTER_PANEL_STICK_RANGE
            w.vx += panelDx * CENTER_PANEL_STICK_PULL * stick
            w.vy += panelDy * CENTER_PANEL_STICK_PULL * stick
            const damping = 0.91 - (0.91 - CENTER_PANEL_MAX_DAMPING) * stick
            w.vx *= damping
            w.vy *= damping
          }
          const speed = Math.hypot(w.vx, w.vy)
          const frictionDamping = clamp(
            DRIFT_BASE_DAMPING - speed * DRIFT_SPEED_FRICTION,
            DRIFT_MIN_DAMPING,
            DRIFT_BASE_DAMPING
          )
          w.vx *= frictionDamping
          w.vy *= frictionDamping
          w.vx = clamp(w.vx, -MAX_DRIFT_SPEED, MAX_DRIFT_SPEED)
          w.vy = clamp(w.vy, -MAX_DRIFT_SPEED, MAX_DRIFT_SPEED)

          const nextX = clamp(w.x + w.vx, 0, Math.max(0, stageSize.width - w.width))
          const nextY = clamp(w.y + w.vy, 0, Math.max(0, stageSize.height - w.height))
          const resolved = resolveRedBoundsPanelCollision(
            nextX,
            nextY,
            w.width,
            w.height,
            panelLeft,
            panelTop,
            panelRight,
            panelBottom
          )

          w.x = clamp(resolved.x, 0, Math.max(0, stageSize.width - w.width))
          w.y = clamp(resolved.y, 0, Math.max(0, stageSize.height - w.height))
          if (resolved.hitX) w.vx = 0
          if (resolved.hitY) w.vy = 0

          const locked = lockToPanelSurface(w.x, w.y, w.width, w.height, panelLeft, panelTop, panelRight, panelBottom)
          w.x = clamp(locked.x, 0, Math.max(0, stageSize.width - w.width))
          w.y = clamp(locked.y, 0, Math.max(0, stageSize.height - w.height))
          if (locked.lockX) w.vx = 0
          if (locked.lockY) w.vy = 0
        }

        return next
      })

      raf = window.requestAnimationFrame(tick)
    }

    raf = window.requestAnimationFrame(tick)
    return () => window.cancelAnimationFrame(raf)
  }, [stageSize.width, stageSize.height])

  function seedInitialFour() {
    const count = Math.min(spawnBatchCount(MAX_INITIAL_FACES), APP_REGISTRY.length)
    if (count === 0) return

    const sides: Array<"top" | "right" | "bottom" | "left"> = ["top", "right", "bottom", "left"]
    const panel = getSquarePanelBounds(stageSize.width, stageSize.height)
    const seeded: WindowItem[] = []
    for (let i = 0; i < count; i += 1) {
      const seededWindow = buildWindow(i, pickSquareColor())
      const side = sides[i % sides.length]
      const point = anchoredSpawnPosition(
        side,
        seededWindow.width,
        stageSize.width,
        stageSize.height,
        panel.panelLeft,
        panel.panelTop,
        panel.panelRight,
        panel.panelBottom
      )
      const velocity = anchoredSpawnVelocity(side)
      seeded.push({
        ...seededWindow,
        x: point.x,
        y: point.y,
        vx: velocity.vx,
        vy: velocity.vy,
        zIndex: i + 1
      })
    }

    nextZRef.current = count + 1
    setWindows(seeded)
    setSelectedId(seeded[0]?.id ?? null)
  }

  useEffect(() => {
    if (bootedRef.current) return
    bootedRef.current = true
    seedInitialFour()
  }, [stageSize.width, stageSize.height])

  function focusWindow(windowId: string) {
    const z = nextZRef.current + 1
    nextZRef.current = z
    setWindows((prev) => prev.map((w) => (w.id === windowId ? { ...w, zIndex: z } : w)))
  }

  function beginInteraction(event: React.PointerEvent, windowItem: WindowItem, type: "drag" | "resize") {
    event.preventDefault()
    event.stopPropagation()

    focusWindow(windowItem.id)
    setSelectedId(windowItem.id)
    interactionRef.current = {
      type,
      windowId: windowItem.id,
      startPointerX: event.clientX,
      startPointerY: event.clientY,
      startX: windowItem.x,
      startY: windowItem.y,
      startWidth: windowItem.width
    }

    setWindows((prev) => prev.map((w) => (w.id === windowItem.id ? { ...w, vx: 0, vy: 0 } : w)))

    window.addEventListener("pointermove", onPointerMove)
    window.addEventListener("pointerup", endInteraction)
  }

  function onPointerMove(event: PointerEvent) {
    const active = interactionRef.current
    if (!active) return

    const deltaX = event.clientX - active.startPointerX
    const deltaY = event.clientY - active.startPointerY

    setWindows((prev) =>
      prev.map((w) => {
        if (w.id !== active.windowId) return w

        if (active.type === "drag") {
          const { panelLeft, panelTop, panelRight, panelBottom } = getSquarePanelBounds(stageSize.width, stageSize.height)
          const nextX = clamp(active.startX + deltaX, 0, Math.max(0, stageSize.width - w.width))
          const nextY = clamp(active.startY + deltaY, 0, Math.max(0, stageSize.height - w.height))
          const resolved = resolveRedBoundsPanelCollision(
            nextX,
            nextY,
            w.width,
            w.height,
            panelLeft,
            panelTop,
            panelRight,
            panelBottom
          )

          return {
            ...w,
            x: clamp(resolved.x, 0, Math.max(0, stageSize.width - w.width)),
            y: clamp(resolved.y, 0, Math.max(0, stageSize.height - w.height)),
            vx: 0,
            vy: 0
          }
        }

        const delta = Math.max(deltaX, deltaY)
        const nextSize = clamp(active.startWidth + delta, MIN_SIZE, Math.min(stageSize.width, stageSize.height))
        return {
          ...w,
          width: nextSize,
          height: nextSize,
          vx: 0,
          vy: 0
        }
      })
    )
  }

  function endInteraction() {
    interactionRef.current = null
    window.removeEventListener("pointermove", onPointerMove)
    window.removeEventListener("pointerup", endInteraction)
  }

  const sortedWindows = useMemo(() => [...windows].sort((a, b) => a.zIndex - b.zIndex), [windows])
  const selectedWindow = useMemo(() => windows.find((w) => w.id === selectedId) ?? null, [selectedId, windows])

  return (
    <main className="desktop-shell">
      <section
        ref={stageRef}
        className="stage"
        aria-label="Window stage"
      >
        <P5Background />
        {sortedWindows.map((windowItem) => {
          const highlighted = hoveredId === windowItem.id || selectedId === windowItem.id
          return (
            <article
              key={windowItem.id}
              className={`window${selectedId === windowItem.id ? " is-selected" : ""}`}
              style={{
                left: `${windowItem.x}px`,
                top: `${windowItem.y}px`,
                width: `${windowItem.width}px`,
                height: `${windowItem.height}px`,
                zIndex: windowItem.zIndex,
                background: selectedId === windowItem.id ? "#000" : windowItem.color
              }}
              onPointerEnter={() => setHoveredId(windowItem.id)}
              onPointerLeave={() => setHoveredId((current) => (current === windowItem.id ? null : current))}
              onPointerDown={() => {
                focusWindow(windowItem.id)
                setSelectedId(windowItem.id)
              }}
            >
              <div
                className="content"
                onPointerDown={(event) => {
                  const target = event.target as HTMLElement
                  if (target.dataset.dragzone === "1") {
                    beginInteraction(event, windowItem, "drag")
                  }
                }}
              >
                <div className="drag-zone" data-dragzone="1" />
                <span className="face-id">{windowItem.appId}</span>
                <button
                  type="button"
                  className="resize"
                  aria-label="Resize window"
                  onPointerDown={(event) => beginInteraction(event, windowItem, "resize")}
                />
              </div>
            </article>
          )
        })}

        {selectedWindow ? (
          <aside className="repo-panel" aria-label="Selected face preview">
            <iframe title={`${selectedWindow.title} preview`} src={selectedWindow.source} loading="lazy" />
          </aside>
        ) : null}
      </section>
    </main>
  )
}
