// test/extractor.test.ts — extraction rules (spec §2, §4) and límite cases (§4.3).
//
// Records are asserted in the CANONICAL order (E2): grouped by category
// (INPUT, COND, CALL, ASYNC, ERR, RET, ND) and, within each category, in
// source order — the same order the assembler (SF1.5) applies. The two
// canonical instances of spec §3.3 (getUser, parseList) are FROZEN in content.

import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import { CATEGORIES, extractFunction, type ExtractorResult } from '../src/extractor.ts';
import { parseFunction } from '../src/parse.ts';

const CATEGORY_RANK = new Map(CATEGORIES.map((category, index) => [category, index]));

/** Renders the records in canonical order (E2) as `CATEGORY content` lines. */
function lines(source: string): string[] {
  const { records } = extractFunction(source, parseFunction(source));
  return [...records]
    .sort(
      (a, b) =>
        (CATEGORY_RANK.get(a.category) ?? 0) - (CATEGORY_RANK.get(b.category) ?? 0) ||
        a.order - b.order,
    )
    .map((record) => `${record.category} ${record.content}`);
}

/** Full result for header-level assertions. */
function extract(source: string): ExtractorResult {
  return extractFunction(source, parseFunction(source));
}

describe('extractor — canonical instances (spec §3.3, frozen)', () => {
  it('extracts the canonical getUser records', () => {
    // Source fixed by Cap1 (lstlisting): the ifs use block bodies.
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
    const result = extract(source);
    assert.equal(result.name, 'getUser');
    assert.equal(result.isAsync, true);
    assert.equal(result.hasThrow, true);
    assert.deepEqual(lines(source), [
      'INPUT id',
      'COND !id -> THROW Error("id is required")',
      'COND !response.ok -> RET null',
      'CALL fetch(`/api/users/${id}`) -> response',
      'CALL response.json()',
      'ASYNC await fetch(`/api/users/${id}`) -> response',
      'RET response.json()',
    ]);
    // The §3.3 instance is FROZEN in content. Its line order in the spec is
    // illustrative and contradicts E2 (parseList, the other frozen instance,
    // does follow E2). The assembler applies E2; recorded as a decision.
    const specRecordLines = [
      'INPUT id',
      'COND !id -> THROW Error("id is required")',
      'CALL fetch(`/api/users/${id}`) -> response',
      'ASYNC await fetch(`/api/users/${id}`) -> response',
      'CALL response.json()',
      'COND !response.ok -> RET null',
      'RET response.json()',
    ];
    assert.deepEqual([...lines(source)].sort(), [...specRecordLines].sort());
  });

  it('extracts the canonical parseList records', () => {
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
    const result = extract(source);
    assert.equal(result.name, 'parseList');
    assert.equal(result.isAsync, false);
    assert.equal(result.hasThrow, false);
    assert.deepEqual(lines(source), [
      'INPUT raw',
      'COND !raw -> RET []',
      'COND LOOP for (const s of items)',
      'COND s.length > 80 -> CONTINUE',
      'CALL JSON.parse(raw).map(s => s.trim()) -> items',
      'CALL console.log(s)',
      'ERR CATCH (e) -> RET []',
      'RET items',
    ]);
  });
});

describe('extractor — frontiers and call sites (§1.1, §4.3-d/e, E7)', () => {
  it('does not traverse a nested function but registers its later call', () => {
    const source = [
      'function f() {',
      "  const helper = () => { console.log('inner'); };",
      '  helper();',
      '  return helper;',
      '}',
    ].join('\n');
    assert.deepEqual(lines(source), ['CALL helper()', 'RET helper']);
  });

  it('registers only the outer site of a call chain', () => {
    const source = 'function f(a) { const x = a.b().c(); return x; }';
    assert.deepEqual(lines(source), ['INPUT a', 'CALL a.b().c() -> x', 'RET x']);
  });

  it('keeps nested calls verbatim inside the outer site', () => {
    const source = 'function f(a) { return a.wrap(inner()); }';
    assert.deepEqual(lines(source), ['INPUT a', 'CALL a.wrap(inner())', 'RET a.wrap(inner())']);
  });

  it('registers a call without destination when the value is not assigned', () => {
    const source = 'function f() { work(1); }';
    assert.deepEqual(lines(source), ['CALL work(1)']);
  });

  it('does not register a plain initializer (x = 5)', () => {
    const source = 'function f() { let x = 5; return x; }';
    assert.deepEqual(lines(source), ['RET x']);
  });

  it('gives the destination only when the initializer is the call itself', () => {
    const source = 'function f() { const x = a() + b(); return x; }';
    assert.deepEqual(lines(source), ['CALL a()', 'CALL b()', 'RET x']);
  });
});

describe('extractor — condition-centric guards (E5, §4.2, §4.3-a/b)', () => {
  it('negates the guard of the else branch', () => {
    const source = 'function f(x) { if (x) return 1; else return 2; }';
    assert.deepEqual(lines(source), ['INPUT x', 'COND x -> RET 1', 'COND !(x) -> RET 2']);
  });

  it('carries the guard on direct effects of a multi-statement branch', () => {
    const source = [
      'function f(x) {',
      '  if (x) {',
      '    log(x);',
      '    return 1;',
      '  }',
      '  return 0;',
      '}',
    ].join('\n');
    assert.deepEqual(lines(source), ['INPUT x', 'COND x -> RET 1', 'CALL log(x)', 'RET 0']);
  });

  it('walks a branch without direct effects without emitting a COND', () => {
    const source = 'function f(x) { if (x) { log(x); } return 0; }';
    assert.deepEqual(lines(source), ['INPUT x', 'CALL log(x)', 'RET 0']);
  });

  it('treats elif as a nested if with its own guard', () => {
    const source = 'function f(x) { if (x) return 1; else if (x > 2) return 3; }';
    assert.deepEqual(lines(source), ['INPUT x', 'COND x -> RET 1', 'COND x > 2 -> RET 3']);
  });

  it('decomposes a returned call even when the return is guarded', () => {
    const source = 'function f(x) { if (x) return load(); }';
    assert.deepEqual(lines(source), ['INPUT x', 'COND x -> RET load()', 'CALL load()']);
  });

  it('never decomposes the thrown expression (frozen getUser behavior)', () => {
    const source = 'function f() { throw new Error("e"); }';
    assert.deepEqual(lines(source), ['ERR THROW Error("e")']);
  });

  it('registers unguarded break/continue with no record (§4.3-c)', () => {
    const source = 'function f(items) { for (const i of items) { continue; } }';
    assert.deepEqual(lines(source), ['INPUT items', 'COND LOOP for (const i of items)']);
  });

  it('does not register labeled jumps (§1.2)', () => {
    const source = 'function f(items) { outer: for (const i of items) { break outer; } }';
    assert.deepEqual(lines(source), ['INPUT items', 'COND LOOP for (const i of items)']);
  });
});

describe('extractor — loops (E6)', () => {
  it('renders a for statement header verbatim', () => {
    const source = 'function f(n) { let s = 0; for (let i = 0; i < n; i++) { s += i; } return s; }';
    assert.deepEqual(lines(source), ['INPUT n', 'COND LOOP for (let i = 0; i < n; i++)', 'RET s']);
  });

  it('renders for-in and while headers verbatim', () => {
    const source = 'function f(obj, n) { for (const k in obj) { } while (n > 0) { n--; } }';
    assert.deepEqual(lines(source), [
      'INPUT obj',
      'INPUT n',
      'COND LOOP for (const k in obj)',
      'COND LOOP while (n > 0)',
    ]);
  });

  it('renders a do-while header', () => {
    const source = 'function f(n) { do { n--; } while (n > 0); return n; }';
    assert.deepEqual(lines(source), ['INPUT n', 'COND LOOP do while (n > 0)', 'RET n']);
  });
});

describe('extractor — switch (§4.2)', () => {
  it('emits the discriminant guard and one guard per case', () => {
    const source = [
      'function f(x) {',
      '  switch (x) {',
      "    case 1: return 'a';",
      "    default: return 'b';",
      '  }',
      '}',
    ].join('\n');
    assert.deepEqual(lines(source), [
      'INPUT x',
      'COND switch(x)',
      "COND case 1 -> RET 'a'",
      "COND default -> RET 'b'",
    ]);
  });

  it('does not emit a case record for a fall-through case', () => {
    const source = [
      'function f(x) {',
      '  switch (x) {',
      '    case 1: log(); break;',
      '    case 2: break;',
      '  }',
      '}',
    ].join('\n');
    assert.deepEqual(lines(source), [
      'INPUT x',
      'COND switch(x)',
      'COND case 1 -> BREAK',
      'COND case 2 -> BREAK',
      'CALL log()',
    ]);
  });
});

describe('extractor — try/catch (§4.2)', () => {
  it('consumes a single-effect handler into the ERR CATCH record', () => {
    const source = 'function f() { try { work(); } catch (e) { return 1; } }';
    assert.deepEqual(lines(source), ['CALL work()', 'ERR CATCH (e) -> RET 1']);
  });

  it('marks an empty handler as EMPTY', () => {
    const source = 'function f() { try { work(); } catch {} return 1; }';
    assert.deepEqual(lines(source), ['CALL work()', 'ERR CATCH () -> EMPTY', 'RET 1']);
  });

  it('extracts a multi-statement handler normally and summarizes EMPTY', () => {
    const source = [
      'function f() {',
      '  try {',
      '    work();',
      '  } catch (e) {',
      '    log(e);',
      '    return 1;',
      '  }',
      '}',
    ].join('\n');
    assert.deepEqual(lines(source), [
      'CALL work()',
      'CALL log(e)',
      'ERR CATCH (e) -> EMPTY',
      'RET 1',
    ]);
  });

  it('extracts a try/finally without handler with no ERR CATCH record', () => {
    const source = 'function f() { try { work(); } finally { cleanup(); } }';
    assert.deepEqual(lines(source), ['CALL work()', 'CALL cleanup()']);
  });

  it('extracts a return inside the guarded body normally', () => {
    const source = 'function f() { try { return read(); } finally { close(); } }';
    assert.deepEqual(lines(source), ['CALL read()', 'CALL close()', 'RET read()']);
  });
});

describe('extractor — asynchrony (§4.2, E9)', () => {
  it('emits ASYNC and CALL with the destination for an awaited assignment', () => {
    const source = 'async function f() { const x = await load(); return x; }';
    assert.deepEqual(lines(source), ['CALL load() -> x', 'ASYNC await load() -> x', 'RET x']);
  });

  it('emits ASYNC without destination for a bare await', () => {
    const source = 'async function f(p) { await p; }';
    assert.deepEqual(lines(source), ['INPUT p', 'ASYNC await p']);
  });

  it('does not treat .then as asynchrony (E9)', () => {
    const source = 'function f(p) { p.then(handle); }';
    assert.deepEqual(lines(source), ['INPUT p', 'CALL p.then(handle)']);
  });

  it('emits the implicit return of a concise arrow (§4.3-i)', () => {
    const source = 'const f = (x) => x * 2;';
    const result = extract(source);
    assert.equal(result.name, 'f');
    assert.deepEqual(lines(source), ['INPUT x', 'RET x * 2']);
  });

  it('renders return without expression as RET undefined (§4.3-j)', () => {
    const source = 'function f() { return; }';
    assert.deepEqual(lines(source), ['RET undefined']);
  });
});

describe('extractor — INPUT parameters (§3.2, §4.2)', () => {
  it('renders defaults and rest parameters', () => {
    const source = 'function f(a, b = 1, ...rest) { return rest; }';
    assert.deepEqual(lines(source), ['INPUT a', 'INPUT b = 1', 'INPUT ...rest', 'RET rest']);
  });

  it('extracts the unit name from a module.exports assignment', () => {
    const source = 'module.exports.f = function (x) { return x; };';
    const result = extract(source);
    assert.equal(result.name, 'f');
    assert.deepEqual(lines(source), ['INPUT x', 'RET x']);
  });
});

describe('extractor — non-determinable cases (§4.4)', () => {
  it('registers a this receiver as ND', () => {
    const source = 'function f() { this.send(1); }';
    assert.deepEqual(lines(source), [
      'CALL this.send(1)',
      'ND receiver is calling-context dependent: this',
    ]);
  });

  it('registers a computed callee as ND', () => {
    const source = 'function f(o, k) { return o[k](); }';
    assert.deepEqual(lines(source), [
      'INPUT o',
      'INPUT k',
      'CALL o[k]()',
      'RET o[k]()',
      'ND callee not statically resolvable: o[k]',
    ]);
  });

  it('registers a destructuring assignment target as ND', () => {
    const source = 'function f() { const { a } = load(); return a; }';
    assert.deepEqual(lines(source), ['CALL load()', 'RET a', 'ND assignment target: { a }']);
  });

  it('registers typeof over a dynamic operand as ND', () => {
    const source = "function f(x) { if (typeof x === 'string') return x; }";
    assert.deepEqual(lines(source), [
      'INPUT x',
      "COND typeof x === 'string' -> RET x",
      'ND dynamic operation: typeof x',
    ]);
  });

  it('does not flag typeof over a literal', () => {
    const source = 'function f() { return typeof 5; }';
    assert.deepEqual(lines(source), ['RET typeof 5']);
  });
});

describe('extractor — verbatim and determinism (E3, §4.1)', () => {
  it('removes comments and normalizes whitespace (E3)', () => {
    const source = [
      'function f(a) {',
      '  // leading comment',
      '  return a + /* inline */ 1;',
      '}',
    ].join('\n');
    assert.deepEqual(lines(source), ['INPUT a', 'RET a + 1']);
  });

  it('produces identical records across repeated runs (§4.1-1)', () => {
    const source = 'async function f(a, b = 1) { if (a) return await g(a); return b; }';
    const first = extract(source);
    const second = extract(source);
    assert.deepEqual(first, second);
  });

  it('throws when the AST is not a function unit', () => {
    assert.throws(() => extractFunction('const x = 1;', parseFunction('const x = 1;')), Error);
  });
});
