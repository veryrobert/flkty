import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import {
  ArrowLeftRight, Download, History, ImagePlus, Layers, Loader2, Pause, Play, Plus, SlidersHorizontal, Trash2, X,
} from 'lucide-react'
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from '@/components/ui/sheet'
import { Slider } from '@/components/ui/slider'
import { Input } from '@/components/ui/input'
import { TooltipProvider } from '@/components/ui/tooltip'
import { ToolButton } from '@/components/shell/ToolButton'
import { Toolbar, ToolbarSeparator } from '@/components/shell/Toolbar'
import { Segmented } from '@/components/shell/Segmented'
import { Field, FieldGroup } from '@/components/shell/Field'
import { loadFiles, releaseFrames, type Frame } from '@/lib/frames'
import { outputSize, type Format, type Ratio, type Settings, type Transition } from '@/lib/output'
import { encode, loadFFmpeg } from '@/lib/encode'
import { useStored } from '@/hooks/useStored'
import { usePlayer } from '@/hooks/usePlayer'
import { Splash } from '@/components/shell/Splash'
import { cn } from '@/lib/utils'

const panels = [
  { id: 'frames', label: 'Frames', icon: Layers },
  { id: 'settings', label: 'Settings', icon: SlidersHorizontal },
  { id: 'exports', label: 'Exports', icon: History },
] as const
type PanelId = (typeof panels)[number]['id']

type Export = { id: number; name: string; url: string; frames: number; duration: number; ratio: Ratio }

// Duration slider is logarithmic: 0.04s to 60s.
const MIN_D = 0.04
const MAX_D = 60
const toSlider = (d: number) => (Math.log(d / MIN_D) / Math.log(MAX_D / MIN_D)) * 100
const fromSlider = (v: number) => {
  const d = MIN_D * Math.pow(MAX_D / MIN_D, v / 100)
  return d < 1 ? Math.round(d * 100) / 100 : Math.round(d * 10) / 10
}

const ratioOptions: { value: Ratio; label: string }[] = [
  { value: 'original', label: 'Original' },
  { value: '16:9', label: '16:9' },
  { value: '1:1', label: '1:1' },
  { value: '9:16', label: '9:16' },
]

const transitionOptions: { value: Transition; label: string }[] = [
  { value: 'none', label: 'None' },
  { value: 'fade', label: 'Fade' },
  { value: 'slide', label: 'Slide' },
  { value: 'wipe', label: 'Wipe' },
  { value: 'circle', label: 'Circle' },
]

function download(url: string, name: string) {
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
}

export default function App() {
  const [frames, setFrames] = useState<Frame[]>([])
  const [panel, setPanel] = useState<PanelId | null>(null)
  const [exports, setExports] = useState<Export[]>([])
  const [status, setStatus] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [dragging, setDragging] = useState(false)

  const [duration, setDuration] = useStored('flkty.duration', 1)
  const [transition, setTransition] = useStored<Transition>('flkty.transition', 'none')
  const [ratio, setRatio] = useStored<Ratio>('flkty.ratio', 'original')
  const [cropWidth, setCropWidth] = useStored<number | null>('flkty.cropWidth', null)
  const [cropHeight, setCropHeight] = useStored<number | null>('flkty.cropHeight', null)
  const [format, setFormat] = useStored<Format>('flkty.format', 'mp4')
  const settings: Settings = { duration, transition, ratio, cropWidth, cropHeight, format }

  const canvas = useRef<HTMLCanvasElement>(null)
  const fileInput = useRef<HTMLInputElement>(null)
  const dragFrom = useRef<number | null>(null)

  const size = useMemo(
    () => outputSize(frames, { duration, transition, ratio, cropWidth, cropHeight, format }),
    [frames, duration, transition, ratio, cropWidth, cropHeight, format],
  )
  const { playing, setPlaying, index, goTo } = usePlayer({ canvas, frames, size, duration, transition })
  const encoding = status !== ''

  // Start fetching ffmpeg in the background so the first export is quick.
  useEffect(() => {
    loadFFmpeg().catch(() => {})
  }, [])

  const addFiles = useCallback(async (files: File[]) => {
    if (files.length === 0) return
    setError('')
    setLoading(true)
    try {
      const added = await loadFiles(files)
      setFrames(prev => [...prev, ...added])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read files')
    }
    setLoading(false)
  }, [])

  const removeFrame = (id: string) => {
    setFrames(prev => {
      releaseFrames(prev.filter(f => f.id === id))
      return prev.filter(f => f.id !== id)
    })
  }

  const clearFrames = () => {
    releaseFrames(frames)
    setFrames([])
    goTo(0)
  }

  const moveFrame = (from: number, to: number) => {
    if (from === to) return
    setFrames(prev => {
      const next = [...prev]
      const [item] = next.splice(from, 1)
      next.splice(to, 0, item)
      return next
    })
  }

  const runExport = async () => {
    if (frames.length === 0 || encoding) return
    setError('')
    try {
      const blob = await encode(frames, settings, setStatus)
      const url = URL.createObjectURL(blob)
      const name = `flkty-${new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-')}.${format}`
      download(url, name)
      setExports(prev => [{ id: Date.now(), name, url, frames: frames.length, duration, ratio }, ...prev])
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Export failed')
    }
    setStatus('')
  }

  const current = panels.find(p => p.id === panel)
  const empty = frames.length === 0

  return (
    <TooltipProvider delayDuration={400}>
      <Splash label="Loading flkty">
        <path pathLength={1} d="M12 9V6h14v14h-3" />
        <path pathLength={1} d="M9 12V9h14v14h-3" />
        <path pathLength={1} d="M6 12h14v14H6z" />
      </Splash>
      <div
        className="fixed inset-0"
        onDragOver={e => {
          e.preventDefault()
          if (e.dataTransfer.types.includes('Files')) setDragging(true)
        }}
        onDragLeave={e => e.currentTarget === e.target && setDragging(false)}
        onDrop={e => {
          e.preventDefault()
          setDragging(false)
          if (e.dataTransfer.files.length) addFiles([...e.dataTransfer.files])
        }}
      >
        <input
          ref={fileInput}
          type="file"
          accept="image/*,application/pdf"
          multiple
          hidden
          onChange={e => {
            addFiles([...(e.target.files ?? [])])
            e.target.value = ''
          }}
        />

        <main className={cn('absolute inset-0 grid place-items-center p-6 pb-24 transition-[right] duration-200', panel && 'sm:right-[300px]')}>
          {empty ? (
            <button
              type="button"
              onClick={() => fileInput.current?.click()}
              className="flex flex-col items-center gap-3 rounded-2xl p-8 text-muted-foreground transition-colors outline-none hover:text-foreground focus-visible:ring-2 focus-visible:ring-ring"
            >
              {loading ? <Loader2 className="size-6 animate-spin" strokeWidth={1.5} /> : <ImagePlus className="size-6" strokeWidth={1.5} />}
              <span className="text-xs">Drop images or PDFs</span>
            </button>
          ) : (
            <canvas
              ref={canvas}
              aria-label="Preview"
              className="max-h-full max-w-full rounded-sm"
              style={{ aspectRatio: `${size.width} / ${size.height}` }}
            />
          )}
        </main>

        {dragging && (
          <div className="pointer-events-none absolute inset-3 z-70 rounded-2xl border border-dashed border-foreground/40 bg-background/60" />
        )}
      </div>

      <nav
        aria-label="Panels"
        className={cn('panel fixed top-3 right-3 z-60 flex flex-col gap-1 rounded-full p-1 transition-[right] duration-200', panel && 'sm:right-[calc(300px+0.75rem)]')}
      >
        {panels.map(p => (
          <ToolButton key={p.id} icon={p.icon} label={p.label} active={panel === p.id} onClick={() => setPanel(panel === p.id ? null : p.id)} />
        ))}
      </nav>

      <Sheet open={panel !== null} onOpenChange={open => !open && setPanel(null)} modal={false}>
        <SheetContent
          side="right"
          className="panel gap-0 data-[side=right]:w-[min(300px,86vw)] data-[side=right]:sm:max-w-[300px]"
          onInteractOutside={e => e.preventDefault()}
        >
          <SheetHeader>
            <SheetTitle>{current?.label}</SheetTitle>
            <SheetDescription className="sr-only">{current?.label}</SheetDescription>
          </SheetHeader>

          <div className="flex flex-col gap-6 overflow-y-auto px-4 pb-6">
            {panel === 'frames' && (
              <>
                <div className="flex items-center justify-between">
                  <span className="text-xs text-muted-foreground">{frames.length} frames</span>
                  <div className="flex gap-0.5">
                    <ToolButton icon={Plus} label="Add" side="bottom" className="size-8" onClick={() => fileInput.current?.click()} />
                    <ToolButton icon={ArrowLeftRight} label="Reverse" side="bottom" className="size-8" disabled={frames.length < 2} onClick={() => setFrames(prev => [...prev].reverse())} />
                    <ToolButton icon={Trash2} label="Clear" side="bottom" className="size-8" disabled={empty} onClick={clearFrames} />
                  </div>
                </div>
                <ol className="grid grid-cols-3 gap-1.5">
                  {frames.map((f, i) => (
                    <li
                      key={f.id}
                      draggable
                      onDragStart={e => {
                        dragFrom.current = i
                        e.dataTransfer.effectAllowed = 'move'
                      }}
                      onDragOver={e => e.preventDefault()}
                      onDrop={() => {
                        if (dragFrom.current !== null) moveFrame(dragFrom.current, i)
                        dragFrom.current = null
                      }}
                      className={cn(
                        'group relative aspect-square cursor-grab overflow-hidden rounded-md ring-1 ring-border',
                        i === index && 'ring-2 ring-foreground',
                      )}
                    >
                      <button type="button" aria-label={`Show frame ${i + 1}`} className="block size-full" onClick={() => goTo(i)}>
                        <img src={f.url} alt="" className="size-full object-cover" draggable={false} />
                      </button>
                      <span className="pointer-events-none absolute bottom-1 left-1 rounded-sm bg-background/70 px-1 text-[10px] tabular-nums">{i + 1}</span>
                      <button
                        type="button"
                        aria-label={`Remove frame ${i + 1}`}
                        onClick={() => removeFrame(f.id)}
                        className="absolute top-1 right-1 grid size-5 place-items-center rounded-full bg-background/80 opacity-0 transition-opacity group-hover:opacity-100 focus-visible:opacity-100"
                      >
                        <X className="size-3" strokeWidth={1.5} />
                      </button>
                    </li>
                  ))}
                </ol>
              </>
            )}

            {panel === 'settings' && (
              <>
                <FieldGroup>
                  <Field label="Duration">
                    <div className="flex items-center gap-3">
                      <Slider
                        aria-label="Seconds per frame"
                        min={0}
                        max={100}
                        step={0.5}
                        value={[toSlider(duration)]}
                        onValueChange={([v]) => setDuration(fromSlider(v))}
                      />
                      <span className="w-10 text-right text-xs text-muted-foreground tabular-nums">{duration}s</span>
                    </div>
                  </Field>
                  <Field label="Transition">
                    <Segmented label="Transition" value={transition} onChange={setTransition} options={transitionOptions} />
                  </Field>
                </FieldGroup>
                <FieldGroup title="Size">
                  <Field label="Ratio">
                    <Segmented label="Ratio" value={ratio} onChange={setRatio} options={ratioOptions} />
                  </Field>
                  {ratio === 'original' && (
                    <Field label="Crop">
                      <div className="flex items-center gap-2">
                        <Input
                          type="number"
                          inputMode="numeric"
                          placeholder="W"
                          aria-label="Crop width"
                          value={cropWidth ?? ''}
                          onChange={e => setCropWidth(parseInt(e.target.value) || null)}
                        />
                        <X className="size-3 shrink-0 text-muted-foreground" strokeWidth={1.5} />
                        <Input
                          type="number"
                          inputMode="numeric"
                          placeholder="H"
                          aria-label="Crop height"
                          value={cropHeight ?? ''}
                          onChange={e => setCropHeight(parseInt(e.target.value) || null)}
                        />
                      </div>
                    </Field>
                  )}
                  <p className="text-xs text-muted-foreground tabular-nums">{size.width} × {size.height}</p>
                </FieldGroup>
                <FieldGroup title="Export">
                  <Field label="Format">
                    <Segmented label="Format" value={format} onChange={setFormat} options={[{ value: 'mp4', label: 'MP4' }, { value: 'gif', label: 'GIF' }]} />
                  </Field>
                </FieldGroup>
              </>
            )}

            {panel === 'exports' &&
              (exports.length === 0 ? (
                <p className="text-xs text-muted-foreground">None yet</p>
              ) : (
                <ul className="flex flex-col gap-1">
                  {exports.map(x => (
                    <li key={x.id} className="flex items-center gap-2 rounded-lg py-1 pl-2 hover:bg-accent">
                      <div className="min-w-0 flex-1">
                        <p className="truncate text-xs">{x.name}</p>
                        <p className="text-xs text-muted-foreground">{x.frames} frames · {x.duration}s · {x.ratio}</p>
                      </div>
                      <ToolButton icon={Download} label="Download" className="size-8" onClick={() => download(x.url, x.name)} />
                    </li>
                  ))}
                </ul>
              ))}
          </div>
        </SheetContent>
      </Sheet>

      <div className={cn('pointer-events-none fixed inset-x-0 bottom-4 flex flex-col items-center gap-2 transition-[right] duration-200', panel && 'sm:right-[300px]')}>
        {(error || encoding) && (
          <p role="status" className={cn('panel rounded-full px-3 py-1 text-xs', error ? 'text-destructive' : 'text-muted-foreground')}>
            {error || status}
          </p>
        )}
        <Toolbar aria-label="Playback" className="pointer-events-auto">
          <ToolButton icon={playing ? Pause : Play} label={playing ? 'Pause' : 'Play'} side="top" disabled={empty} onClick={() => setPlaying(!playing)} />
          <span className="min-w-12 px-1 text-center text-xs text-muted-foreground tabular-nums">
            {empty ? '0 / 0' : `${index + 1} / ${frames.length}`}
          </span>
          <ToolbarSeparator />
          <ToolButton icon={Plus} label="Add images or PDFs" side="top" onClick={() => fileInput.current?.click()} />
          <ToolButton
            icon={encoding ? Loader2 : Download}
            label={`Export ${format.toUpperCase()}`}
            side="top"
            disabled={empty || encoding}
            className={cn(encoding && '[&_svg]:animate-spin')}
            onClick={runExport}
          />
        </Toolbar>
      </div>
    </TooltipProvider>
  )
}
