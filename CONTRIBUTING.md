# Contributing to OpenTrajectory

OpenTrajectory is an open standard — it only works if others can emit and validate it without the
maintainers in the loop. The two highest-value contributions:

## Add a harness adapter
Teach a new harness to emit the open format. Use the four existing adapters in
[`packages/capture/src/from-*.ts`](packages/capture/src/) as references (zero dependencies, Node
built-ins only). Your output must pass the same validator everyone uses:

```bash
node tools/ot-validate.mjs path/to/your-output.ot.json    # zero-install, spec §7
```

## Prove conformance
The [`conformance/`](conformance/) corpus is the canonical proof harness — nine documents, one per
shape an adapter must get right. To contribute a harness or edge case:

1. Add `conformance/harness-<yours>.ot.json` (or a new edge-case file) + a `manifest.json` entry
   with its `must` invariants.
2. Verify locally:
   ```bash
   node conformance/check.mjs        # validates every case + asserts invariants + no orphans
   node registry/build.mjs           # regenerate the registry page's data
   ```
3. Open a PR. CI runs the validator + corpus self-check + registry drift guard on every push.

## Ground rules
- **Zero runtime dependencies** in the shipped SDK (Node built-ins only).
- **Every claim ships its caveat** — match the honesty of the existing docs (e.g. the LangGraph
  adapter is labeled exactly to the extent it's been validated against real data).
- **The format is frozen at v0.1** (stable, additive-only). Breaking changes bump `ot_version`.
  See [`docs/opentrajectory-spec.md`](docs/opentrajectory-spec.md).
- Run the tests before opening a PR:
  ```bash
  cd packages/capture && node --import tsx test/run.ts   # SDK
  node ../../inspector/test-ingest.mjs                   # Inspector ingestion
  ```

## License
Spec text: CC0. Reference code: MIT. By contributing you agree your contributions ship under the same.
