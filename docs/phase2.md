# Phase 2: local pipeline and integration

This document describes the implemented local scaffold. It does not authorize
or report an external model call, corpus evaluation, or experimental result.

## Phase 2 implementation closeout

The software work items F2.1–F2.8 are implemented in the local/mock mode. The
completion matrix and formal status are maintained in
`../../plan_implementacion_tres_fases.md`. Verification at closeout: `npm test`
(110/110), `npm run test:integration` (1/1), typecheck, lint, and format check
all pass.

This closes the reproducible software scaffold, **not** a live LLM integration
or the thesis experiment. The real provider/model remains blocked by D6.1 and
explicit authorization; SF1.6/G1 remains a separate Phase 1 acceptance item.

## Scope and status

For one admitted JavaScript function, `buildRepresentationBundle()` parses the
source once, applies the existing admission filter, and produces four
traceable artifacts:

| ID   | Representation  | Content                                               |
| ---- | --------------- | ----------------------------------------------------- |
| `b0` | Original source | Exact source string; not normalized                   |
| `b1` | SBT             | Deterministic recursive Babel-node serialization      |
| `b2` | NIT             | Preorder JSON Lines tuples with direct child IDs      |
| `p`  | JS-SemDocIR     | Existing deterministic extractor and assembler output |

The bundle carries a stable `functionId`, the SHA-256 of the exact UTF-8 source,
and a path-safe artifact name. A supplied source ID is used as the identity;
when omitted, identity falls back to `sha256:<sourceHash>`. The representation
artifact paths are metadata under `repr/{b0,b1,b2,p}/`; the current scaffold
does not materialize a corpus or write those input files to disk.

## Running the local checks

From the repository root:

```sh
npm test
npm run test:integration
npm run typecheck
npm run lint
npm run format:check
```

The integration test uses one inline fixture function, all four representation
jobs, a temporary cache directory, and the mock client. Its temporary files are
removed at test completion. It makes no network requests.

## Running one job

The orchestration boundary takes one artifact descriptor, not a corpus or a
bundle-wide run command:

```ts
const bundle = buildRepresentationBundle(source, { sourceId: 'dataset:record-1' });
const jobs = createRepresentationJobs(bundle);
const service = new GenerationService(new MockGenerationClient());
const result = await runRepresentationJob(jobs[0]!, service);
```

`createRepresentationJobs()` only returns descriptors. Every call to
`runRepresentationJob()` executes exactly one representation. If a job fails,
the result is scoped to that representation; the orchestrator does not fan out
or automatically exclude other representations. Symmetric failure handling
for an actual experiment remains a protocol-level requirement to enforce when
the experimental runner is authorized.

The default `MockGenerationClient` returns
`[MOCK] No language-model generation was performed.` This marker is not a
documentation comment and must not be evaluated as model output. The generic
`GenerationService` accepts the `GenerationClient` interface for tests and
future adapters, but this repository currently provides no real provider
adapter.

## Protocol and generation settings

`protocol.json` is the versioned, non-secret draft and is validated by
`loadProtocolConfig()`. It contains the shared English instruction, temperature
0, provider-default `topP`, `maxTokens` 128, and no seed. Provider, model, and
model version are `null`; `clientMode` is `mock`; `allowRealApi` is `false`.
Model/provider approval and adviser validation remain pending. Do not add API
credentials to this file or commit them elsewhere.

The retry policy is three total attempts (one initial attempt and up to two
retries), with exponential delays starting at 1000 ms and doubling. This
resolves the previous wording conflict with the handoff; decision
`I-F2.6-01` in `../../registro_decisiones.md` records the adopted interpretation.

## Cache, metadata, and recovery

By default, JSON cache records are written atomically to
`.cache/generations/<cache-key>.json`. `.cache/` is Git-ignored. The cache key
hashes a canonical object containing function ID, representation, client mode,
provider/model/model version, protocol version, prompt, decoding parameters,
and a SHA-256 of the exact input representation. Successful records include
the request, output, client/model and token/latency metadata, attempt timestamps,
and cache key.

Failures include sanitized message, attempt history, and—when the adapter throws
`GenerationClientError`—HTTP status and a redacted response body. Common bearer
and credential assignments are redacted before persistence. A successful or
terminally failed identical request is not repeated automatically. A pending
record resumes within its original three-attempt budget; a started attempt
found after interruption counts as consumed. Simultaneous identical calls are
coalesced within one `GenerationService` instance. Cross-process locking is not
implemented.

The cache is a reproducibility aid, not an experiment log or a substitute for
the approved data/protocol manifest. The current mock reports null token counts
and no model identity.

## Deferred work and constraints

- Choose and freeze a provider/model only after adviser validation and explicit
  authorization. No real API path or credentials are present now.
- Do not run a corpus, calculate thesis metrics, conduct rubric annotation, or
  make experimental claims as part of this local integration.
- The formal Phase 1 SF1.6/G1 requirement (a separate hand-written golden suite
  of at least 40 complete instances and reproducible report) remains an
  acceptance item; existing unit-test count does not satisfy it by itself.
- SBT/NIT exact encoding decisions and golden fixture contract are documented
  in `test/fixtures/serializers/CONTRACT.md`.
