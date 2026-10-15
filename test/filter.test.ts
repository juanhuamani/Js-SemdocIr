// test/filter.test.ts — verification of the admission filter (SF1.2).
//
// Covers admitted units (declaration, arrow, expression, module.exports) and
// every exclusion cause from the §1.2 table.

import test from 'node:test';
import assert from 'node:assert/strict';
import { parse } from '@babel/parser';

import { parseFunction } from '../src/parse.ts';
import { filter, detectUnit, CAUSES } from '../src/filter.ts';

function classify(source: string) {
  return filter(parseFunction(source));
}

// --- admitted units ---

test('admits a named FunctionDeclaration', () => {
  const r = classify('function add(a, b) { return a + b; }');
  assert.equal(r.admitted, true);
  assert.equal(r.cause, null);
});

test('admits an ArrowFunctionExpression assigned to an identifier', () => {
  assert.equal(classify('const double = (x) => x * 2;').admitted, true);
});

test('admits a FunctionExpression assigned to an identifier', () => {
  assert.equal(classify('const f = function () { return 1; };').admitted, true);
});

test('admits an async function with await', () => {
  assert.equal(classify('async function f() { return await g(); }').admitted, true);
});

test('admits module.exports.f = function', () => {
  assert.equal(classify('module.exports.f = function () { return 1; };').admitted, true);
});

test('admits the canonical parseList function (spec §3.3)', () => {
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
  assert.equal(classify(src).admitted, true);
});

// --- exclusion causes ---

test('rejects a class declaration nested in the body (complete tree)', () => {
  const r = classify('function f() { class Inner {} return 1; }');
  assert.equal(r.admitted, false);
  assert.equal(r.cause, CAUSES.CLASS);
});

test('rejects a class expression inside a function', () => {
  assert.equal(classify('function f() { const A = class {}; return A; }').cause, CAUSES.CLASS);
});

test('rejects a class as the fragment (not a unit)', () => {
  const r = classify('class A { m() { return 1; } }');
  assert.equal(r.admitted, false);
  assert.equal(r.cause, CAUSES.NOT_A_UNIT);
});

test('rejects a generator function', () => {
  assert.equal(classify('function* g() { yield 1; }').cause, CAUSES.GENERATOR);
});

test('rejects a generator expression', () => {
  assert.equal(classify('const g = function* () { yield 1; };').cause, CAUSES.GENERATOR);
});

test('rejects an async generator', () => {
  assert.equal(classify('async function* g() { yield 1; }').cause, CAUSES.GENERATOR);
});

test('rejects a generator method in an object inside a function', () => {
  assert.equal(
    classify('function f() { const o = { *m() { yield 1; } }; return o; }').cause,
    CAUSES.GENERATOR,
  );
});

test('rejects a generator nested in the body', () => {
  assert.equal(
    classify('function f() { function* g() { yield 1; } return g; }').cause,
    CAUSES.GENERATOR,
  );
});

test('rejects dynamic import', () => {
  assert.equal(classify("const f = () => import('./x');").cause, CAUSES.DYNAMIC_IMPORT);
});

test('rejects import.meta (in module context)', () => {
  const ast = parse('const f = () => import.meta.url;', { sourceType: 'module' });
  assert.equal(filter(ast).cause, CAUSES.IMPORT_META);
});

test('rejects the with statement', () => {
  assert.equal(classify('function f(o) { with (o) { x = 1; } return x; }').cause, CAUSES.WITH);
});

test('rejects the arguments identifier', () => {
  assert.equal(classify('function f() { return arguments[0]; }').cause, CAUSES.ARGUMENTS);
});

test('rejects the eval identifier', () => {
  assert.equal(classify("function f() { return eval('1 + 1'); }").cause, CAUSES.EVAL);
});

// --- not a unit ---

test('rejects a fragment with multiple statements', () => {
  assert.equal(classify('const a = 1; const b = 2;').cause, CAUSES.NOT_A_UNIT);
});

test('rejects an expression that is not a function', () => {
  assert.equal(classify('1 + 1;').cause, CAUSES.NOT_A_UNIT);
});

test('rejects an anonymous function call (IIFE)', () => {
  assert.equal(classify('(function () { return 1; })();').cause, CAUSES.NOT_A_UNIT);
});

// --- detectUnit ---

test('detectUnit extracts the name from module.exports.f', () => {
  const ast = parseFunction('module.exports.getUser = function () { return 1; };');
  const unit = detectUnit(ast.program.body);
  assert.equal(unit?.name, 'getUser');
  assert.equal(unit?.isAsync, false);
});

test('detectUnit flags an async arrow', () => {
  const ast = parseFunction('const f = async () => { await g(); };');
  const unit = detectUnit(ast.program.body);
  assert.equal(unit?.name, 'f');
  assert.equal(unit?.isAsync, true);
});
