# Signal Enhancer documentation

This index separates the current product and brand contracts from historical design material. If a visual reference conflicts with runtime evidence or a product boundary, the product specification and current implementation take precedence.

## Start here

| Document                                                   | Authority                                                                                         |
| ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| [Product specification](PRODUCT_SPEC.md)                   | Canonical journey, claim boundaries, privacy promises, success criteria, and deferred scope       |
| [Architecture](ARCHITECTURE.md)                            | Deployment topology, data flow, trust boundaries, storage, jobs, quotas, and environment contract |
| [Brand research](brand-redesign/BRAND_RESEARCH.md)         | Competitive research, positioning, voice principles, and anti-copy guardrails                     |
| [Brand System v2](brand-redesign/BRAND_SYSTEM_V2.md)       | Current phase-aperture identity, palette, typography, layout, interaction, motion, and copy rules |
| [Brand fidelity ledger](brand-redesign/FIDELITY_LEDGER.md) | Concept-to-code comparison, implementation captures, accessibility, and interaction verification  |
| [Worker guide](../worker/README.md)                        | FastAPI contract, configuration, validation limits, local checks, container, and HF deployment    |
| [Security policy](../SECURITY.md)                          | Private reporting, supported version, trust boundaries, secret handling, and data lifetime        |
| [Contributing](../CONTRIBUTING.md)                         | Issue proposals, the paused code-PR policy, and required quality gates                            |

## Current experience contract

- `guided-reading-v1` repeats the same versioned 36-word script in two separate 20-second passes.
- Each pass begins after a three-second silent count-in and follows room tone at 0–2 seconds, natural voice at 2–8 seconds, soft voice at 8–14 seconds, and a natural finish at 14–20 seconds.
- The complete passage stays visible, and each completed capture offers listen, retake, and continue actions.
- Review uses individual Input A/Input B tabs, single-source playback, waveform/spectrum/dynamics views with explicit axes, and cue-ranged measured evidence with conservative limitations.
- The final action is **Upgrade Input A**.

## Current visual evidence

These PNGs were captured from the current production-mode build at native desktop and mobile viewports. They are implementation evidence, not illustrative mockups.

| State                     | Capture                                                                         |
| ------------------------- | ------------------------------------------------------------------------------- |
| Minimal entry             | [Desktop PNG](brand-redesign/implementation/00-home-desktop.png)                |
| Minimal entry             | [Mobile viewport PNG](brand-redesign/implementation/00-home-mobile.png)         |
| Guided-reading setup      | [Desktop PNG](brand-redesign/implementation/01-setup-desktop.png)               |
| Input A individual review | [Desktop PNG](brand-redesign/implementation/02-reveal-desktop.png)              |
| Input B individual review | [Desktop PNG](brand-redesign/implementation/02-reveal-input-b-desktop.png)      |
| Upgrade in progress       | [Desktop PNG](brand-redesign/implementation/03-upgrade-progress-desktop.png)    |
| Upgrade result            | [Desktop PNG](brand-redesign/implementation/04-upgrade-result-desktop.png)      |
| Individual review         | [Mobile viewport PNG](brand-redesign/implementation/05-reveal-mobile.png)       |
| Full responsive document  | [Mobile full-page PNG](brand-redesign/implementation/06-reveal-mobile-full.png) |

The coordinated concept set lives in [`brand-redesign/concepts`](brand-redesign/concepts). Concepts establish authored direction; the current implementation and [fidelity ledger](brand-redesign/FIDELITY_LEDGER.md) establish product truth.

## Historical material

The following v1 files remain available for provenance only and are explicitly marked superseded:

- [Design System v1](DESIGN_SYSTEM.md)
- [Fidelity ledger v1](FIDELITY_LEDGER.md)
- [`design/`](design) — original concept generation
- [`implementation/`](implementation) — original implementation captures

Do not use v1 colors, typography, screenshots, or layout decisions for new work. New visual work should follow [Brand System v2](brand-redesign/BRAND_SYSTEM_V2.md) and be checked against the current implementation.

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
