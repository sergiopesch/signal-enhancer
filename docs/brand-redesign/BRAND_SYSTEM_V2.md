# Signal Enhancer — Brand System v2

## Accepted concept set

- `concepts/01-reference-desktop.png` — historical setup composition
- `concepts/02-reveal-desktop.png` — historical desktop review composition
- `concepts/03-upgrade-progress-desktop.png` — transparent named-stage processing
- `concepts/04-upgrade-result-desktop.png` — result and processing receipt
- `concepts/05-reveal-mobile.png` — historical responsive review composition

The concepts define hierarchy, density, palette, geometry, and responsive intent. Product data, SVG plots, controls, and the final mark remain code-native. Where a concept shows the retired played-reference or combined-track interface, the current `guided-reading-v1` product contract below takes precedence.

## Core idea

**Calibrated Editorial Instrument / Spectral Cartography**

Signal Enhancer behaves like a premium scientific publication turned into an audio instrument. Warm measurement plates make the evidence feel collected and inspectable. A quiet mineral shell makes space for the signal. Registration marks, fine rulers, and provenance communicate method without terminal cosplay.

## Identity

### Mark

The mark is a **phase aperture**:

- two offset traces approach a narrow vertical capture gate;
- they cross the plane and leave with a visible relationship;
- the blue and vermilion paths receive equal visual weight;
- at 16 px, it reduces to two stepped paths and one white aperture;
- it is never animated without measured signal state.

It is not a waveform, equalizer, speaker, microphone, sparkle, or `SE` letter monogram.

### Wordmark

Use the display serif in title case. Avoid wide tracking, all caps, and technical suffixes. The wordmark remains calm; the mark carries the experiment.

## Color

| Token             | Value     | Role                                    |
| ----------------- | --------- | --------------------------------------- |
| `--canvas`        | `#0b0b0a` | mineral-black application shell         |
| `--canvas-raised` | `#111210` | selected dark control / raised shell    |
| `--surface`       | `#151613` | restrained dark instruments and dialogs |
| `--paper`         | `#e9e4d9` | calibration plate                       |
| `--paper-soft`    | `#f2eee5` | primary warm bone / paper highlight     |
| `--paper-ink`     | `#171714` | plot and plate text                     |
| `--ink`           | `#f2eee5` | primary shell text                      |
| `--ink-muted`     | `#b7b1a7` | explanatory copy                        |
| `--ink-faint`     | `#85827a` | future state and metadata               |
| `--rule`          | `#484842` | shell rules                             |
| `--rule-soft`     | `#292a26` | quiet internal separators               |
| `--paper-rule`    | `#aaa59b` | calibration-plate rules                 |
| `--signal-a`      | `#5f88ff` | Input A and focus                       |
| `--signal-a-ink`  | `#2b54bd` | accessible Input A on paper             |
| `--signal-b`      | `#ff654a` | Input B and transformation gate         |
| `--signal-b-ink`  | `#a83224` | accessible Input B on paper             |
| `--danger`        | `#f3c969` | warnings only; never A/B identity       |

Rules:

- A/B color is functional and always paired with a label, marker, or line style.
- The shell is nearly monochrome before a comparison exists.
- No decorative gradient, glow, or ambient color field.
- Warm paper is reserved for the main measurement surface, not every container.

## Typography

- **Display and conclusions:** Newsreader, variable serif.
- **Interface and narrative:** Instrument Sans, variable sans.
- **Measurements and provenance:** IBM Plex Mono, regular/medium.

Scale:

- Display: 44–56 px desktop, 38–46 px mobile, `0.98–1.04` line height.
- Section heading: 26–34 px serif or 20–24 px sans according to role.
- Body: 16–18 px desktop, 16–18 px mobile.
- Control: 15–16 px, 44 px minimum target.
- Evidence: 11–13 px mono, tabular numerals, sentence case where space permits.

Uppercase is reserved for genuinely compact instrument labels. Paragraphs and action labels remain sentence case.

## Layout

- Desktop shell gutter: 30–48 px.
- Mobile gutter: 20–24 px.
- Main layouts use an asymmetric narrative rail plus one dominant calibration plate.
- Registration marks and ruler ticks terminate surfaces; they do not become a page-wide grid.
- The five-step progress rail uses numbered gates and hairlines, not circular stepper bubbles.
- Containers have `0–3 px` radius. Dialogs may use up to `6 px` where focus separation requires it.
- Shadows are absent. Separation comes from value, rules, and space.

### Entry threshold

The public homepage is an **aperture foyer** rather than a compressed experiment screen:

- one wordmark, one premise, one primary action, and one privacy assurance;
- generous negative space around a single finite phase-aperture signal horizon;
- no workflow stepper, device selectors, permission request, calibration plate, metadata ledger, transport, or application footer before entry;
- `/lab` is the explicit boundary where the working instrument and audio client begin.

Homepage motion draws the finite signal horizon once and then becomes still. The phase-aperture mark is never animated, no sound autoplays, and reduced-motion users receive the settled composition immediately.

### Guided-reading protocol

- `guided-reading-v1` uses the same versioned 36-word script for Input A and Input B in two separate 20-second passes.
- A three-second silent count-in precedes each pass; the stored capture begins after the count-in.
- The reading plate keeps the complete passage visible while highlighting room tone at 0–2 seconds, natural voice at 2–8 seconds, soft voice at 8–14 seconds, and a natural finish at 14–20 seconds.
- Each completed pass exposes listen, retake, and continue actions before the experiment advances.
- Input A is identified before capture as the source for **Upgrade Input A**.

## Component behavior

### Calibration plate

The ivory plate is the primary working surface. In individual review it contains:

- four guided-reading cue labels and their exact time ranges;
- one selected Input A or Input B trace;
- waveform, spectrum, and dynamics tabs with explicit axis units;
- registration corners and precise bounding rules;
- an evidence strip for protocol, duration, sample rate, and current view;
- a single-source transport band in the same stable location.

### Evidence ledger

Findings are ruled statements, not metric cards. Every finding includes:

1. an exact guided-reading time range;
2. neutral observed language and a measured digital value;
3. a visible qualification for method and interpretation.

The three groups—**What held up**, **Worth inspecting**, and **Measured context**—never become a quality score. Voice delivery, distance, position, room sound, and browser or device processing remain visible limitations.

### Controls

- Primary controls use a strong filled or high-contrast ruled treatment.
- Input A/Input B controls are semantic tabs. Switching tabs stops playback before selecting the next source, so only one recording is heard or plotted at a time.
- Selected tabs are indicated by contrast, underline/rule, and `aria-selected`, never color alone.
- Disabled states retain legible labels and expose why the action is unavailable in nearby copy.

### Progress

- Show only backend-emitted or deterministic local stages.
- No fabricated percentage or ETA.
- Completed, active, and future states combine icon/shape, label, and contrast.
- The active processing gate aligns to the signal field.

## Motion

- Controls: `160–220 ms`.
- Panel/state transitions: `240–320 ms`.
- Evidence draw or settling: `600–900 ms`, once per reveal.
- The playback cursor follows the selected source’s real audio.
- Processing scan follows the named current stage.
- No pulsing logo, ambient waveform drift, particles, or perpetual equalizer bars.
- `prefers-reduced-motion` removes nonessential transforms and drawing animation while retaining every state.

## Accessibility

- 44 px minimum interactive targets on touch.
- 2 px focus ring with 3 px separation from component edges.
- Text summaries and accessible names for every signal plot.
- Input identity uses text and trace treatment as well as color.
- Keyboard playback remains available and visible where useful.
- Dialogs trap focus, close on Escape, and restore focus.
- Live processing uses a polite live region.
- Plate text and traces meet readable contrast against warm paper.

## Copy lock

The existing product specification remains authoritative. The redesign does not add unsupported marketing claims, performance scores, AI magic, ranking language, or decorative proof points. Runtime metadata uses `guided-reading-v1`, the actual 20-second duration, capture sample rate, selected view, and current playhead. **Upgrade Input A** is the only upgrade action.

## Concept generation record

Mode: built-in ImageGen, new generation with coordinated prior-image references.

Native desktop renders: `1487 × 1058`.

Native mobile render: `852 × 1846`.

Prompts specified the complete product state, canonical copy, fixed palette, typography roles, layout proportions, explicit anti-patterns, and code-feasible React/CSS/SVG behavior. Later states used the minimum recent concept context needed to preserve the system.
