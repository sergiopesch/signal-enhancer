# Signal Enhancer fidelity ledger (v1, superseded)

> The current implementation review is [Brand Redesign Fidelity Ledger](brand-redesign/FIDELITY_LEDGER.md). This document is retained as the record for the original concept set.

This ledger records the implementation review against the accepted visual concepts. It exists to keep design fidelity, product honesty, and responsive behavior independently auditable.

## Capture method

The app was built with `npm run build` and served with `next start`. Browser/IAB capture was unavailable in this environment, so the documented Playwright fallback captured the production build at native CSS viewport sizes with no post-processing:

- Desktop: 1536 × 1024 at device scale factor 1
- Mobile: 393 × 852 at device scale factor 1
- Script: `scripts/capture-implementation.ts`
- Concepts: `docs/design/`
- Implementation captures: `docs/implementation/`

The capture script waits for stage animations to finish and restores scroll position before every screenshot. This prevents transient opacity or click-driven scrolling from distorting the comparison.

## Explicit comparisons

| #   | Concept → implementation                                                            | Fidelity result                                                                                                                                                                         | Deliberate mismatch or decision                                                                                                                         |
| --- | ----------------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | `design/01-setup-capture.png` → `implementation/01-setup-desktop.png`               | The graphite canvas, cyan signal, amber progress state, restrained dividers, five-step experiment spine, split control/instrument composition, and typographic hierarchy are preserved. | Device fields remain permission-first and show browser-reported labels instead of invented hardware.                                                    |
| 2   | Setup reference instrument                                                          | The same five timed regions, transport hierarchy, legends, time ruler, and large waveform field are implemented as a functional SVG instrument.                                         | “Quiet voice” and “Loud voice” became “Quiet probe” and “Loud probe” because the deterministic source is speech-shaped but not intelligible speech.     |
| 3   | `design/02-reveal-desktop.png` → `implementation/02-reveal-desktop.png`             | The left playback rail, top comparison controls, waveform/spectrum/dynamics switch, A/B/difference encoding, observations, and upgrade handoff follow the concept closely.              | Tracks are vertically separated instead of overlaid so differences remain readable with dense real samples and keyboard zoom is unnecessary.            |
| 4   | Reveal controls and states                                                          | Absolute/loudness-matched switching, all three visual views, synchronized A/B playback, repeat, seek, and upgrade are implemented controls rather than decorative concept elements.     | Demo device names explicitly say “demonstration”; no device quality ranking is introduced.                                                              |
| 5   | `design/03-upgrade-progress.png` → `implementation/03-upgrade-progress-desktop.png` | The seven-stage rail, mirrored gates, active amber playhead, source/preview plot, telemetry strip, and cancel action match the intended processing-room composition.                    | Safe demo mode says “Local DSP route” and “non-AI preview” instead of implying that the unavailable paid GPU path ran.                                  |
| 6   | `design/04-upgrade-result.png` → `implementation/04-upgrade-result-desktop.png`     | The original/enhanced/difference report, view tabs, A/B comparison, change record, limitations, download, and restart affordance retain the concept’s hierarchy.                        | The title becomes “A local preview, made visible” in demo mode, and the report names the exact fixed filters rather than claiming restored information. |
| 7   | Privacy and retention copy                                                          | Private-by-default language remains visible at capture, upgrade, result, footer, and About surfaces.                                                                                    | The concept’s seven-day sentence was replaced with the stricter 24-hour live-mode policy; demo audio never leaves the browser.                          |
| 8   | `design/05-reveal-mobile.png` → `implementation/05-reveal-mobile.png`               | Header, compact stepper, device key, two segmented controls, and scrollable signal report reflow into one column without horizontal page overflow.                                      | The production capture uses a real 393 × 852 CSS viewport without synthetic phone chrome; content below the fold is reached by normal scrolling.        |

## Interaction verification

- About opens as a modal dialog, traps focus, closes with Escape or backdrop activation, locks background scrolling, and restores focus.
- The prepared comparison loads both deterministic inputs without requesting microphone access.
- Loudness matching and waveform, spectrum, and dynamics views update their accessible signal figures.
- Upgrade progress advances through the seven named stages and resolves to the browser-only result in demo mode.
- The result exposes a downloadable PCM WAV with an explicit filename and a reset path.
- The complete journey passes in desktop Chromium and mobile WebKit.

## Accepted differences

The concepts established direction, not fabricated evidence. Production therefore favors truthful labels, browser-native device information, private-by-default behavior, real interactive SVG plots, and explicit separation between the local demo DSP and the optional Hugging Face AI route. Those differences are intentional improvements to the product contract rather than unfinished visual work.
