# Contributing to Signal Enhancer

Thank you for helping make Signal Enhancer more truthful, private, accessible, and useful. Issues and carefully scoped proposals are welcome during the public preview.

> [!IMPORTANT]
> Code pull requests are temporarily paused while contributor terms are established. Please open an issue for discussion, but do not submit code until this policy is replaced with explicit contribution terms. The standards below govern maintainer work now and future contributions when code review reopens.

## Before proposing a change

1. Read the [product specification](docs/PRODUCT_SPEC.md), [architecture](docs/ARCHITECTURE.md), and [Brand System v2](docs/brand-redesign/BRAND_SYSTEM_V2.md).
2. Search existing issues for overlapping work.
3. Open an issue first for a new dependency, integration, processing model, data-retention change, large interaction change, or live-infrastructure change.
4. Wait for the maintainer to confirm scope and publish applicable contributor terms before beginning a code contribution.

## Product truth

Signal Enhancer compares evidence; it does not judge hardware. Contributions must preserve these boundaries:

- Do not rank, score, or declare one input “better” or “worse.”
- Do not promise access to a raw signal or claim that missing detail was recovered with certainty.
- Do not imply microphone, brand, or premium-hardware emulation.
- Label observed, calculated, inferred, local, and remotely processed results accurately.
- Display only deterministic local stages or real backend-emitted progress. Do not invent percentages or ETAs.
- Keep concept-only device names, measurements, and traces out of runtime claims.

Copy should be calm, precise, and useful to a non-specialist. Prefer “shows,” “carries,” or “may reflect” over causal claims that the data cannot support.

## Privacy and security

- Safe demo mode must remain the default. It must work without cloud audio services and must not describe the local DSP preview as AI restoration.
- No microphone audio may leave the browser before the user explicitly presses **Upgrade Signal**.
- Live mode must fail closed when any required database, private storage, workflow, worker, or secret configuration is missing.
- Preserve session ownership, the two-path-attempt non-overwriting capture-grant bound, exact path validation, grant lifetimes bounded by session expiry, bounded payloads, tracked cleanup paths, and the independent Hugging Face gateway and application credentials.
- Never commit environment files, tokens, database URLs, signed URLs, captured audio, private reports, or production identifiers.
- Use synthetic fixtures and the deterministic reference asset in tests. Do not attach real recordings to issues or pull requests.
- Treat logging changes as security-sensitive: credentials, signed URLs, request bodies, and audio content must stay out of logs.

Suspected vulnerabilities do not belong in public issues. Follow [SECURITY.md](SECURITY.md) and open a private GitHub security advisory.

## Accessibility and interface quality

User-interface changes should preserve:

- semantic controls and a complete keyboard journey;
- visible focus, 44 px minimum touch targets, and readable contrast;
- text, marker, or trace-style identification in addition to A/B color;
- accessible names and text summaries for signal plots;
- modal focus trapping, Escape dismissal, and focus restoration;
- full functionality with `prefers-reduced-motion`;
- narrow mobile layouts without horizontal page scrolling.

Follow the phase-aperture identity and calibrated editorial instrument described in [Brand System v2](docs/brand-redesign/BRAND_SYSTEM_V2.md). Avoid gradients, glow, glass effects, ornamental shadows, generic metric-card grids, and decorative waveform motion.

## Local setup

Requirements: Node.js 24 and npm 11. The default example environment is safe demo mode.

```bash
nvm use
npm ci
cp .env.example .env.local
npm run dev
```

Do not add real service credentials merely to exercise UI work. If a change genuinely requires live integrations, use isolated preview resources and coordinate their provisioning with the maintainer.

Blank live-only placeholders in `.env.example` are normalized safely while demo mode is active; setting `SIGNAL_MODE=live` still requires every live dependency and secret to pass validation.

## Required validation

Run the web quality gate for every change that can affect application behavior:

```bash
npm run format:check
npm run lint
npm run typecheck
npm test
npm run build
```

Run the browser journey for interaction, responsive, capture, or state changes:

```bash
npm run test:e2e
```

Worker changes also require the locked Python gate:

```bash
uv sync --directory worker --extra dev --frozen
uv run --directory worker ruff check .
uv run --directory worker mypy
uv run --directory worker pytest
docker build --file worker/Dockerfile --tag signal-enhancer-worker:local worker
```

Add or update tests when behavior changes. Documentation-only changes may rely on formatting and local-link validation when they do not alter a runtime contract.

## When code contributions reopen

Once explicit contributor terms have been published and the maintainer invites a pull request, explain:

- what changed and why;
- which product, privacy, or architectural contract it touches;
- how you validated it, including browsers or viewports where relevant;
- any new environment value, cost, retention, dependency, or threat boundary;
- any deliberate visual difference from the accepted concept system.

Include current implementation captures for meaningful UI changes. Use synthetic/prepared comparison data, remove local or production identifiers, and never include private audio.

## Source status

This repository is publicly readable but proprietary and has no open-source license. Public access does not grant permission to use, copy, modify, distribute, or sublicense the code except with explicit permission or as otherwise permitted by law. Opening an issue or proposal does not change that status. Code pull requests will remain closed until the repository publishes clear inbound contribution terms.
