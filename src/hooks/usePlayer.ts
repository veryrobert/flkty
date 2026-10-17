import { useCallback, useEffect, useRef, useState, type RefObject } from 'react'
import { drawCover, drawTransition, type Frame } from '@/lib/frames'
import { transitionSeconds, type Transition } from '@/lib/output'

type Options = {
  canvas: RefObject<HTMLCanvasElement | null>
  frames: Frame[]
  size: { width: number; height: number }
  duration: number
  transition: Transition
}

// Draws the current frame to the canvas and steps through frames while playing,
// drawing the chosen transition between them.
export function usePlayer({ canvas, frames, size, duration, transition }: Options) {
  const [playing, setPlaying] = useState(false)
  const [index, setIndex] = useState(0)
  const indexRef = useRef(0)

  const paint = useCallback(
    (from: number, to = from, t = 1) => {
      const c = canvas.current
      if (!c || frames.length === 0) return
      if (c.width !== size.width || c.height !== size.height) {
        c.width = size.width
        c.height = size.height
      }
      const ctx = c.getContext('2d')!
      ctx.fillStyle = '#000'
      ctx.fillRect(0, 0, c.width, c.height)
      const a = frames[from % frames.length]
      const b = frames[to % frames.length]
      if (t < 1 && a && b && transition !== 'none') drawTransition(ctx, a.el, b.el, c.width, c.height, t, transition)
      else if (b) drawCover(ctx, b.el, c.width, c.height)
    },
    [canvas, frames, size.width, size.height, transition],
  )

  const goTo = useCallback((i: number) => {
    indexRef.current = i
    setIndex(i)
  }, [])

  // Keep the index valid when frames are removed.
  useEffect(() => {
    if (index >= frames.length) goTo(Math.max(0, frames.length - 1))
    if (frames.length === 0) setPlaying(false)
  }, [frames.length, index, goTo])

  useEffect(() => {
    if (!playing) paint(index)
  }, [playing, index, paint])

  useEffect(() => {
    if (!playing || frames.length === 0) return
    const hold = duration * 1000
    const blendMs = transition !== 'none' && frames.length > 1 ? transitionSeconds(duration) * 1000 : 0
    let start = performance.now()
    let raf = 0
    const tick = (now: number) => {
      const elapsed = now - start
      const from = indexRef.current
      const to = (from + 1) % frames.length
      if (elapsed >= hold) {
        start = now
        goTo(to)
        paint(to)
      } else if (blendMs && elapsed >= hold - blendMs) {
        paint(from, to, (elapsed - (hold - blendMs)) / blendMs)
      }
      raf = requestAnimationFrame(tick)
    }
    paint(indexRef.current)
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [playing, frames.length, duration, transition, paint, goTo])

  return { playing, setPlaying, index, goTo }
}
