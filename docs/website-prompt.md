# Prompt: the Petal website

Copy everything below the line into your AI coding tool (Claude Code, Cursor, v0, Lovable…). It is written to be built as-is.

---

You are a world-class creative developer and art director, the kind whose sites win Awwwards Site of the Day and get dissected on Twitter frame by frame. Build the official product website for **Petal**, a Windows desktop app. Every scroll, hover and click must feel crafted and alive, and the whole thing must stay fast (60 fps on a mid-range laptop, Lighthouse performance ≥ 90 on desktop). Wow-factor comes from ideas and precision, not from piling on effects.

## 1. The product (use these facts exactly; never invent features, numbers, users, press, or testimonials)

**Petal: Drag. Tap. Bloom.** Drag any file, tap a key (Shift by default), and a 3D glass flower of tools opens under the cursor. Drop the file on a petal.

- **The wheel (10 petals + center):** Convert (center dome), Compress, Clean metadata, Copy text (OCR), Edit, Annotate, Add background, Remove background (on-device AI), Crop, Redact, Merge to PDF.
- **Petal Island:** a liquid-glass drop that clings to the top edge of the screen, or floats anywhere you drag it (it stretches like jelly while you carry it and wobbles when it lands). Drag a file near it and it becomes a drop zone with a tendril reaching toward your cursor. Results drip out of it as a droplet you can drag into any app. Hover it for **Glance**: live CPU and GPU rings, a RAM "liquid tank", network streams that flow only when data moves, battery, and a clock with rolling digits. It steps aside for fullscreen games and video, and follows you across monitors.
- **Petal Ask:** tap **Ctrl twice** anywhere and ask about your files in plain English or Hinglish: "show me files over 300 MB", "duplicate photos", "clean up junk", "what's taking space", "compress images in Downloads", "remove background from my latest screenshot". It knows which window you came from (open Explorer on a folder and it suggests things for that folder). It shows exactly what will happen first; removing moves files to the Recycle Bin with one-click Undo (Ctrl+Z). It never touches Windows, installed apps, git repositories, files open in another app, or OneDrive online-only files. Files tumble into the island's bud when you clean up.
- **Everything runs on your PC. Nothing is uploaded.** Remove background uses a local AI model; OCR uses Windows' own engine.
- Windows 10 and 11. Free download from GitHub Releases: `https://github.com/LetMeCodex/Petal/releases/latest`. Source: `https://github.com/LetMeCodex/Petal`. The installer isn't code-signed yet, so the download section must say, kindly: Windows may show "Windows protected your PC"; choose **More info → Run anyway**.
- Built light: idle uses well under 1% of the CPU; animations cap themselves on 144 Hz screens; Motion: Auto / Full / Calm.

## 2. Art direction: "Botanical X-ray / File HUD"

The visual language comes from a reference poster (SENS.STORY "xray.effect"): x-rayed flowers on black paper, annotated like a lab specimen.

- **Ground:** matte near-black paper, `#0c0b0d`, with a fine animated film grain (SVG `feTurbulence` or a tiny WebGL noise pass at 4–6% opacity, re-seeded at 12 fps so it breathes without shimmering) and a faint vignette.
- **Hero imagery:** translucent **x-ray flowers** (peony, cherry blossom, lotus) and a moth or butterfly, rendered as luminous white-blue radiographs: inverted luminance, glowing veins, soft fresnel edges, layered transparency so the petals behind show through. **Petal's flower is the hero**: the 10-petal wheel as an x-rayed glass bloom.
- **The lens:** rectangular frames with 1 px white hairlines inside which the subject shows in **true colour** (soft pink `#f4a7c0`, blush `#ffd3e0`, a single lilac `#c9a6ff`), labelled `not.xray`. Outside the lens is x-ray, inside is reality. This is the core metaphor of the site: Petal sees inside your files.
- **Annotation layer (HUD):** hairline connector lines (1 px, `rgba(255,255,255,.55)`) between nodes with 4 px hollow circle endpoints; monospace labels as file names and file-type tags (`butterfly.png`, `flowers.jpeg`, `object.peony`, `.xray`, `.png`, `not.found`); small floating number readouts (`647.7468.89`, `-39.45673,54`, `1243.254`); small chips filled with a heavily blurred crop of the image (backdrop-filter or pre-blurred tiles) and a mono label on top; thin oversized circle arcs crossing the page edges.
- **Corner labels**, fixed in the four viewport corners, mono caps, 12–13 px, letter-spacing .12em: top-left `PETAL.APP`, top-right the current section name (`DROP`, `ISLAND`, `ASK`, `PRIVACY`, `DOWNLOAD`), bottom-left `FOR WINDOWS`, bottom-right a live scroll readout like `023.41 / 100`. A tiny 4-petal glyph sits top-center.
- **Typography:** monospace for everything technical (`Geist Mono` or `JetBrains Mono`); a characterful display face for headlines (`Bricolage Grotesque` variable, using its width and weight axes, or `PP Neue Montreal` if licensed); body `Geist`. Headlines are big but sparse; most text is small, precise, and labelled like a specimen sheet.
- **Colour budget:** 90% monochrome (black paper, white x-ray, grey hairlines). Colour only appears through lenses, on hover, and on the Download button. That restraint is what makes the reveals hit.

## 3. Stack (pin these, no alternatives unless something is missing)

- **Next.js 15** (App Router, React 19, TypeScript, static export where possible) and **Tailwind CSS v4** for layout tokens.
- **GSAP 3.13+** (now free, including the plugins): `ScrollTrigger`, `SplitText`, `Flip`, `MorphSVGPlugin`, `DrawSVGPlugin`, `CustomEase`, `Observer`, `InertiaPlugin`. Use GSAP as the single animation clock.
- **Lenis** for smooth scrolling, driven from `gsap.ticker` (one rAF loop for everything).
- **three.js r170** via **@react-three/fiber 9** and **@react-three/drei 10**; **postprocessing** for bloom and chromatic aberration only where called for. Custom GLSL for the x-ray material.
- **Motion** (the successor to framer-motion) only for small React UI state transitions (menus, toasts); never two libraries animating the same element.
- **Rive** (optional) for the island's jelly/drop states if hand-made state machines are easier than code.
- Icons: hand-drawn hairline SVGs to match the HUD, not an icon pack.

## 4. Scenes, scroll by scroll

Each scene is a pinned or semi-pinned ScrollTrigger section. Animations are **scrubbed** to scroll (with `scrub: 0.8` smoothing) unless marked "plays".

### 0. Preloader (≤ 1.6 s, skip if cached)
A single hairline draws a circle (DrawSVG), the 4-petal glyph blooms inside it, a mono counter ticks `000 → 100` with the current asset being "scanned" (`loading flower.glb … xray.frag … grain.png`). Then the circle becomes the lens of the hero: a FLIP transition, not a fade.

### 1. Hero: "Drag. Tap. Bloom."
- Center stage: the **x-ray glass flower** (3D, 10 petals), slowly breathing (petals open and close 2–3°), lit from a light that follows the cursor so reflections slide across the glass.
- A **lens** follows the cursor with a spring lag (InertiaPlugin, 120 ms feel). Inside the lens, the flower renders in true colour: a second render target sampled through a rectangle mask in screen space, with the lens frame, a mono filename `flower.petal` and live coordinates (`x 641.2 / y 252.8`) on its corners. On touch devices the lens drifts on its own path.
- The headline sets in from SplitText chars with a "scan" effect: each glyph flickers from x-ray outline to solid as a horizontal scan line passes (clip-path plus a 1 px glowing line).
- HUD nodes connect the flower to small labels for real petal actions (`compress`, `remove.bg`, `ocr`, `crop`, `merge.pdf`); connector lines draw in, then pulse once.
- Scroll cue: a tiny file icon (`.png`) bobs above the words "drag to scroll" instead of a chevron.

### 2. The drag (pinned, ~250 vh)
The story of one file, scrubbed by scroll:
1. A real-looking desktop window (dark Explorer-style chrome, drawn in hairlines) with a photo `mug.jpg`. The cursor picks it up; the drag ghost tilts with velocity.
2. Mono annotation: `key: shift / tap once`. A keycap depresses and the flower **blooms under the cursor** (the 3D flower from the hero, scaled and repositioned with Flip so it's the same object, not a copy).
3. The file hovers over petals; each highlighted petal lifts on its hinge, neighbours part, a label slides out (`remove background · on-device ai`).
4. Drop on Remove BG: the petal is "plucked" into the dome, the flower folds back into a bud, and the result appears **through a lens**: x-ray mug outside, cut-out mug in colour inside the frame, labelled `mug no bg.png`. A before/after hairline you can drag with the mouse.

### 3. The petals (horizontal, 10 cards)
A horizontal scroll (pinned, translated by vertical scroll) of 10 specimen cards, one per action. Each card is an x-rayed file on black paper with its label (`.jpg → .webp`, `exif.gps → removed`, `scan → text`).
- **Hover reveal:** the card's lens opens from the cursor position (clip-path circle expanding to the frame) to show the real result in colour, while the HUD numbers on the card roll to new values (odometer digits).
- Magnetic card tilt (±6°), shadow parallax, and the cursor turns into a small petal that rotates toward the card's centre.
- Card copy is one line each, true to the app.

### 4. Petal Island (pinned, ~300 vh)
- A large mock screen top-edge. The **island drop** clings to the top with liquid fillets (SVG metaball or a shader). Scroll drives it through its real states: idle (pulse ring around the bud, filling with "CPU"), hover (opens into the Glance panel: rings count up, the RAM tank sloshes once, network dashes flow), drag (a file approaches; a tendril reaches out like surface tension; the drop zone shows beads for actions), work (a blush liquid rises inside the pill), done (a droplet drips down; you can grab it with the mouse and it springs back with jelly physics).
- **Interactive:** the user can drag the island anywhere on the mock screen; it stretches with velocity and wobbles when released, and snaps back to the top edge if dropped near it (preview the snap with the fillets regrowing).
- Annotations name each state like a lab sheet (`state.idle`, `state.drag / tendril`, `state.done / drip`).

### 5. Petal Ask (pinned, ~250 vh)
- Two taps of a Ctrl keycap; the island stretches into a command bar (Flip between the two shapes).
- The query types itself character by character: `show me huge files over 300 MB`. Results stream in as rows with file-type tiles and sizes in mono; a counter reads `found in 0.3 s`.
- **Remove all**: the file tiles lift out of their rows and **tumble along arcs into the bud** (each a GSAP motionPath with rotation and scale toward 0.18), the bud gulps, and the panel collapses to `25 MB cleaned up · Undo (Ctrl Z)`. A scroll back up replays it in reverse, so it "un-tumbles": that's the Undo.
- A rotating line of example asks in English and Hinglish (`300mb se badi files dikhao`, `latest screenshot ka bg hatao`) types and deletes itself under the bar.
- A small "safety" diagram: hairline nodes for `windows/`, `program files/`, `.git/`, `in use`, `online-only`, each struck through with a tiny `not.touched` tag.

### 6. Privacy: "Nothing leaves your PC"
- A full-bleed x-ray of a laptop or tower, with the data paths drawn as hairlines that all **loop back inside** the machine. One dashed line tries to leave toward a cloud glyph and dissolves into grain (`upload: none`).
- Hover any component to light its label: `ocr: windows engine`, `remove bg: local model`, `stats: on-device`.

### 7. Light by design
- A minimal oscilloscope-style CPU graph that sits almost flat at `< 1%` while the island idles, with a toggle for Motion: Full / Calm that visibly calms the whole page (it really switches the site's own animations to their calm variants, honouring the same idea).

### 8. Download
- A big lens over a field of x-ray petals; inside it, the Download button in pink glass (`Petal for Windows · free`), a magnetic button that follows the cursor within 40 px and squishes on press.
- Beneath, in mono: version (read from the GitHub Releases API at build time, with a static fallback), size, `Windows 10 / 11`, and the SmartScreen note in a calm tone with a tiny illustration of the "More info → Run anyway" clicks.
- Secondary link: `view source on github`.

### 9. Footer
Corner-label style. A last x-ray flower closes its petals as you reach the bottom. `drag. tap. bloom.` set in the display face, with letters that react to the cursor by width axis (variable font hover).

## 5. Micro-interactions (everywhere, all subtle)

- **Cursor:** a 6 px dot plus a lagging hairline ring; over links the ring becomes a lens frame with the link's file-type label (`.github`, `.exe`); over the 3D flower it shows the petal name.
- **Hover reveal on text:** key words are wrapped as specimens. Hovering one draws a hairline to a mini label with a coordinate (`bloom → 28.7896.543`).
- **Numbers** everywhere are odometers (digits roll), never cross-fades.
- **Section transitions:** the corner label changes with a split-flap effect; the scroll readout counts live.
- **Buttons:** magnetic, squash on press (scale .94 with a spring back), a glint sweeps once on hover (transform only).
- **Images:** all mock files have an x-ray version and a colour version; hover reveals colour through a lens, never by fading the whole image.
- **Sound (off by default, toggle in a corner):** soft glass ticks on petal hover, a droplet on "done". Respect the toggle and never autoplay.

## 6. The x-ray look: how to make it

- **3D flower:** model one petal in Blender (thin curved shell), instance it 10× around a dome, export GLB (Draco, < 400 KB). X-ray shader: `alpha = pow(1.0 - abs(dot(normal, viewDir)), 1.6)`, additive blending, depth write off, a vein texture (procedural noise lines along the UV v-axis) multiplied in, a slight blue-white tint `#dfe9ff`. The colour version uses a soft pink subsurface-ish shader in a second render target shown only inside lenses.
- **Still images** (flowers, butterfly, mock files): generate or photograph on black, then make x-ray versions by inverting luminance, boosting local contrast (high-pass), tinting cool white, and keeping 70–85% transparency for overlaps. Keep both versions for every image (x-ray and colour) at matching crops.
- **Grain** and **vignette** are one tiny full-screen pass, not per element.

## 7. Performance, motion and accessibility (non-negotiable)

- One rAF loop (gsap.ticker) for Lenis, GSAP and the R3F frame (`frameloop="demand"` and invalidate from GSAP). Pause WebGL when its section is off-screen (IntersectionObserver). Cap the canvas DPR at 1.5.
- Animate only `transform`, `opacity`, `clip-path` and shader uniforms. No layout-thrashing properties, no animated `filter: blur()` on large areas, no animated `box-shadow`.
- Lazy-load every scene's assets just before it enters (≥ 1 viewport ahead). LCP is the hero headline, not the 3D canvas; the canvas fades in after.
- **`prefers-reduced-motion`:** no scrubbed pinning, no parallax, no grain animation; scenes become static compositions with instant state changes, and every piece of content is still there.
- Full keyboard navigation, visible focus rings drawn as lens frames, real text (not text baked into images or canvas), alt text for every image, contrast ≥ 4.5:1 for body text.
- **Mobile:** same story, simplified. Pins become short sticky sections, the lens follows a scripted path, horizontal cards become a swipeable carousel, and 3D falls back to a pre-rendered x-ray video loop (WebM/MP4 < 1.5 MB) on low-end devices (check `navigator.hardwareConcurrency <= 4` or a GPU tier library).

## 8. Content rules

- Every claim must be true to the facts in section 1. No fake download counts, ratings, logos, testimonials or "trusted by" rows. If a social-proof slot looks empty, design something else.
- Copy voice: short, warm, precise, a little playful; product names in plain text (Petal, Petal Island, Petal Ask).
- Meta: title `Petal: Drag. Tap. Bloom.`, a description that says it's a free Windows app for working with files by dragging them onto a flower of tools, an Open Graph image in the x-ray style.

## 9. Deliverables

1. The Next.js project, organised by scene (`/scenes/Hero.tsx`, `/scenes/Drag.tsx`, …), with a shared `useLens`, `useScrub` and `HudLine` component kit.
2. A `DESIGN.md` listing tokens (colours, type scale, line weights, easing curves: define `petal.out = CustomEase "0.16, 1, 0.3, 1"` and `petal.spring` for squash), and how each scene is wired.
3. A storyboard page (`/lab`) that shows every scene in isolation with sliders for scroll progress, for tuning.
4. A short README: how to run, how to swap images, where the release URL comes from.

Build it scene by scene: get scene 1 perfect (look, motion, performance) before starting scene 2, and show me each scene before moving on.
