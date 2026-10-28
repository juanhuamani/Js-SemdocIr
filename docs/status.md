# Status

Last updated: 2026-10-28.

## Implemented

| Area                                                 | State                     |
| ---------------------------------------------------- | ------------------------- |
| Deterministic parser and admission filter            | complete                  |
| P extraction and canonical assembly                  | complete                  |
| Expression expansion in `RET`, `CALL` and `COND`     | complete                  |
| B1/SBT and B2/NIT serializers                        | complete, golden fixtures |
| Shared B0/B1/B2/P identity                           | complete                  |
| Generation protocol, request and mock client         | complete, mock only       |
| Local file cache, bounded retries, resumable records | complete                  |
| One-function × one-representation orchestration      | complete                  |
| Local web app and terminal demo                      | complete                  |

Verification: `npm test` → **128 tests, 23 suites**, all passing.
`npm run test:integration`, `npm run typecheck`, `npm run lint` and
`npm run format:check` also pass.

## Structure

`src/` is organised by domain: `core/` (pure), `representations/`,
`generation/`, `interfaces/`. The extractor, once 876 lines in a single class,
is now a 158-line facade over `core/semdocir/rules/`. No file exceeds 300
lines; `npm run check:size` enforces it and CI runs the same checks as a local
verification.

## Not implemented, by design

- No real model provider. `protocol.json` keeps `allowRealApi: false` and no
  provider or model is selected.
- No corpus run, metric calculation, human rubric or hypothesis test. Those
  belong to the experimental stage, which is not authorized yet.
- `ND external semantics` is not emitted; it needs cross-module binding
  resolution, which a single-function extractor cannot do.

## Open gates

| Gate                                       | What closes it                                                 |
| ------------------------------------------ | -------------------------------------------------------------- |
| Provider and model selection               | A recorded decision plus explicit authorization for real calls |
| Small integration pilot against a real API | The gate above, and explicit approval                          |
| Full experiment (corpus, metrics, rubric)  | End-to-end integration, then authorization                     |

Until those gates close, the generation layer stays on the mock client and no
external request is made. Cache files are local, ignored by Git and are not
evidence.

## Known edge cases

Documented in `design.md` under "Documented interpretations": `new`
omission, category grouping precedence, throw/return asymmetry, deferred
external semantics and `catch {}` rendering. Each has a test; none is a defect
to fix silently.
