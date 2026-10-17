// pdf.js is large, so it's only loaded when a PDF is dropped.
async function loadPdfjs() {
  const [pdfjs, worker] = await Promise.all([import('pdfjs-dist'), import('pdfjs-dist/build/pdf.worker.mjs?url')])
  pdfjs.GlobalWorkerOptions.workerSrc = worker.default
  return pdfjs
}

export const MAX_PDF_SIZE = 50 * 1024 * 1024

export type Frame = {
  id: string
  name: string
  url: string
  el: HTMLImageElement
  width: number
  height: number
}

let seq = 0
const nextId = () => `f${Date.now().toString(36)}${(seq++).toString(36)}`

function decode(url: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = reject
    el.src = url
  })
}

async function fromBlob(blob: Blob, name: string): Promise<Frame | null> {
  const url = URL.createObjectURL(blob)
  try {
    const el = await decode(url)
    return { id: nextId(), name, url, el, width: el.naturalWidth, height: el.naturalHeight }
  } catch {
    URL.revokeObjectURL(url)
    return null
  }
}

async function fromPdf(file: File): Promise<Frame[]> {
  if (file.size > MAX_PDF_SIZE) throw new Error('PDF is over 50MB')
  const pdfjs = await loadPdfjs()
  const pdf = await pdfjs.getDocument({ data: await file.arrayBuffer() }).promise
  const frames: Frame[] = []
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i)
    const viewport = page.getViewport({ scale: 2 })
    const canvas = document.createElement('canvas')
    canvas.width = viewport.width
    canvas.height = viewport.height
    await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise
    const blob = await new Promise<Blob | null>(r => canvas.toBlob(r, 'image/png'))
    const frame = blob && (await fromBlob(blob, `${file.name} p${i}`))
    if (frame) frames.push(frame)
  }
  return frames
}

export async function loadFiles(files: File[]): Promise<Frame[]> {
  const frames: Frame[] = []
  for (const file of files) {
    if (file.type === 'application/pdf') frames.push(...(await fromPdf(file)))
    else if (file.type.startsWith('image/')) {
      const frame = await fromBlob(file, file.name)
      if (frame) frames.push(frame)
    }
  }
  return frames
}

export function releaseFrames(frames: Frame[]) {
  frames.forEach(f => URL.revokeObjectURL(f.url))
}

// Draw an image scaled to cover the canvas.
export function drawCover(ctx: CanvasRenderingContext2D, el: HTMLImageElement, w: number, h: number, alpha = 1) {
  if (!el.complete || !el.naturalWidth) return
  const scale = Math.max(w / el.naturalWidth, h / el.naturalHeight)
  const sw = el.naturalWidth * scale
  const sh = el.naturalHeight * scale
  ctx.globalAlpha = alpha
  ctx.drawImage(el, (w - sw) / 2, (h - sh) / 2, sw, sh)
  ctx.globalAlpha = 1
}

// Draw a transition from frame a to frame b at progress t (0..1).
export function drawTransition(
  ctx: CanvasRenderingContext2D,
  a: HTMLImageElement,
  b: HTMLImageElement,
  w: number,
  h: number,
  t: number,
  kind: 'fade' | 'slide' | 'wipe' | 'circle',
) {
  const e = t * t * (3 - 2 * t) // smoothstep, close to xfade's default easing
  if (kind === 'fade') {
    drawCover(ctx, a, w, h, 1 - e)
    drawCover(ctx, b, w, h, e)
    return
  }
  if (kind === 'slide') {
    ctx.save()
    ctx.translate(-w * e, 0)
    drawCover(ctx, a, w, h)
    ctx.translate(w, 0)
    drawCover(ctx, b, w, h)
    ctx.restore()
    return
  }
  drawCover(ctx, a, w, h)
  ctx.save()
  ctx.beginPath()
  if (kind === 'wipe') ctx.rect(w * (1 - e), 0, w * e, h)
  else ctx.arc(w / 2, h / 2, Math.hypot(w, h) / 2 * e, 0, Math.PI * 2)
  ctx.clip()
  drawCover(ctx, b, w, h)
  ctx.restore()
}
