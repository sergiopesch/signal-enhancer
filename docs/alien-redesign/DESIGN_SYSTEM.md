# Signal Enhancer — Xeno Signal design system

## Direction

**Xeno Signal / The Contact Instrument** treats Signal Enhancer as a recovered nonhuman machine translated just enough for a person to operate. The spectacle comes from one persistent artifact and real signal behavior, while product truth stays in readable, semantic interface text.

The system has three material layers:

1. **The void** — mineral black space, enormous depth, sparse calibration marks.
2. **The artifact** — warm-bone bioceramic surfaces that hold consent, reading guidance, evidence, and provenance.
3. **The organism** — ultramarine Input A and vermilion Input B signal matter, activated only by real state, playback, capture, or processing progress.

## Accepted concept set

- `concepts/01-entry-desktop.png` — entry portal and monolith
- `concepts/02-setup-desktop.png` — device rail and reading membrane
- `concepts/03-reveal-desktop.png` — selected-source specimen chamber
- `concepts/04-upgrade-progress-desktop.png` — seven-gate transformation
- `concepts/05-upgrade-result-desktop.png` — settled original/preview aperture
- `concepts/06-reveal-mobile.png` — mobile order, controls, and disclosure

Runtime assets:

- `/alien/signal-monolith.png` — complete entry artifact; no UI text
- `/alien/chamber-frame.png` — empty reusable instrument frame; no UI text

## Color lock

| Token             | Value     | Role                               |
| ----------------- | --------- | ---------------------------------- |
| `--void`          | `#0b0b0a` | true mineral-black page background |
| `--void-raised`   | `#111210` | selected dark controls             |
| `--void-soft`     | `#151613` | dialogs and quiet dark surfaces    |
| `--bone`          | `#e9e4d9` | bioceramic instrument body         |
| `--bone-light`    | `#f2eee5` | primary light text and highlights  |
| `--bone-ink`      | `#171714` | text on light artifact surfaces    |
| `--muted`         | `#b7b1a7` | explanatory text                   |
| `--faint`         | `#85827a` | provenance and future state        |
| `--graphite`      | `#484842` | structural rules                   |
| `--graphite-soft` | `#292a26` | quiet separators                   |
| `--signal-a`      | `#5f88ff` | Input A, selection, focus          |
| `--signal-a-dark` | `#2b54bd` | Input A text on bone               |
| `--signal-b`      | `#ff654a` | Input B and transformed preview    |
| `--signal-b-dark` | `#a83224` | Input B text on bone               |
| `--warning`       | `#f3c969` | warnings only                      |

No purple, cyan, green, rainbow, generic neon wash, or alternate “tasteful” neutral is permitted. Controlled radial light and edge refraction may use only the locked palette.

## Typography

- **Human translation / display:** Newsreader. Large, calm, editorial, never all caps.
- **Interface narrative:** Instrument Sans. Body and controls at 15–18 px.
- **Measurement / provenance:** IBM Plex Mono. Minimum 10 px desktop and 11 px mobile; tabular numerals.

Display scale ranges from 46–88 px desktop and 38–56 px mobile. The alien character comes from geometry and spatial behavior, never an unreadable novelty font.

## Container model

- The homepage contains one open void and one monolith. It is not a dashboard.
- The lab uses one asymmetric narrative rail and one dominant chamber.
- The chamber frame is decorative and `aria-hidden`; all interactive content remains code-native.
- Evidence uses ruled rails, open bands, and integrated ledgers. Do not introduce generic card grids.
- Corners are not simply rounded. Use clipped, notched, or carved silhouettes. Ordinary controls may use 0–4 px radii.

## Component families

### Header and stage gates

The header is quiet: enhancement-gate mark, wordmark, About. Five stage gates use numbered circles plus connecting rules. Completed/current/future states combine shape, copy, and contrast.

### Signal monolith

The entry artifact is a complete generated asset with a code-native signal timeline and CTA layered around it. It receives finite pointer depth and a one-time ignition; it becomes still.

### Chamber

Setup, capture, review, and upgrade reuse the same bioceramic frame. Within it:

- Setup presents the complete reading membrane.
- Capture makes the active cue and exact elapsed state dominant.
- Reveal holds one selected SVG trace and stable transport.
- Upgrade aligns real named stages with the center gate.
- Result holds explicitly labelled Original and Local preview evidence.

### Controls

Primary controls are high-contrast blue on black or dark ink on bone. Secondary controls are ruled dark surfaces. Input B uses vermilion only for source identity. Every target is at least 44 px.

### Icons

Use the existing Lucide family at 1.5–1.8 px stroke weight. Required metaphors include microphone, headphones, play/pause, stop, restart, information, shield/privacy, download, warning, and directional arrows. The enhancement-gate mark remains a custom SVG. Decorative artifact etching never substitutes for an icon or label.

## Motion

- Stage entrances: 360–620 ms, transform + opacity only.
- Monolith ignition: one finite 1.4–2.2 s sequence.
- Chamber opening: one finite 700–1,100 ms reveal.
- Hover/focus: 140–220 ms.
- Playback cursor: real audio time only.
- Capture energy: real capture state only.
- Upgrade gates: real deterministic/backend event only.

Motion uses Motion 12 with `LazyMotion`, `MotionConfig reducedMotion="user"`, and compositor-friendly transforms/opacity. The decorative canvas caps DPR, stops when settled, pauses while hidden, and never feeds frame updates through React state.

Reduced motion removes parallax, chamber translation, and ambient field animation; it preserves opacity changes and real playback/capture state.

## Responsive rules

- Desktop: rail + chamber; primary action stays visible near the active instrument.
- Tablet: chamber remains dominant; rail becomes a compact band.
- Mobile: heading → source selector → chamber/transport → compact metrics → Upgrade/Repeat actions → cue evidence.
- No horizontal page overflow at 320 px.
- No important action may be hidden after multiple screenfuls. Reveal’s Upgrade action should land within roughly 1–1.5 initial mobile viewports.
- Artifact frame imagery may be suppressed or simplified on narrow screens rather than shrinking text.

## Above-the-fold copy locks

### Homepage

Allowed: `Signal Enhancer`, `Every input leaves a trace.`, the canonical one-sentence premise, `Begin the comparison`, the browser-first assurance, and the four signal timeline labels. No eyebrow, badge, fake metric, or new claim.

### Lab

The existing product specification is authoritative. Preserve stage names, canonical reading passage, cue labels/times, privacy language, individual-source review, `Upgrade Input A`, and honest demo/live distinctions. Do not add ranking, “raw,” hardware diagnosis, magical AI language, a score, percentage, or ETA.

## Implementation architecture

- Keep Next.js 16.2 and React 19.2.
- Keep the homepage server-rendered; its visual island is an isolated Client Component.
- Keep real plots as semantic SVG, not 3D.
- Use Motion for finite React-state transitions.
- Use one lightweight code-native canvas field for depth; do not add WebGPU, WebXR, a physics engine, multiple canvases, video, smooth-scroll hijacking, or continuous high-cost effects.
- Keep audio and visualization lifecycles isolated. Never update React state per visual frame.
