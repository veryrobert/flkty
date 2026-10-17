import type { Frame } from './frames'

export const RATIOS = {
  original: null,
  '16:9': { width: 1920, height: 1080 },
  '1:1': { width: 1080, height: 1080 },
  '9:16': { width: 1080, height: 1920 },
} as const

export type Ratio = keyof typeof RATIOS
export type Format = 'mp4' | 'gif'

// Each maps to an ffmpeg xfade transition; the preview draws the same thing.
export const TRANSITIONS = {
  none: null,
  fade: 'fade',
  slide: 'slideleft',
  wipe: 'wipeleft',
  circle: 'circleopen',
} as const

export type Transition = keyof typeof TRANSITIONS

export type Settings = {
  duration: number // seconds per frame
  transition: Transition
  ratio: Ratio
  cropWidth: number | null
  cropHeight: number | null
  format: Format
}

const MAX_DIM = 1920

// Output size: a fixed ratio, a custom crop, or the first frame scaled to fit 1920.
export function outputSize(frames: Frame[], s: Settings) {
  const fixed = RATIOS[s.ratio]
  if (fixed) return { ...fixed }
  if (s.cropWidth && s.cropHeight) return { width: s.cropWidth, height: s.cropHeight }
  const first = frames[0]
  if (!first?.width) return { width: 1920, height: 1080 }
  const scale = Math.min(1, MAX_DIM / Math.max(first.width, first.height))
  return { width: Math.round(first.width * scale), height: Math.round(first.height * scale) }
}

// Transition length: 30% of the frame, at most half a second.
export const transitionSeconds = (duration: number) => Math.min(duration * 0.3, 0.5)
