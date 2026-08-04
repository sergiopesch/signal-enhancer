# Xeno Signal fidelity ledger

**Review date:** 3 August 2026

**Accepted direction:** [Xeno Signal design system](DESIGN_SYSTEM.md) and the six images in [`concepts/`](concepts)

This ledger compares the accepted alien-instrument direction with the current browser implementation. Product truth, accessibility, and readable signal evidence take precedence over decorative fidelity.

| Fidelity point                   | Accepted intent                                                                                     | Current implementation evidence                                                                                                                                                             | Result                                 |
| -------------------------------- | --------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------- |
| Composition                      | One open void, one dominant chamber, asymmetric evidence rails                                      | The reveal keeps a single selected source and chamber; the result keeps one comparison aperture and one processing ledger. Mobile reorders the same hierarchy instead of shrinking desktop. | Matched                                |
| Typography                       | Newsreader for the human translation, Instrument Sans for narrative, IBM Plex Mono for measurements | Display, interface, and provenance roles remain distinct. Operational labels touched by the responsive pass are at least 10 px and wrap within their containers.                            | Matched                                |
| Color                            | Mineral black, warm bone, Input A ultramarine, Input B/result vermilion                             | The locked palette is unchanged. The reduced atmosphere uses those colors only and never competes with evidence copy.                                                                       | Matched                                |
| Imagery and geometry             | Recovered nonhuman artifact, etched perimeter, restrained signal matter                             | Chamber texture is perimeter-masked on wide screens and suppressed where it could cross text. The 320 px layout keeps the frame geometry but removes nonessential source descriptions.      | Matched with responsive simplification |
| Spatial behavior and interaction | Finite chamber transitions, real signal motion, clear current state                                 | Source switching stops playback; waveform/spectrum/dynamics and original/result controls retain explicit selected states; reduced motion removes ambient movement.                          | Matched                                |

## Above-the-fold copy reconciliation

The runtime keeps the concept's locked headline and product actions while preserving the canonical product language. The reveal uses `One input under the lens.` and the result uses the truthful route-specific heading `A local preview, made visible.` in demo mode. No fake AI claim, quality score, ranking, percentage, or ETA was added.

## Native browser evidence

| State                       | Viewport   | Evidence                                                                      |
| --------------------------- | ---------- | ----------------------------------------------------------------------------- |
| Landing chamber             | 1536 × 960 | [`06-xeno-minimal-home-desktop.jpg`](qa/06-xeno-minimal-home-desktop.jpg)     |
| Individual reveal           | 1536 × 960 | [`07-xeno-minimal-reveal-desktop.jpg`](qa/07-xeno-minimal-reveal-desktop.jpg) |
| Individual reveal           | 390 × 844  | [`08-xeno-minimal-reveal-mobile.jpg`](qa/08-xeno-minimal-reveal-mobile.jpg)   |
| Individual reveal edge case | 320 × 800  | [`09-xeno-minimal-reveal-320.jpg`](qa/09-xeno-minimal-reveal-320.jpg)         |
| Upgrade result              | 390 × 844  | [`10-xeno-minimal-result-mobile.jpg`](qa/10-xeno-minimal-result-mobile.jpg)   |
| Upgrade result / spectrum   | 1536 × 960 | [`11-xeno-minimal-result-desktop.jpg`](qa/11-xeno-minimal-result-desktop.jpg) |

The final QA pass found no document-width overflow at 1536, 390, or 320 px and no browser console warnings or errors.
