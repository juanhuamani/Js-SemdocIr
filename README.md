# JS-SemDocIR

Deterministic JavaScript AST extraction for a compact semantic intermediate
representation. This repository contains **Phase 1** of JS-SemDocIR:

```text
JavaScript source → parser → admission filter → extractor → assembler → JS-SemDocIR
```

## Requirements

- Node.js 24 or newer
- npm

The parser version is intentionally frozen at `@babel/parser@8.0.7`.

## Install

```bash
npm install
```

## Development commands

```bash
npm test
npm run typecheck
npm run lint
npm run format:check
```

## Usage

```ts
import { assemble } from './src/assembler.ts';
import { extractFunction } from './src/extractor.ts';
import { parseFunction } from './src/parse.ts';

const source = [
  'async function getUser(id) {',
  '  const response = await fetch(`/api/users/${id}`);',
  '  return response.json();',
  '}',
].join('\n');

const instance = assemble(extractFunction(source, parseFunction(source)));
console.log(instance);
```

## Implemented features

- Deterministic Babel AST parsing and admission filtering
- Function-frontier traversal for nested functions
- Conditions, loops, returns, throws, `try/catch/finally`, calls and `await`
- Source-preserving expressions with normalized whitespace and removed comments
- Canonical category ordering and bilateral absence markers
- Non-determinable (`ND`) records for supported local cases
- Exact unit tests for canonical examples and extraction edge cases

## Phase 1 scope

Phase 1 intentionally excludes serializers, LLM integration, documentation
generation, corpus evaluation, metrics and rubric automation.

## Project structure

```text
src/parse.ts       Frozen Babel parser wrapper
src/filter.ts      Admission filter
src/ast.ts         Generic depth-first AST walker
src/extractor.ts   Semantic record extraction
src/assembler.ts   Canonical JS-SemDocIR assembly
test/              Parser, filter, extractor and assembler tests
```

## License

This project is part of an academic thesis and is currently unpublished and
unlicensed.
