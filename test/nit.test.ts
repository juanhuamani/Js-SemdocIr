// test/nit.test.ts — exact B2/NIT serializer fixtures (F2.3).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { Node } from '@babel/types';

import { detectUnit } from '../src/filter.ts';
import { parseFunction } from '../src/parse.ts';
import { serializeNit } from '../src/serializers/nit.ts';

interface SerializerFixture {
  name: string;
  source: string;
  nit: string[];
}

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/serializers/golden.json', import.meta.url), 'utf8'),
) as SerializerFixture[];

function serializeFunction(source: string): string {
  const ast = parseFunction(source);
  const unit = detectUnit(ast.program.body);
  assert.ok(unit, 'fixture source should contain a recognized function unit');
  return serializeNit(unit.node as Node, source);
}

describe('B2/NIT serializer', () => {
  for (const fixture of fixtures) {
    it(`serializes ${fixture.name} exactly`, () => {
      assert.equal(serializeFunction(fixture.source), fixture.nit.join('\n'));
    });
  }

  it('is deterministic across repeated calls', () => {
    const source = 'function identity(value) { return value; }';
    assert.equal(serializeFunction(source), serializeFunction(source));
  });

  it('assigns sequential pre-order IDs and has no trailing newline', () => {
    const rows = serializeFunction('function identity(value) { return value; }')
      .split('\n')
      .map((line) => JSON.parse(line) as [number, string, unknown, number[]]);

    assert.deepEqual(
      rows.map(([id]) => id),
      rows.map((_, index) => index),
    );
    assert.ok(!serializeFunction('function identity(value) { return value; }').endsWith('\n'));
  });

  it('serializes only the selected function root, not Babel wrappers', () => {
    const result = serializeFunction('function identity(value) { return value; }');
    assert.equal(JSON.parse(result.split('\n')[0]!)[1], 'FunctionDeclaration');
    assert.ok(!result.includes('"File"'));
    assert.ok(!result.includes('"Program"'));
  });
});
