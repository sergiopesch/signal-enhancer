# Signal Enhancer fidelity ledger (v1, superseded)

> The current implementation review is [Brand Redesign Fidelity Ledger](brand-redesign/FIDELITY_LEDGER.md). This document is retained as the record for the original concept set. The interaction notes below are reconciled with `guided-reading-v1`; the linked v1 images are historical visual provenance, not current capture or review evidence.

This ledger records the original implementation review against the first visual concepts. It exists to keep design provenance, product honesty, and responsive behavior independently auditable.

## Capture method and asset status

The historical app build was served with `next start`. Browser/IAB capture was unavailable in that environment, so the documented Playwright fallback captured the production build at native CSS viewport sizes with no post-processing:

- Desktop: 1536 × 1024 at device scale factor 1
- Mobile: 393 × 852 at device scale factor 1
- Script: `scripts/capture-implementation.ts`
- Concepts: `docs/design/`
- Historical implementation captures: `docs/implementation/`

The capture script waited for stage animations to finish and restored scroll position before every screenshot. This prevented transient opacity or interaction-driven scrolling from distorting the visual review. Because assets are outside the guided-reading documentation update, refreshed screenshots are still required before this set can represent the current interaction.

## Original direction → current contract

| #   | Visual source                                                                       | Preserved direction                                                                                                                                  | Current product adaptation                                                                                                                                        |
| --- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `design/01-setup-capture.png` → `implementation/01-setup-desktop.png`               | The graphite canvas, restrained dividers, five-step spine, split control/instrument composition, and typographic hierarchy remain useful provenance. | Device fields stay permission-first, while the main surface now shows the full `guided-reading-v1` passage and actual browser-reported labels.                    |
| 2   | Original setup instrument                                                           | A dominant timed instrument, clear ruler, active state, and stable metadata area established the measured-reading composition.                       | The current protocol uses a three-second silent count-in, then room tone at 0–2 s, natural voice at 2–8 s, soft voice at 8–14 s, and a natural finish at 14–20 s. |
| 3   | `design/02-reveal-desktop.png` → `implementation/02-reveal-desktop.png`             | The evidence-first hierarchy, source identity, plot prominence, observations, and upgrade handoff remain valuable.                                   | Individual Input A/Input B tabs show and play only the selected source. Waveform, spectrum, and dynamics use explicit axes, with cue-ranged findings below.       |
| 4   | Original review controls                                                            | Strong primary actions, ruled secondary actions, accessible state, seek, repeat, and view selection survive.                                         | Each completed pass adds listen, retake, and continue recovery; selected-source playback replaces the earlier multi-track control model.                          |
| 5   | `design/03-upgrade-progress.png` → `implementation/03-upgrade-progress-desktop.png` | The named-stage rail, active playhead, telemetry strip, and cancel action preserve the intended processing-room composition.                         | Safe demo mode says “Local DSP route” and “non-AI preview” instead of implying that an unavailable paid GPU path ran.                                             |
| 6   | `design/04-upgrade-result.png` → `implementation/04-upgrade-result-desktop.png`     | The result statement, change record, limitations, processing record, download, and restart affordances retain the concept’s hierarchy.               | **Upgrade Input A** is the explicit handoff, and the demo report names the real browser pipeline instead of claiming certainty about restored information.        |
| 7   | Privacy and retention copy                                                          | Private-by-default language remains visible at capture, upgrade, result, footer, and About surfaces.                                                 | The concept’s seven-day sentence was replaced with the stricter 24-hour live-mode policy; demo audio never leaves the browser.                                    |
| 8   | `design/05-reveal-mobile.png` → `implementation/05-reveal-mobile.png`               | Header, compact stepper, source identity, signal instrument, evidence, and actions retain a clear one-column reading order.                          | The current 393 px target uses native scrolling, 44 px controls, semantic tabs, one selected track, and no horizontal page overflow.                              |

## Current interaction contract

- About behaves as a modal dialog, traps focus, closes with Escape or backdrop activation, locks background scrolling, and restores focus.
- The complete versioned 36-word passage remains visible during preparation, count-in, and both separate 20-second passes.
- Input A and Input B each expose listen, retake, and continue actions after capture.
- The prepared no-permission path loads two synthetic guided-reading captures into the individual-track review.
- Input tabs are keyboard-operable, stop current playback when changed, and render only one source at a time.
- Waveform, spectrum, and dynamics views expose honest time, amplitude, frequency, and dBFS axes plus accessible text.
- Findings identify an exact cue range and measured value, and retain visible limitations around delivery, room, position, distance, and device processing.
- **Upgrade Input A** advances through truthful named stages and resolves to the browser-only result in demo mode.
- The result exposes a downloadable PCM WAV with an explicit filename and a reset path.
- Desktop Chromium and mobile WebKit remain the end-to-end target, including reduced motion and no horizontal page overflow.

## Accepted adaptations

The concepts established direction, not fabricated evidence. The current product therefore favors a repeatable human reading, truthful labels, browser-native device information, single-source inspection, explicit axes and units, cue-ranged limitations, private-by-default behavior, and clear separation between the local demo DSP and the optional Hugging Face route. Those adaptations supersede the historical controls while preserving the authored visual system.
