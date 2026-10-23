# Petal

**Drag. Tap. Bloom.** Drag any file, tap a key, and a flower of tools opens under your cursor. Drop it on a petal.

Petal is a Windows tray app built with Electron:

- **The wheel:** convert, compress, clean metadata, copy text (OCR), remove background (on-device AI), add background, crop, edit, annotate, redact, merge to PDF.
- **Petal Island:** a liquid-glass drop at the top of the screen (or anywhere you drag it). Drop files on it, grab results back out of it, and glance at live CPU, GPU, RAM, network, battery and time. It steps aside for fullscreen games and video.
- **Petal Ask:** tap **Ctrl** twice anywhere and ask about your files in plain English or Hinglish: "files over 300 MB", "duplicate photos", "clean up junk", "compress images in Downloads". It shows exactly what would happen. Removing moves files to the Recycle Bin, with one-click Undo. Windows, apps, git repos and files in use are never touched.

Everything runs on your PC. Nothing is uploaded.

## Run

```bash
npm install
npm start
```

Windows 10/11 only. The two small native helpers (`src/native/*.cs`) are compiled on first run with the C# compiler that ships with Windows.

## Test

```bash
npm test                 # wheel and actions
npm run test:island      # island states, widgets, settings, layout
npm run test:ask         # Ask: parser, double-tap, engine (real Recycle Bin round trip), panel
npm run test:editors     # crop, add background, edit, annotate, redact
npm run test:tier2       # OCR, merge, remove background
npm run test:perf        # CPU budget for every resting and active state
npm run test:hook        # cost of the native helper
npm run test:fullscreen  # hiding for fullscreen apps, multi-monitor placement
npm run test:drag        # drags the island with the real mouse (don't touch it while it runs)
```

Test output (screenshots, contact sheets) goes to `.snap/`.
