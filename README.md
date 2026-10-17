# flkty

Turns images and PDF pages into a looping slideshow, then exports it as MP4 or GIF, entirely in the browser.

- Drop images or PDFs anywhere; PDFs are split into one frame per page.
- Set the time per frame, a transition (fade, slide, wipe, circle), the aspect ratio or a custom crop.
- The preview matches the export: transitions are drawn on canvas and encoded with ffmpeg's `xfade`.
- Encoding uses ffmpeg.wasm (single-threaded core), so nothing is uploaded and it runs on GitHub Pages without special headers.

Built on [veryrobert/starter](https://github.com/veryrobert/starter): React, TypeScript, Vite, Tailwind v4, shadcn/ui, Lucide.

```bash
npm install
npm run dev
```
