# Signal Enhancer — Design System (v1, superseded)

> The current identity and interface specification is [Brand System v2](brand-redesign/BRAND_SYSTEM_V2.md). This document is retained as a record of the original acoustic-observatory direction. Its component and copy notes below have been reconciled with `guided-reading-v1` so historical visual material cannot be mistaken for the current capture or review contract.

## Accepted concept set

- `docs/design/01-setup-capture.png` — historical setup composition
- `docs/design/02-reveal-desktop.png` — historical desktop review composition
- `docs/design/03-upgrade-progress.png` — durable processing state
- `docs/design/04-upgrade-result.png` — final result and report
- `docs/design/05-reveal-mobile.png` — historical responsive review composition

These images define the visible hierarchy, density, palette, typography character, controls, and container model. App controls and data visualization remain code-native.

## Visual idea

The interface is an **acoustic observatory**: a quiet, precise instrument where signals pass through calibrated gates. It is editorial and restrained, not cyberpunk. Motion comes from playheads, waveform progression, scan lines, and state transitions rather than ambient decoration.

## Color lock

The background is cool near-black graphite, never cream, warm gray, or a colorful gradient.

| Token             | Value     | Role                               |
| ----------------- | --------- | ---------------------------------- |
| `--canvas`        | `#050b0f` | page background                    |
| `--canvas-raised` | `#091116` | selected/raised control            |
| `--surface`       | `#0b1217` | restrained framed instruments      |
| `--ink`           | `#f2f0ec` | primary text                       |
| `--ink-muted`     | `#aaa8a4` | explanatory text                   |
| `--ink-faint`     | `#74787a` | timestamps and inactive steps      |
| `--rule`          | `#303a3f` | borders and measurement rules      |
| `--rule-soft`     | `#1c272d` | internal dividers                  |
| `--signal-a`      | `#43c4df` | primary cyan signal and focus      |
| `--signal-a-soft` | `#1d6c7b` | secondary cyan trace               |
| `--signal-b`      | `#f0b400` | Input B / active processing signal |
| `--danger`        | `#ee776d` | destructive/capture failure only   |

No glow is used as decoration. A small controlled halo is allowed only around a live recording marker or active processing gate.

## Typography

- UI/content: Geist Sans, variable, self-hosted through `next/font`.
- Measurements: Geist Mono, variable, self-hosted through `next/font`.
- Display: 48/52 desktop, 36/40 mobile, weight 520–600, slight negative tracking.
- Section heading: 24/30 desktop, 22/28 mobile, weight 560.
- Body: 18/27 desktop, 16/24 mobile.
- Control: 15/20 desktop, 16/22 mobile; never browser default.
- Measurement/label: 12–14/18, mono, restrained uppercase only for true instrument labels.

## Spacing and geometry

- Desktop content gutter: 40–48 px.
- Mobile content gutter: 16 px.
- Major vertical rhythm: 64, 48, 32, 24, 16, 12, 8, 4 px.
- Controls: 48 px desktop; at least 44 px touch target on mobile.
- Radius: 6 px controls, 8 px instrument frames. No pill-shaped controls.
- Borders: 1 px precise rules. Shadows are nearly absent.
- Container model: open canvas, rails, ruled bands, and one purposeful instrument frame. Avoid nested cards and bento grids.

## Component families

- `SignalMark` — compact waveform brand mark.
- `ExperimentStepper` — five-stage desktop and compact mobile variants.
- `DeviceSelector` — browser-reported label, input kind, confirmation, and uncertainty.
- `ReadingGuide` — full 36-word passage, four timed cues, silent practice, count-in, and active phrase.
- `CaptureStage` — one 20-second pass with listen, retake, and continue recovery controls.
- `TrackSelector` — keyboard-operable Input A/Input B tabs; selecting a tab stops current playback.
- `TransportControls` — play/pause and seek for the selected source only.
- `ViewTabs` — Waveform/Spectrum/Dynamics.
- `SignalPlot` — accessible SVG with honest time, amplitude, frequency, and dBFS axes plus a text summary and reduced-motion mode.
- `TrackInsights` — cue-ranged measured evidence and conservative limitations in ruled editorial groups; never metric-card scoring.
- `UpgradeStageRail` — semantic live stage list with completed/current/future states.
- `ProcessingRecord` — compact provenance list, not a settings surface.
- `PrimaryAction` and `SecondaryAction` — cyan filled and ruled dark variants.

## Icon inventory

Use one coherent 1.5 px rounded-stroke family. Lucide may be used only where its metaphor and optical weight match.

| Icon                 | Meaning                 | Treatment                                                          |
| -------------------- | ----------------------- | ------------------------------------------------------------------ |
| waveform mark        | brand/signal            | custom SVG, cyan, no container                                     |
| microphone           | selected input          | outline, 18–20 px                                                  |
| headphones           | headset input           | outline, 18–20 px                                                  |
| chevron down         | selector disclosure     | outline, 16 px                                                     |
| check circle         | confirmed/completed     | outline, semantic signal color                                     |
| play/pause           | transport               | filled triangle / outlined pause within circular primary transport |
| skip previous/next   | transport               | outline/filled hybrid matching concept                             |
| repeat               | restart captures        | outline, 18 px                                                     |
| download             | enhanced WAV            | outline, 18 px                                                     |
| info                 | limitation/privacy note | outline, 16 px                                                     |
| analysis-stage icons | workflow stages         | restrained outline, 18 px; no decorative substitutions             |

## Motion

- 160 ms controls, 260 ms panels, 420–600 ms waveform/state reveals.
- Use opacity and transform on wrappers; do not animate complex SVG paths every frame.
- The active capture gate and processing scan line may move linearly.
- Respect `prefers-reduced-motion`; all information remains visible without animation.

## Responsive rules

- At 960 px, the left setup/control rail moves above the instrument.
- At 720 px, the stepper becomes a compact horizontally fitted track; labels shorten only to `A` and `B` where necessary.
- Plots preserve a minimum internal width and may use horizontal scrubbing instead of unreadable label compression.
- Observation rails become a vertical list separated by rules.
- Actions remain in document flow and never cover the plot or report.
- Mobile controls use 44 px minimum touch targets and 16 px minimum body/control text.

## Above-the-fold copy lock

Setup state may show only:

- Signal Enhancer
- About
- Reading / Input A / Input B / Review / Upgrade
- Prepare your reading.
- Read the same short passage into Input A, then Input B. Keep your position, distance, and speaking style steady.
- Input A is the recording Signal Enhancer will upgrade.
- Choose your inputs
- Input A / Input B
- browser-reported device names
- Confirm device
- Reading passage
- Practice the timing
- Room tone, 0–2 s / Natural voice, 2–8 s / Soft but clear, 8–14 s / Natural finish, 14–20 s
- Beyond the quiet room, clear voices travel through glass and open air. Soft rain settles; small clocks click, and each calm breath leaves a trace. Finish this final line at your natural pace, with steady energy.
- Begin Input A
- 20 seconds · WAV · stays on this device until you upgrade

No hero eyebrow, badge, fake proof point, metric, or additional product claim may be added.

## Concept clarification

One generated reveal concept contains the temporary phrase “saved for 7 days.” The product privacy decision supersedes it: production copy is **“Session audio expires after 24 hours.”**
