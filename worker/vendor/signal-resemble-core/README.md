# Signal Resemble core packaging

This private local distribution packages all 48 unchanged Python files from
Resemble Enhance commit `8e978149bfe8abab3eb77d965d579a111afdb0ff`.
It retains the `resemble_enhance` import namespace, original CLI entrypoint,
MIT license, and all 17 non-demo upstream dependencies.

Only the standalone Gradio demo dependency is omitted. The demo's root
`app.py` was never part of the upstream installed Python namespace and is not
used by Signal Enhancer. This is downstream packaging, not an upstream release.

`UPSTREAM_PROVENANCE.json` records the immutable source and exact Git/SHA-256
hashes. The build and runtime verification script checks that the complete
namespace remains byte-identical and that the installed distribution has the
intended metadata. Model source identity, checkpoint hashes, inference profile,
and production GPU readiness requirements are unchanged.
