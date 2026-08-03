# Signal Enhancer — Brand Redesign Fidelity Ledger

Review date: 3 August 2026

Accepted direction: **Calibrated Editorial Instrument / Spectral Cartography**

This ledger records how the accepted ImageGen direction maps to the current product. Concepts define composition, hierarchy, material, and responsive intent. Runtime evidence, device labels, signal traces, controls, and progress remain code-native and truthful.

## Capture method

The existing image set was built with `npm run build` and served with `next start`. The in-app browser capture tool was unavailable in that environment, so the documented Playwright fallback captured the production build at device scale factor 1 with no post-processing.

- Homepage desktop implementation: `1536 × 1024`
- Homepage mobile implementation: `393 × 852`
- Instrument desktop implementation: `1536 × 1024`
- Instrument mobile viewport implementation: `393 × 852`
- Mobile full-page implementation: `393 × 2037`
- Desktop concepts: `1487 × 1058`
- Mobile concept: `852 × 1846`
- Capture script: `scripts/capture-implementation.ts`
- Concepts: `docs/brand-redesign/concepts/`
- Current implementation captures: `docs/brand-redesign/implementation/`

Every accepted concept and current matching implementation capture was inspected at native resolution in the same guided-reading QA pass. The set includes separate desktop evidence for the selected Input A and Input B tabs plus the responsive mobile review.

## Explicit comparisons

| #   | Concept → current product     | Fidelity result                                                                                                                                                                                         | Intentional adaptation                                                                                                                                                 |
| --- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | Minimal entry threshold       | The public root keeps the identity, canonical premise, one action, one assurance, and authored negative space around a finite signal horizon.                                                           | The full experiment begins at `/lab`; device enumeration, workflow chrome, the reading plate, and the audio client remain deferred until entry.                        |
| 2   | Identity and header           | The dual-signal enhancement-gate mark, calm serif wordmark, mineral shell, hairline rule, and quiet About action carry across instrument states and breakpoints.                                        | The mark is a compact code-native SVG so it stays sharp, themeable, and accessible instead of shipping a raster crop.                                                  |
| 3   | Typography and voice          | Newsreader supplies the editorial display voice, Instrument Sans carries interface and narrative copy, and IBM Plex Mono is reserved for measurement, state, and provenance.                            | Runtime copy expands decorative abbreviations where a complete cue, unit, or limitation is clearer.                                                                    |
| 4   | Palette and material          | Mineral black, warm bone paper, ultramarine Input A, vermilion Input B, and graphite annotations preserve the concept without gradients, glow, glass, or ornamental shadows.                            | Accessible darker A/B inks are used on warm paper where brighter shell colors would lose contrast.                                                                     |
| 5   | Reading setup                 | The dominant paper surface now presents the complete versioned 36-word passage, silent timing practice, four cue ranges, and protocol metadata.                                                         | The user speaks the controlled source; the product no longer asks them to play or record a synthetic probe.                                                            |
| 6   | Sequential capture            | Input A and Input B each receive a three-second silent count-in followed by one 20-second guided pass. The active phrase is highlighted while the full passage remains visible.                         | After each pass, explicit listen, retake, and continue controls replace automatic advancement.                                                                         |
| 7   | Individual review             | Semantic Input A/Input B tabs preserve equal visual weight while showing and playing only the selected source. Switching tabs stops current playback.                                                   | The concept’s combined calibration plate is replaced by a one-track-at-a-time review to prevent accidental masking and implied ranking.                                |
| 8   | Signal evidence               | Waveform, spectrum, and dynamics remain code-native SVG views with real capture data, cue bands, time or frequency axes, dBFS/amplitude units, metadata, and a stable transport position.               | Recorded level remains untouched; the review does not visually equalize two captures before the user inspects them.                                                    |
| 9   | Findings ledger               | Cue-ranged findings retain the ruled editorial hierarchy and expose a measured value, threshold context, and jump-to-time action.                                                                       | **What held up**, **Worth inspecting**, and **Measured context** describe one recording and carry visible room, delivery, position, and device-processing limitations. |
| 10  | Upgrade and responsive intent | **Upgrade Input A**, named processing states, privacy copy, and the result record keep the evidence-first conversion path. The reading and review surfaces reflow to one column without hidden content. | Current Input A, Input B, and mobile review captures demonstrate the selected-source state and responsive reading order without synthetic device chrome.               |

## Current copy contract

| Surface                | Required copy or meaning                                                                                                             |
| ---------------------- | ------------------------------------------------------------------------------------------------------------------------------------ |
| Landing premise        | Two input chains receive the same guided 20-second reading protocol without ranking either.                                          |
| Setup title            | “Prepare your reading.”                                                                                                              |
| Setup instruction      | Read the same short passage into Input A, then Input B; keep position, distance, and speaking style steady.                          |
| Upgrade disclosure     | Input A is identified before capture as the recording Signal Enhancer will upgrade.                                                  |
| Protocol metadata      | `guided-reading-v1` · 20.0 s · 36 words · version 1.0.0                                                                              |
| Capture recovery       | Explicit **Listen**, **Retake**, and **Continue** decisions for each completed pass.                                                 |
| Review title           | “One input under the lens.”                                                                                                          |
| Review method          | “Same script · two separate passes”; only the selected recording is shown or played.                                                 |
| Review qualification   | Delivery, distance, position, room sound, and browser/device processing can affect the measurement and prevent a hardware diagnosis. |
| Primary upgrade action | “Upgrade Input A”                                                                                                                    |

Concept-only device names, observations, timestamps, and signal shapes are not locked copy. The interface reports browser-provided device labels, computed findings, actual playback time, and the real protocol identifier. No ranking, quality score, unsupported restoration claim, or invented hardware is introduced.

## Interaction contract

- The server-rendered homepage loads without the lab audio client or device enumeration, exposes one keyboard-reachable action, and enters `/lab` through native navigation.
- The setup surface exposes the complete 36-word passage and a silent practice timeline without recording or playing reference audio.
- Each pass uses a three-second count-in and the fixed 0–2, 2–8, 8–14, and 14–20 second cue schedule.
- Completed Input A and Input B captures each expose **Listen**, **Retake**, and **Continue** decisions before advancing.
- The prepared no-permission path loads two synthetic guided-reading captures into the same individual-track review.
- Input tabs implement semantic tab behavior; changing the selected input stops playback and never starts the other source automatically.
- Waveform, spectrum, and dynamics tabs update semantic state, a single-source figure, labelled axes, and the text alternative.
- Cue and finding controls move the shared selected-source playhead to an exact evidence range.
- Repeat captures resets the guided-reading path without a reload.
- **Upgrade Input A** exposes real named stages, resolves to the browser-only result in demo mode, downloads a PCM WAV, and can start a new experiment.
- Desktop and mobile layouts must complete the journey without horizontal page overflow.
- Reduced-motion users retain every state while nonessential transitions and drawing motion are removed.

## Corrections embodied by the current contract

- Replaced played diagnostic material with the same visible, versioned 36-word reading script across two separate passes.
- Added a silent three-second count-in and four stable cue ranges to both captures.
- Added listen, retake, and continue recovery after each completed pass.
- Replaced the combined review plate with individual Input A/Input B tabs and single-source playback.
- Reduced the review views to waveform, spectrum, and dynamics with explicit axes and units.
- Bound every observation to a cue range, measured value, published threshold, and conservative limitation.
- Made **Upgrade Input A** explicit before capture and at the final action.
- Preserved the enhancement-gate identity, warm measurement surface, semantic controls, responsive rules, contrast, and reduced-motion behavior.

## Accepted principle

The concepts establish the authored instrument; the implementation establishes the product truth. Where those goals conflict, Signal Enhancer favors real data, explicit method, disclosed limitations, stable interaction, and private-by-default behavior.
