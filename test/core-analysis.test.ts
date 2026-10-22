import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { analyzeFunction } from '../src/core/ast/analysis.ts';
import { buildRepresentationBundle } from '../src/evaluation/representations/index.ts';

describe('shared core analysis', () => {
  it('produces the product representation and evaluation reuses that exact P', () => {
    const source = 'function suma(a, b) { return a + b; }';
    const analysis = analyzeFunction(source);
    const bundle = buildRepresentationBundle(source);

    assert.equal(analysis.admission.admitted, true);
    assert.equal(analysis.unit?.name, 'suma');
    assert.equal(analysis.extracted?.name, 'suma');
    assert.match(analysis.representation ?? '', /^func suma\(a, b\)/);
    assert.equal(bundle.artifacts.p.content, analysis.representation);
    assert.equal(bundle.sourceHash, analysis.sourceHash);
  });

  it('keeps the parsed AST and rejection cause without running extraction', () => {
    const analysis = analyzeFunction('function* unsupported() { yield 1; }');

    assert.equal(analysis.ast.program.body.length, 1);
    assert.equal(analysis.admission.admitted, false);
    assert.equal(analysis.admission.cause, 'generator');
    assert.equal(analysis.extracted, null);
    assert.equal(analysis.representation, null);
  });
});
