// test/sbt.test.ts — exact B1/SBT serializer fixtures (F2.2).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import type { Node } from '@babel/types';

import { detectUnit } from '../src/filter.ts';
import { parseFunction } from '../src/parse.ts';
import { serializeSbt } from '../src/serializers/sbt.ts';

interface SerializerFixture {
  name: string;
  source: string;
  sbt: string;
}

const fixtures = JSON.parse(
  readFileSync(new URL('./fixtures/serializers/golden.json', import.meta.url), 'utf8'),
) as SerializerFixture[];

function serializeFunction(source: string): string {
  const ast = parseFunction(source);
  const unit = detectUnit(ast.program.body);
  assert.ok(unit, 'fixture source should contain a recognized function unit');
  return serializeSbt(unit.node as Node, source);
}

describe('B1/SBT serializer', () => {
  for (const fixture of fixtures) {
    it(`serializes ${fixture.name} exactly`, () => {
      assert.equal(serializeFunction(fixture.source), fixture.sbt);
    });
  }

  it('is deterministic across repeated calls', () => {
    const source = 'function identity(value) { return value; }';
    assert.equal(serializeFunction(source), serializeFunction(source));
  });

  it('serializes only the selected function root, not Babel wrappers', () => {
    const result = serializeFunction('function identity(value) { return value; }');
    assert.ok(result.startsWith('<FunctionDeclaration '));
    assert.ok(result.endsWith('FunctionDeclaration>'));
    assert.ok(!result.includes('File'));
    assert.ok(!result.includes('Program'));
  });
});
