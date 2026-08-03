# Signal Enhancer — Brand Redesign Fidelity Ledger

Review date: 3 August 2026

Accepted direction: **Calibrated Editorial Instrument / Spectral Cartography**

This ledger compares the accepted ImageGen concepts with the production implementation. The concepts define composition, hierarchy, material, and responsive intent. Runtime evidence, device labels, signal traces, controls, and progress remain code-native and truthful.

## Capture method

The app was built with `npm run build` and served with `next start`. The in-app browser capture tool was unavailable in this environment, so the documented Playwright fallback captured the production build at device scale factor 1 with no post-processing.

- Desktop implementation: `1536 × 1024`
- Mobile viewport implementation: `393 × 852`
- Mobile full-page implementation: `393 × 2037`
- Desktop concepts: `1487 × 1058`
- Mobile concept: `852 × 1846`
- Capture script: `scripts/capture-implementation.ts`
- Concepts: `docs/brand-redesign/concepts/`
- Implementation captures: `docs/brand-redesign/implementation/`

Every accepted concept and the latest matching implementation capture was inspected at native resolution in the same QA pass.

## Explicit comparisons

| #   | Concept → implementation   | Fidelity result                                                                                                                                                                                                                         | Deliberate difference                                                                                                                                                        |
| --- | -------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Identity and header        | The phase-aperture mark, calm serif wordmark, mineral shell, hairline rule, and quiet About action carry across every state and breakpoint.                                                                                             | The mark is a compact code-native SVG so it stays sharp, themeable, and accessible instead of shipping a raster crop.                                                        |
| 2   | Typography and voice       | Newsreader supplies the editorial display voice, Instrument Sans carries interface and narrative copy, and IBM Plex Mono is reserved for measurement, state, and provenance. Sentence case and neutral evidence language are preserved. | Runtime copy never adopts the concept’s decorative abbreviations where the full product label is clearer.                                                                    |
| 3   | Palette and material       | Mineral black, warm bone paper, ultramarine Input A, vermilion Input B, and graphite Difference reproduce the concept without gradients, glow, glass, or ornamental shadows.                                                            | Accessible darker A/B inks are used on the warm paper where the brighter shell colors would lose contrast.                                                                   |
| 4   | Five-stage experiment rail | The numbered five-gate spine remains stable from setup through result; completed, active, and future states combine labels, symbols, rules, and contrast. Mobile uses `Ref / A / B / Reveal / Up`.                                      | Code uses semantic buttons and the actual reachable state instead of concept-only status ornament.                                                                           |
| 5   | Reveal composition         | The two-line editorial conclusion, compact evidence rail, dominant calibration plate, ruled source controls, and observations ledger reproduce the desktop hierarchy.                                                                   | The implementation trace is generated from the real deterministic captures. It is intentionally less pictorial than the concept waveform.                                    |
| 6   | Calibration plate          | Five named regions, A/B/Difference tracks, shared time ruler, registration marks, evidence strip, and stable transport position are present in desktop and mobile variants.                                                             | `diagnostic-speech-v1`, real duration, actual sample rate, current view, and actual playhead replace the illustrative `SE–001` metadata and decorative speed control.        |
| 7   | Upgrade progress           | The named processing ledger, live status copy, paired traces, and moving gate make the active stage visible without a fabricated percentage or ETA.                                                                                     | The safe route is identified as a local browser DSP preview; the UI does not imply a remote AI model ran when it did not.                                                    |
| 8   | Upgrade result             | The serif result statement, comparison plate, change record, limitations, processing receipt, download, and restart actions match the concept’s evidence-first hierarchy.                                                               | The output chart remains the same working instrument used elsewhere, and the receipt exposes the real `browser-v1` pipeline rather than a concept illustration.              |
| 9   | Mobile reveal              | The custom single-column plot, compact source key, segmented controls, source transport, observations, upgrade action, privacy note, and footer fit a `393 px` viewport without horizontal page scrolling.                              | The mobile chart is a purpose-built SVG geometry, not a scaled or horizontally scrolled desktop plate. The native browser viewport is shown without synthetic device chrome. |

## Above-the-fold copy diff

| Surface              | Accepted copy                                                                                   | Shipped copy                     | Result |
| -------------------- | ----------------------------------------------------------------------------------------------- | -------------------------------- | ------ |
| Reveal title         | “Same sound. Different ears.”                                                                   | “Same sound. Different ears.”    | Exact  |
| Reveal premise       | “Two input chains, held against the same reference. Explore what changed—not which one won.”    | Same                             | Exact  |
| Upgrade result title | “A local preview, made visible.”                                                                | “A local preview, made visible.” | Exact  |
| Upgrade disclosure   | “Fixed filters and restrained dynamics shaped this browser-only preview; no AI model was used.” | Same                             | Exact  |

Concept-only device names, observations, timestamps, and signal shapes were never treated as locked copy. The shipped interface reports browser-provided device labels, computed findings, actual playback time, and the deterministic source version. No ranking, quality score, unsupported restoration claim, or invented hardware is introduced.

## Interaction verification

- About opens as a modal dialog, traps focus, closes on Escape or backdrop activation, locks background scrolling, and restores focus to its trigger.
- The prepared comparison loads both deterministic inputs without requesting microphone access.
- Absolute/loudness-matched mode and waveform/spectrum/dynamics views update semantic state and their signal figures.
- Input A, Input B, and synchronized playback use the shared transport and seek position.
- Repeat captures resets the comparison path without a reload.
- Upgrade exposes real named stages, resolves to the browser-only result, supports A/B comparison, downloads a PCM WAV, and starts a new experiment.
- Desktop Chromium and mobile WebKit complete the end-to-end journey without horizontal page overflow.
- Reduced-motion users retain every state while nonessential transitions and drawing motion are removed.

## Corrections made during fidelity review

- Replaced generic horizontal stepper bars with numbered vertical gates and hairlines.
- Removed signal glow and decorative SVG filtering.
- Corrected a mobile layout collapse that reduced the signal plate to five pixels.
- Built separate responsive SVG geometry so track labels, segment guides, time ruler, and evidence remain legible on mobile.
- Compacted the desktop reveal source rail so the calibration plate aligns with the narrative title.
- Moved the result statement across the report width and stacked its comparison controls to preserve a clean first fold.
- Restored mobile source-skip controls and kept the retention/privacy statement visible near the conversion action.
- Corrected the 20-second ruler to `0:00–0:20` notation, raised small-text color contrast above WCAG AA, restored a 44 × 44 mobile About target, and added a polite live processing status.

## Accepted principle

The concepts establish the authored instrument; the implementation establishes the product truth. Where those goals conflict, Signal Enhancer favors real data, explicit method, disclosed limitations, stable interaction, and private-by-default behavior.
