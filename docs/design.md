# Architecture

JS-SemDocIR turns one JavaScript function into a deterministic textual
representation (`P`) and, for the evaluation protocol, into three comparison
representations (`B0`, `B1`, `B2`). Nothing here calls a model or the network.

## Pipeline

```text
source ──parse──▶ AST ──admission──▶ unit ──extract──▶ records ──assemble──▶ P
                                     │
                                     └──▶ B1 (SBT) / B2 (NIT) from the same AST
```

`B0` is the original source. `B0`, `B1` and `B2` exist only as comparison
inputs for the protocol; they are not stages of the user-facing system.

## Layering

```text
interfaces  →  generation  →  representations  →  core
```

- `core/` is pure: no I/O, no network, no process access. It depends only on
  `@babel/parser` and `@babel/types`.
- `representations/` builds the four artifacts; `generation/` prepares and runs
  jobs. They may read configuration and write cache files, but never call a
  provider.
- `interfaces/` (HTTP server and CLI) are delivery surfaces.

A module is consumed through its `index.ts`. There are no compatibility
re-export layers and no deep imports across modules.

## Modules

| Path                               | Responsibility                                                                     | Public exports                                    |
| ---------------------------------- | ---------------------------------------------------------------------------------- | ------------------------------------------------- |
| `src/core/ast/parse.ts`            | Frozen Babel wrapper. Produces an explicit `SyntaxError` on invalid input.         | `parseFunction`, `PARSER_VERSION`                 |
| `src/core/ast/walk.ts`             | Generic depth-first traversal that can stop at a frontier.                         | `walk`, `isNode`, `ABORT`                         |
| `src/core/ast/filter.ts`           | Recognizes one named unit and rejects excluded syntax with a deterministic cause.  | `filter`, `detectUnit`, `CAUSES`                  |
| `src/core/analysis.ts`             | Single parse shared by every representation; composes the pipeline.                | `analyzeFunction`                                 |
| `src/core/semdocir/model.ts`       | Vocabulary: categories, records, node type guards.                                 | `CATEGORIES`, `Record`, `ExtractorResult`         |
| `src/core/semdocir/source.ts`      | Verbatim source view (comments blanked) and `verbatim` rendering.                  | `SourceView`, `verbatim`                          |
| `src/core/semdocir/bindings.ts`    | Pure-binding detection: counts, cycle safety, reference positions.                 | `BindingTable`, `collectReferencePositions`       |
| `src/core/semdocir/expansion.ts`   | Substitutes pure bindings into RET/CALL/COND text.                                 | `expanded`, `expandedReturnedValue`               |
| `src/core/semdocir/rules/`         | One rule module per concern: statements, expressions, conditionals, loops, errors. | internal                                          |
| `src/core/semdocir/extractor.ts`   | Facade: owns state, implements the rule context, returns records.                  | `extractFunction`, `CATEGORIES`                   |
| `src/core/semdocir/assembler.ts`   | Canonical text: category grouping, order preservation, absence markers.            | `assemble`                                        |
| `src/representations/`             | Builds the four artifacts from one analysis.                                       | `buildRepresentationBundle`, `REPRESENTATION_IDS` |
| `src/representations/serializers/` | SBT and NIT encoders over the shared AST.                                          | `serializeSbt`, `serializeNit`                    |
| `src/generation/`                  | Protocol, request, mock client, cache, retries, orchestration.                     | `GenerationService`, `createRepresentationJobs`   |

Parser version is frozen at `@babel/parser@8.0.7` with `sourceType:
'unambiguous'`, `errorRecovery: false` and no JSX/TypeScript/decorator plugins.

## File size budget

No file under `src/` may exceed **300 lines**; `scripts/check-size.mjs` fails
the build above it. A file that grows past the budget is holding two
responsibilities, not one. The largest file today is
`generation/generation-service.ts` (289 lines).

## Representation P

Records are emitted in one of seven categories, assembled in this order:

```text
INPUT · COND · CALL · ASYNC · ERR · RET · ND
```

- `INPUT` — parameters, including defaults and rest.
- `COND` — conditions, `else if` chains, `switch` cases, loop headers.
- `CALL` — top-level call sites, `new`, optional calls, tagged templates.
- `ASYNC` — `await` positions.
- `ERR` — `throw`, `try/catch/finally`, with `CATCH`, `THROW` and `NOCATCH`.
- `RET` — returned values; concise arrow bodies produce an implicit return.
- `ND` — non-determinable cases: `this`, computed callee, destructuring
  assignment target, dynamic `typeof`/`delete`.

Absence is explicit: `INPUT NONE`, `COND NONE`, `CALL NONE`, `ASYNC NONE`,
`ERR NONE`, `RET NONE`.

Traversal stops at nested `FunctionDeclaration`, `FunctionExpression` and
`ArrowFunctionExpression`. Calls made to those functions from the outer scope
are still extracted.

Expression expansion (`I-F2.7-01`) substitutes pure top-level assignments into
`RET`, `CALL` and `COND`, recursively, with a depth guard. Impure right-hand
sides (calls, `await`, `new`, functions, dynamic `typeof`/`delete`) and
reassigned bindings are never substituted.

## Documented interpretations

These are intentional and are covered by tests. Changing one requires updating
the specification and the golden expectations, not just the code.

1. `NewExpression` text omits `new`, so `throw new Error(...)` renders as
   `THROW Error(...)`. This reproduces the frozen canonical example.
2. Category grouping (`E2`) prevails over the illustrative ordering shown for
   that example; the assembler implements grouping.
3. Throw arguments do not emit separate `CALL` records; return arguments do.
4. `ND external semantics` is not emitted: resolving cross-module bindings is
   outside a single-function extractor.
5. `catch {}` without a binding renders as `ERR CATCH () -> ...`.

## Generation layer

A job is exactly one function × one representation.

- `protocol.ts` loads and validates `protocol.json`; `allowRealApi` is `false`
  and provider/model are unset.
- `request.ts` builds the shared prompt and the representation payload.
- `client.ts` defines the client port; `mock.ts` implements it locally.
- `cache.ts` keys on function id, representation, provider/model identity,
  protocol version, prompt, parameters and input hash.
- `generation-service.ts` applies at most three total attempts with exponential
  backoff and persists each attempt's state.
- `orchestrator.ts` creates the four jobs for one admitted function.

Adding a real provider means writing one adapter for the client port. It does
not require touching `core/` or the orchestrator.

## Adding an extraction rule

1. Write a failing test with the smallest source that exercises the construct.
2. Add or extend the rule in `src/core/semdocir/extractor.ts`.
3. Keep the category and emission order consistent with the table above.
4. If the rule changes a frozen expectation, stop: that is a specification
   change, not an implementation detail.

## Commands

```bash
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run format:check
```
