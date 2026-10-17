import { FFmpeg } from '@ffmpeg/ffmpeg'
import { fetchFile, toBlobURL } from '@ffmpeg/util'
import type { Frame } from './frames'
import { outputSize, transitionSeconds, TRANSITIONS, type Settings } from './output'

const CORE = 'https://unpkg.com/@ffmpeg/core@0.12.10/dist/esm'

let instance: Promise<FFmpeg> | null = null

// Load the single-threaded core once. It doesn't need SharedArrayBuffer,
// so it works on GitHub Pages without COOP/COEP headers.
export function loadFFmpeg() {
  instance ??= (async () => {
    const ffmpeg = new FFmpeg()
    await ffmpeg.load({
      coreURL: await toBlobURL(`${CORE}/ffmpeg-core.js`, 'text/javascript'),
      wasmURL: await toBlobURL(`${CORE}/ffmpeg-core.wasm`, 'application/wasm'),
    })
    return ffmpeg
  })().catch(e => {
    instance = null
    throw e
  })
  return instance
}

const inputName = (i: number) => `in${String(i).padStart(3, '0')}.png`

function toPng(frame: Frame): Promise<Blob> {
  const c = document.createElement('canvas')
  c.width = frame.el.naturalWidth
  c.height = frame.el.naturalHeight
  c.getContext('2d')!.drawImage(frame.el, 0, 0)
  return new Promise((resolve, reject) => c.toBlob(b => (b ? resolve(b) : reject(new Error('PNG conversion failed'))), 'image/png'))
}

async function run(ffmpeg: FFmpeg, args: string[], step: string) {
  const code = await ffmpeg.exec(args)
  if (code !== 0) throw new Error(`${step} failed`)
}

export async function encode(frames: Frame[], s: Settings, onStatus: (status: string) => void): Promise<Blob> {
  onStatus('Loading')
  const ffmpeg = await loadFFmpeg()

  let { width, height } = outputSize(frames, s)
  // libx264 with yuv420p needs even dimensions; keep GIF the same for parity.
  width -= width % 2
  height -= height % 2
  const fit = `scale=${width}:${height}:force_original_aspect_ratio=increase,crop=${width}:${height},setsar=1`
  // Enough frames per second that very short holds aren't dropped.
  const fps = Math.min(50, Math.max(s.format === 'gif' ? 15 : 30, Math.ceil(1 / s.duration)))
  // GIF keeps full chroma so the palette has the real colours to work with.
  const pix = s.format === 'gif' ? 'yuv444p' : 'yuv420p'
  const xfade = frames.length > 1 ? TRANSITIONS[s.transition] : null
  const files: string[] = []

  // Build one graph ending in [v]: each still held for `duration`, joined by
  // xfade if a transition is set, otherwise simply concatenated.
  const inputs = frames.flatMap((_, i) => ['-loop', '1', '-t', String(s.duration), '-framerate', String(fps), '-i', inputName(i)])
  const graph = frames.map((_, i) => `[${i}:v]${fit},fps=${fps},format=${pix}[s${i}]`)
  if (xfade) {
    const len = transitionSeconds(s.duration)
    let prev = 's0'
    for (let i = 1; i < frames.length; i++) {
      const out = i === frames.length - 1 ? 'v' : `x${i}`
      graph.push(`[${prev}][s${i}]xfade=transition=${xfade}:duration=${len.toFixed(3)}:offset=${(i * (s.duration - len)).toFixed(3)}[${out}]`)
      prev = out
    }
  } else {
    graph.push(`${frames.map((_, i) => `[s${i}]`).join('')}concat=n=${frames.length}:v=1:a=0[v]`)
  }

  try {
    onStatus('Preparing')
    for (let i = 0; i < frames.length; i++) {
      await ffmpeg.writeFile(inputName(i), await fetchFile(await toPng(frames[i])))
      files.push(inputName(i))
    }

    onStatus('Encoding')
    if (s.format === 'mp4') {
      await run(ffmpeg, ['-y', ...inputs, '-filter_complex', graph.join(';'), '-map', '[v]',
        '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '23', '-pix_fmt', 'yuv420p', '-movflags', '+faststart', 'out.mp4'], 'Encoding')
      files.push('out.mp4')
      const data = (await ffmpeg.readFile('out.mp4')) as Uint8Array
      return new Blob([data.slice()], { type: 'video/mp4' })
    }

    graph.push('[v]split[a][b];[a]palettegen=max_colors=256[p];[b][p]paletteuse=dither=bayer[g]')
    await run(ffmpeg, ['-y', ...inputs, '-filter_complex', graph.join(';'), '-map', '[g]', '-loop', '0', 'out.gif'], 'Encoding')
    files.push('out.gif')
    const data = (await ffmpeg.readFile('out.gif')) as Uint8Array
    return new Blob([data.slice()], { type: 'image/gif' })
  } finally {
    for (const f of files) await ffmpeg.deleteFile(f).catch(() => {})
  }
}
