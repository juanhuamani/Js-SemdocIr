// test/parse.test.ts — verification of the parser wrapper (SF1.1).
//
// Uses the native Node test runner (node:test) with strict assertions and no
// extra dependencies. Run with `npm test`.

import test from 'node:test';
import assert from 'node:assert/strict';
import type { FunctionDeclaration, Identifier, VariableDeclaration } from '@babel/types';

import { parseFunction, PARSER_VERSION } from '../src/parse.ts';

test('parses a named FunctionDeclaration', () => {
  const ast = parseFunction('function add(a, b) { return a + b; }');
  assert.equal(ast.type, 'File');

  const fn = ast.program.body[0] as FunctionDeclaration;
  assert.equal(fn.type, 'FunctionDeclaration');
  assert.equal(fn.id?.name, 'add');
});

test('parses an ArrowFunctionExpression assigned to an identifier', () => {
  const ast = parseFunction('const double = (x) => x * 2;');
  const decl = (ast.program.body[0] as VariableDeclaration).declarations[0];

  assert.equal(decl.id.type, 'Identifier');
  assert.equal((decl.id as Identifier).name, 'double');
  assert.equal(decl.init?.type, 'ArrowFunctionExpression');
});

test('parses the canonical parseList function (spec §3.3)', () => {
  const src = `function parseList(raw) {
  if (!raw) return [];
  let items = [];
  try {
    items = JSON.parse(raw).map(s => s.trim());
  } catch (e) {
    return [];
  }
  for (const s of items) {
    if (s.length > 80) continue;
    console.log(s);
  }
  return items;
}`;
  const ast = parseFunction(src);
  const fn = ast.program.body[0] as FunctionDeclaration;
  assert.equal(fn.id?.name, 'parseList');
});

test('throws an explicit SyntaxError on invalid syntax', () => {
  assert.throws(() => parseFunction('function ( {'), SyntaxError);
});

test('the parser version is frozen and documented', () => {
  assert.equal(PARSER_VERSION, '8.0.7');
});
