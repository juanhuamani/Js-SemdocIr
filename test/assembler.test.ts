// test/assembler.test.ts — exact canonical instance assembly (spec §2–3).

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { assemble } from '../src/assembler.ts';
import { extractFunction } from '../src/extractor.ts';
import { parseFunction } from '../src/parse.ts';

function instance(source: string): string {
  return assemble(extractFunction(source, parseFunction(source)));
}

describe('assembler — canonical instances', () => {
  it('assembles getUser with E2 category order and absence markers', () => {
    const source = [
      'async function getUser(id) {',
      '  if (!id) {',
      '    throw new Error("id is required");',
      '  }',
      '  const response = await fetch(`/api/users/${id}`);',
      '  if (!response.ok) {',
      '    return null;',
      '  }',
      '  return response.json();',
      '}',
    ].join('\n');

    assert.equal(
      instance(source),
      [
        'async func getUser(id)',
        'INPUT id',
        'COND !id -> THROW Error("id is required")',
        'COND !response.ok -> RET null',
        'CALL fetch(`/api/users/${id}`) -> response',
        'CALL response.json()',
        'ASYNC await fetch(`/api/users/${id}`) -> response',
        'ERR NOCATCH',
        'RET response.json()',
      ].join('\n'),
    );
  });

  it('assembles parseList exactly in canonical category order', () => {
    const source = [
      'function parseList(raw) {',
      '  if (!raw) return [];',
      '  let items = [];',
      '  try {',
      '    items = JSON.parse(raw).map(s => s.trim());',
      '  } catch (e) {',
      '    return [];',
      '  }',
      '  for (const s of items) {',
      '    if (s.length > 80) continue;',
      '    console.log(s);',
      '  }',
      '  return items;',
      '}',
    ].join('\n');

    assert.equal(
      instance(source),
      [
        'func parseList(raw)',
        'INPUT raw',
        'COND !raw -> RET []',
        'COND LOOP for (const s of items)',
        'COND s.length > 80 -> CONTINUE',
        'CALL JSON.parse(raw).map(s => s.trim()) -> items',
        'CALL console.log(s)',
        'ASYNC NONE',
        'ERR CATCH (e) -> RET []',
        'RET items',
      ].join('\n'),
    );
  });
});

describe('assembler — bilateral absence markers', () => {
  it('emits NONE markers for an empty synchronous function', () => {
    assert.equal(
      instance('function empty() {}'),
      [
        'func empty()',
        'INPUT NONE',
        'COND NONE',
        'CALL NONE',
        'ASYNC NONE',
        'ERR NONE',
        'RET NONE',
      ].join('\n'),
    );
  });

  it('emits NOCATCH when a throw has no try/catch', () => {
    assert.match(instance('function fail() { throw Error("x"); }'), /ERR NOCATCH/);
    assert.doesNotMatch(instance('function fail() { throw Error("x"); }'), /ERR NONE/);
  });

  it('does not emit NOCATCH when a catch record exists', () => {
    const output = instance('function safe() { try { work(); } catch (e) {} }');
    assert.match(output, /ERR CATCH \(e\) -> EMPTY/);
    assert.doesNotMatch(output, /ERR NOCATCH/);
  });

  it('keeps source order within each category', () => {
    const output = instance('function f(x) { if (x) first(); if (x) second(); }');
    assert.ok(output.indexOf('COND x ->') < output.indexOf('CALL first()'));
    assert.ok(output.indexOf('CALL first()') < output.indexOf('CALL second()'));
  });
});
