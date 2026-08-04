# Signal Enhancer documentation

This index separates the current product and brand contracts from historical design material. If a visual reference conflicts with runtime evidence or a product boundary, the product specification and current implementation take precedence.

## Start here

| Document                                                         | Authority                                                                                          |
| ---------------------------------------------------------------- | -------------------------------------------------------------------------------------------------- |
| [Product specification](PRODUCT_SPEC.md)                         | Canonical journey, claim boundaries, privacy promises, success criteria, and deferred scope        |
| [Architecture](ARCHITECTURE.md)                                  | Deployment topology, data flow, trust boundaries, storage, jobs, quotas, and environment contract  |
| [Production runbook](PRODUCTION_RUNBOOK.md)                      | Paid-service decisions, immutable promotion, live verification, cleanup, and rollback              |
| [Audio model strategy](AUDIO_MODEL_STRATEGY.md)                  | Current Hugging Face model decision, challenger matrix, evaluation gates, and runtime truthfulness |
| [Xeno Signal design system](alien-redesign/DESIGN_SYSTEM.md)     | Current palette, typography, chamber geometry, motion, responsive rules, and copy locks            |
| [Xeno Signal fidelity ledger](alien-redesign/FIDELITY_LEDGER.md) | Current concept-to-code comparison and native desktop/mobile browser evidence                      |
| [Worker guide](../worker/README.md)                              | FastAPI contract, configuration, validation limits, local checks, container, and HF deployment     |
| [Security policy](../SECURITY.md)                                | Private reporting, supported version, trust boundaries, secret handling, and data lifetime         |
| [Contributing](../CONTRIBUTING.md)                               | Issue proposals, the paused code-PR policy, and required quality gates                             |

## Current experience contract

- `guided-reading-v1` repeats the same versioned 36-word script in two separate 20-second passes.
- Each pass begins after a three-second silent count-in and follows room tone at 0–2 seconds, natural voice at 2–8 seconds, soft voice at 8–14 seconds, and a natural finish at 14–20 seconds.
- The complete passage stays visible, and each completed capture offers listen, retake, and continue actions.
- Review uses individual Input A/Input B tabs, single-source playback, waveform/spectrum/dynamics views with explicit axes, and cue-ranged measured evidence with conservative limitations.
- The final action is **Upgrade Input A**.

## Current visual evidence

These JPEGs were captured from the current build at native desktop and mobile viewports. They are implementation evidence, not illustrative mockups.

| State                     | Capture                                                                     |
| ------------------------- | --------------------------------------------------------------------------- |
| Landing chamber           | [Desktop JPEG](alien-redesign/qa/06-xeno-minimal-home-desktop.jpg)          |
| Input A individual review | [Desktop JPEG](alien-redesign/qa/07-xeno-minimal-reveal-desktop.jpg)        |
| Input A individual review | [Mobile viewport JPEG](alien-redesign/qa/08-xeno-minimal-reveal-mobile.jpg) |
| Input A edge case         | [320 px viewport JPEG](alien-redesign/qa/09-xeno-minimal-reveal-320.jpg)    |
| Upgrade result            | [Mobile viewport JPEG](alien-redesign/qa/10-xeno-minimal-result-mobile.jpg) |
| Upgrade result / spectrum | [Desktop JPEG](alien-redesign/qa/11-xeno-minimal-result-desktop.jpg)        |

The accepted concept set lives in [`alien-redesign/concepts`](alien-redesign/concepts). Concepts establish authored direction; the current implementation and [Xeno Signal fidelity ledger](alien-redesign/FIDELITY_LEDGER.md) establish product truth.

## Historical material

The following v1 files remain available for provenance only and are explicitly marked superseded:

- [Design System v1](DESIGN_SYSTEM.md)
- [Fidelity ledger v1](FIDELITY_LEDGER.md)
- [Brand System v2](brand-redesign/BRAND_SYSTEM_V2.md)
- [Brand fidelity ledger v2](brand-redesign/FIDELITY_LEDGER.md)
- [`design/`](design) — original concept generation
- [`implementation/`](implementation) — original implementation captures

Do not use the historical colors, typography, screenshots, or layout decisions for new work. New visual work should follow the [Xeno Signal design system](alien-redesign/DESIGN_SYSTEM.md) and be checked against its current [fidelity ledger](alien-redesign/FIDELITY_LEDGER.md).

## Working agreements

- Claims remain descriptive, cautious, and evidence-led: no hardware ranking, “raw signal,” quality score, emulation promise, or certainty about inferred detail.
- The same guided-reading script and cue schedule govern both separate capture passes.
- Individual review shows and plays only the selected source; findings stay tied to a measured cue range and visible limitation.
- Demo mode remains the default and keeps microphone audio in the browser.
- Live mode remains opt-in, private by default, and fail-closed when its infrastructure or secrets are incomplete.
- Accessibility, responsive behavior, truthful progress, and reduced motion are product requirements rather than polish.
- Security concerns are reported privately through the process in [SECURITY.md](../SECURITY.md), never in a public issue.
- Issues and scoped proposals are welcome; code pull requests remain paused until explicit contributor terms are published.

This repository is publicly readable but proprietary. It has no open-source license; see [Source status](../README.md#source-status).
