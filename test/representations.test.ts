// test/representations.test.ts — common identity and artifact contract (F2.4).

import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { describe, it } from 'node:test';

import {
  buildRepresentationBundle,
  FunctionNotAdmittedError,
  REPRESENTATION_IDS,
} from '../src/representations.ts';

function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

describe('common representation bundle', () => {
  it('builds all four representations with a shared source identity', () => {
    const source = 'function identity(value) { return value; }';
    const bundle = buildRepresentationBundle(source, { sourceId: 'codexglue-js:test-1' });

    assert.equal(bundle.functionId, 'codexglue-js:test-1');
    assert.equal(bundle.sourceId, 'codexglue-js:test-1');
    assert.equal(bundle.sourceHash, sha256(source));
    assert.deepEqual(Object.keys(bundle.artifacts), REPRESENTATION_IDS);

    for (const representation of REPRESENTATION_IDS) {
      const artifact = bundle.artifacts[representation];
      assert.equal(artifact.functionId, bundle.functionId);
      assert.equal(artifact.sourceHash, bundle.sourceHash);
      assert.equal(artifact.representation, representation);
      assert.equal(
        artifact.relativePath,
        `repr/${representation}/${sha256(bundle.functionId)}.txt`,
      );
    }
  });

  it('uses SHA-256 of the exact source as the fallback identity', () => {
    const source = 'function identity(value) { return value; }';
    const bundle = buildRepresentationBundle(source);
    const sourceHash = sha256(source);

    assert.equal(bundle.sourceId, null);
    assert.equal(bundle.sourceHash, sourceHash);
    assert.equal(bundle.functionId, `sha256:${sourceHash}`);
  });

  it('preserves B0 exactly and produces B1, B2, and P from the same function', () => {
    const source = 'function identity(value) { return value; }\n';
    const bundle = buildRepresentationBundle(source, { sourceId: 'fixture-identity' });

    assert.equal(bundle.artifacts.b0.content, source);
    assert.ok(bundle.artifacts.b1.content.startsWith('<FunctionDeclaration '));
    assert.equal(bundle.artifacts.b2.content.split('\n')[0]?.includes('FunctionDeclaration'), true);
    assert.ok(bundle.artifacts.p.content.startsWith('func identity(value)'));
  });

  it('keeps artifact filenames path-safe when the source ID contains path syntax', () => {
    const bundle = buildRepresentationBundle('function f() {}', {
      sourceId: '../unsafe/id\\name',
    });

    for (const artifact of Object.values(bundle.artifacts)) {
      assert.match(artifact.relativePath, /^repr\/(b0|b1|b2|p)\/[a-f0-9]{64}\.txt$/);
      assert.ok(!artifact.relativePath.includes('..'));
    }
  });

  it('rejects empty source IDs', () => {
    assert.throws(() => buildRepresentationBundle('function f() {}', { sourceId: '  ' }), {
      name: 'TypeError',
      message: 'sourceId must not be empty or whitespace',
    });
  });

  it('does not produce representations for a rejected function', () => {
    assert.throws(
      () => buildRepresentationBundle('function rejected() { class Local {} }'),
      (error: unknown) =>
        error instanceof FunctionNotAdmittedError && error.admission.cause === 'class',
    );
  });
});
