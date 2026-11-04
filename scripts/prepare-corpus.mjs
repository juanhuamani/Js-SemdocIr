// scripts/prepare-corpus.mjs — S1 of the experimental protocol (spec §14.4).
//
// Classifies every downloaded function as admitted or excluded WITH its cause,
// using the frozen admission filter (§1.3). The window guard stays inactive
// until a tokenizer is fixed (§8.1); it only removes functions whose longest
// serialization exceeds the model window, which no candidate here approaches.
//
// Artifacts (outside git):
//   corpus/admitido.jsonl      admitted functions, original fields + stable id
//   corpus/exclusiones.csv     one row per excluded function: id, cause, detail
//   corpus/funciones.csv       complete classification, one row per function

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { filter, detectUnit } from '../src/core/ast/filter.ts';
import { parseFunction } from '../src/core/ast/parse.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORPUS = path.join(ROOT, 'corpus');
const RAW = path.join(CORPUS, 'raw.jsonl');
const EXPECTED = 3291;

/**
 * Routes a row to a stable, human-readable identifier.
 *
 * @param {number} index - Zero-based position in the corpus order.
 * @returns {string} Identifier such as `js-0001`.
 */
function functionId(index) {
  return `js-${String(index + 1).padStart(4, '0')}`;
}

/**
 * Quotes one CSV field when it contains a delimiter, a quote or a line break.
 *
 * @param {string|number|null|undefined} value - Field value.
 * @returns {string} Field ready to join with commas.
 */
function csvField(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return /[",\r\n]/.test(text) ? `"${text.replaceAll('"', '""')}"` : text;
}

/**
 * Classifies one function according to the frozen filter.
 *
 * A fragment that fails to parse is probed once inside parentheses: CodeSearchNet
 * cuts `code` from `function(…) {…}`, dropping the `var x =` or `module.exports.x =`
 * on its left, so those rows are valid function expressions without a binding and
 * their cause is `not-a-unit` (§1.1), not a syntax error. Everything else — JSX,
 * Flow/TypeScript annotations, decorators — stays `syntax`.
 *
 * @param {string} code - JavaScript source of the function.
 * @returns {{admitted: boolean, cause: string|null, detail: string|null}} Classification.
 */
function classify(code) {
  if (typeof code !== 'string' || code.trim().length === 0) {
    return { admitted: false, cause: 'syntax', detail: 'empty source' };
  }
  try {
    const ast = parseFunction(code);
    if (detectUnit(ast.program.body) === null) {
      return { admitted: false, cause: 'not-a-unit', detail: 'not a single function unit (§1.1)' };
    }
    return filter(ast);
  } catch (error) {
    const detail = String(error.message).split('\n')[0];
    if (isExpressionFragment(code)) {
      return {
        admitted: false,
        cause: 'not-a-unit',
        detail: 'function expression fragment without binding (§1.1)',
      };
    }
    return { admitted: false, cause: 'syntax', detail };
  }
}

/**
 * Determines whether a fragment that is not a valid program is a valid
 * expression, which is how an anonymous function without its binding behaves.
 *
 * @param {string} code - Source fragment.
 * @returns {boolean} `true` if the fragment parses when parenthesized.
 */
function isExpressionFragment(code) {
  try {
    parseFunction(`(${code}\n)`);
    return true;
  } catch {
    return false;
  }
}

/**
 * Reads the corpus, classifies every function and writes the S1 artifacts.
 *
 * @returns {void}
 */
function main() {
  const raw = fs.readFileSync(RAW, 'utf8');
  const lines = raw.split('\n').filter((line) => line.trim().length > 0);
  if (lines.length !== EXPECTED) {
    throw new Error(`${lines.length} functions in raw.jsonl, expected ${EXPECTED}`);
  }

  const admitted = [];
  const exclusions = [];
  const classification = [];
  const byCause = new Map();

  lines.forEach((line, index) => {
    const record = JSON.parse(line);
    const id = functionId(index);
    const result = classify(record.code);

    classification.push([
      id,
      record.url ?? '',
      record.repo ?? '',
      record.path ?? '',
      record.func_name ?? '',
      result.admitted ? 'admitida' : 'excluida',
      result.cause ?? '',
    ]);

    if (result.admitted) {
      admitted.push({ ...record, id });
      return;
    }

    exclusions.push([id, record.url ?? '', result.cause, result.detail]);
    const key = result.cause;
    byCause.set(key, (byCause.get(key) ?? 0) + 1);
  });

  if (admitted.length + exclusions.length !== EXPECTED) {
    throw new Error('classification does not partition the corpus');
  }

  const admittedText = admitted.map((record) => JSON.stringify(record)).join('\n');
  fs.writeFileSync(path.join(CORPUS, 'admitido.jsonl'), `${admittedText}\n`, 'utf8');

  const exclusionText = [
    'id,url,causa,detalle',
    ...exclusions.map((row) => row.map(csvField).join(',')),
  ].join('\n');
  fs.writeFileSync(path.join(CORPUS, 'exclusiones.csv'), `${exclusionText}\n`, 'utf8');

  const classificationText = [
    'id,url,repo,path,func_name,estado,causa',
    ...classification.map((row) => row.map(csvField).join(',')),
  ].join('\n');
  fs.writeFileSync(path.join(CORPUS, 'funciones.csv'), `${classificationText}\n`, 'utf8');

  console.log(`total ${EXPECTED} · admitidas ${admitted.length} · excluidas ${exclusions.length}`);
  for (const [cause, count] of [...byCause].sort((a, b) => b[1] - a[1])) {
    const share = ((count / EXPECTED) * 100).toFixed(2);
    console.log(`  ${cause.padEnd(14)} ${String(count).padStart(5)}  ${share}%`);
  }
  fs.writeFileSync(
    path.join(CORPUS, 'exclusiones-resumen.csv'),
    [
      'causa,conteo,porcentaje',
      ...[...byCause]
        .sort((a, b) => b[1] - a[1])
        .map(([cause, count]) => `${cause},${count},${((count / EXPECTED) * 100).toFixed(2)}`),
    ].join('\n') + '\n',
    'utf8',
  );
  console.log('wrote corpus/admitido.jsonl, corpus/exclusiones.csv, corpus/funciones.csv');
}

main();
