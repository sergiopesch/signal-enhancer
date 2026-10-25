# Third-party notices

The optional production image uses the local `signal-resemble-core` distribution of
[Resemble Enhance](https://github.com/resemble-ai/resemble-enhance) at source revision
`8e978149bfe8abab3eb77d965d579a111afdb0ff`.

Resemble Enhance is copyright 2023 Resemble AI and is distributed under the MIT
License. Its complete `LICENSE` file remains part of the installed Python distribution.

All 48 upstream Python files remain byte-identical. Downstream packaging retains
the original Python namespace, CLI entrypoint and non-demo requirements, while
omitting the standalone Gradio demo dependency. `UPSTREAM_PROVENANCE.json` and
the build/runtime verifier bind this packaging to the immutable source revision;
the package is not represented as a new upstream release.
