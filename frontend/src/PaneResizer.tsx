import { useRef, type KeyboardEvent, type PointerEvent } from 'react'

/**
 * 두 칸 사이의 세로 손잡이. 끌거나 ←→ 키로 왼쪽 칸의 넓이를 바꿔요.
 * Home/End는 가장 좁게/넓게, 두 번 누르면(더블클릭) 처음 넓이로 돌아가요.
 */
export default function PaneResizer({ className, label, width, min, max, initial, onChange }: {
  className: string
  label: string
  width: number
  min: number
  max: number
  initial: number
  onChange: (width: number) => void
}) {
  const start = useRef<{ x: number; width: number } | null>(null)
  const clamp = (w: number) => Math.round(Math.min(max, Math.max(min, w)))

  function onPointerDown(e: PointerEvent<HTMLDivElement>) {
    e.preventDefault()
    e.currentTarget.setPointerCapture(e.pointerId)
    start.current = { x: e.clientX, width }
  }

  function onPointerMove(e: PointerEvent<HTMLDivElement>) {
    if (start.current) onChange(clamp(start.current.width + e.clientX - start.current.x))
  }

  function onKeyDown(e: KeyboardEvent<HTMLDivElement>) {
    const step = e.shiftKey ? 64 : 16
    const next = { ArrowLeft: width - step, ArrowRight: width + step, Home: min, End: max }[e.key]
    if (next === undefined) return
    e.preventDefault()
    onChange(clamp(next))
  }

  return (
    <div
      className={`resizer ${className}`}
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      aria-valuemin={min}
      aria-valuemax={max}
      aria-valuenow={width}
      tabIndex={0}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={() => { start.current = null }}
      onPointerCancel={() => { start.current = null }}
      onDoubleClick={() => onChange(initial)}
      onKeyDown={onKeyDown}
    />
  )
}
