# Real LangSmith export fixtures

These four JSON files are **real serialized LangSmith run exports**, vendored verbatim from the
LangSmith SDK's own integration-test data:

> source: [`langchain-ai/langsmith-sdk`](https://github.com/langchain-ai/langsmith-sdk) ·
> `python/tests/integration_tests/test_data/langsmith_py_wrap_openai_*.json` · MIT license

They are the payloads the SDK's `wrap_openai` instrumentation actually posts to the LangSmith
ingestion endpoint — i.e. genuine exports, **not** fixtures we hand-authored. They are what let the
LangGraph adapter drop its "provisional, never seen a real export" flag (see
`docs/harness-emit-analysis.md §1d`).

Why they mattered — each exposed a real shape our synthetic fixtures missed:
- the **`{ post:[...], patch:[...] }` ingestion-batch envelope** (run created in `post`, final
  outputs/end_time/error patched in by id) — the adapter now merges them;
- LLM output as a raw **OpenAI `choices[].message.content`** (and streaming `delta.content`), not
  LangChain `generations` — now parsed;
- a chat **`messages:[{role,content}]`** input as the task description — now extracted.

Scope note (kept honest): these are real *single-LLM* run exports. A real *multi-tool agent* trace
(root chain + nested tool runs) is still exercised only by synthetic fixtures in `test/run.ts`; the
tool/tree code paths are covered there, not yet against a captured real agent run.
