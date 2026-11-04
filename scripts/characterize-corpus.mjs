// scripts/characterize-corpus.mjs — S5 of the experimental protocol (§14.4).
//
// Describes the admitted corpus: exclusion shares, the eight category strata of
// §11.2 and the length of every representation. Lengths are reported in
// characters and UTF-8 bytes; the token column waits for the frozen tokenizer,
// which is the model's and is not fixed yet (§8.1, provisional decision).
//
// Artifacts (outside git):
//   corpus/caracterizacion.csv          one row per admitted function
//   corpus/caracterizacion-resumen.json medians, strata and exclusion shares

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { detectUnit } from '../src/core/ast/filter.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORPUS = path.join(ROOT, 'corpus');
const REPRESENTATIONS = ['b0', 'b1', 'b2', 'p'];
const CONDITIONAL = new Set([
  'IfStatement',
  'ConditionalExpression',
  'SwitchCase',
  'LogicalExpression',
]);

/**
 * Walks a node and records whether any nested `return` sits under a condition.
 *
 * @param {any} node - Root node.
 * @param {boolean} [conditional] - Whether an ancestor already branches.
 * @returns {{conditionalReturn: boolean}} Observed profile flags.
 */
function inspectReturn(node, conditional = false) {
  if (node === null || typeof node !== 'object') return { conditionalReturn: false };
  if (Array.isArray(node)) {
    for (const item of node) {
      if (inspectReturn(item, conditional).conditionalReturn) return { conditionalReturn: true };
    }
    return { conditionalReturn: false };
  }
  if (typeof node.type !== 'string') return { conditionalReturn: false };

  if (node.type === 'ReturnStatement' && conditional) return { conditionalReturn: true };

  const branches = conditional || CONDITIONAL.has(node.type);
  for (const [key, value] of Object.entries(node)) {
    if (key === 'loc' || key === 'start' || key === 'end' || key === 'extra') continue;
    if (inspectReturn(value, branches).conditionalReturn) return { conditionalReturn: true };
  }
  return { conditionalReturn: false };
}

/**
 * Computes the profile bits of one function from its stored AST.
 *
 * @param {any} ast - Babel File node.
 * @returns {{async: boolean, tryCatch: boolean, conditionalReturn: boolean, stratum: string}} Profile.
 */
function profile(ast) {
  const unit = detectUnit(ast.program.body);
  if (unit === null) throw new Error('stored AST is not a function unit');
  const serialized = JSON.stringify(unit.node.body);
  const isAsync = unit.isAsync;
  const tryCatch = serialized.includes('"TryStatement"');
  const { conditionalReturn } = inspectReturn(unit.node.body);
  const ternary = (value) => (value ? '1' : '0');
  return {
    async: isAsync,
    tryCatch,
    conditionalReturn,
    stratum: `a${ternary(isAsync)}t${ternary(tryCatch)}r${ternary(conditionalReturn)}`,
  };
}

/**
 * Median of a numeric list (the mean of the two central values when even).
 *
 * @param {number[]} values - Sample.
 * @returns {number|null} Median, or null for an empty sample.
 */
function median(values) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0 ? (sorted[middle - 1] + sorted[middle]) / 2 : sorted[middle];
}

/**
 * Builds the characterization table and summary.
 *
 * @returns {void}
 */
function main() {
  const admitted = fs
    .readFileSync(path.join(CORPUS, 'admitido.jsonl'), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));

  const strata = new Map();
  const chars = Object.fromEntries(REPRESENTATIONS.map((representation) => [representation, []]));
  const bytes = Object.fromEntries(REPRESENTATIONS.map((representation) => [representation, []]));
  const rows = [
    [
      'id',
      'estrato',
      'asincrona',
      'try_catch',
      'retorno_condicional',
      ...REPRESENTATIONS.map((representation) => `chars_${representation}`),
    ],
  ];

  for (const record of admitted) {
    const ast = JSON.parse(fs.readFileSync(path.join(CORPUS, 'ast', `${record.id}.json`), 'utf8'));
    const { async, tryCatch, conditionalReturn, stratum } = profile(ast);
    strata.set(stratum, (strata.get(stratum) ?? 0) + 1);

    const sizes = [];
    for (const representation of REPRESENTATIONS) {
      const content = fs.readFileSync(
        path.join(CORPUS, 'repr', representation, `${record.id}.txt`),
        'utf8',
      );
      chars[representation].push(content.length);
      bytes[representation].push(Buffer.byteLength(content, 'utf8'));
      sizes.push(content.length);
    }

    rows.push([
      record.id,
      stratum,
      async ? '1' : '0',
      tryCatch ? '1' : '0',
      conditionalReturn ? '1' : '0',
      ...sizes,
    ]);
  }

  fs.writeFileSync(
    path.join(CORPUS, 'caracterizacion.csv'),
    `${rows.map((row) => row.join(',')).join('\n')}\n`,
    'utf8',
  );

  const summary = {
    admitted: admitted.length,
    strata: Object.fromEntries([...strata].sort()),
    medianChars: Object.fromEntries(
      REPRESENTATIONS.map((representation) => [representation, median(chars[representation])]),
    ),
    maxChars: Object.fromEntries(
      REPRESENTATIONS.map((representation) => [representation, Math.max(...chars[representation])]),
    ),
    medianBytes: Object.fromEntries(
      REPRESENTATIONS.map((representation) => [representation, median(bytes[representation])]),
    ),
    tokens: 'pending: frozen tokenizer not fixed yet (§8.1)',
  };
  fs.writeFileSync(
    path.join(CORPUS, 'caracterizacion-resumen.json'),
    `${JSON.stringify(summary, null, 2)}\n`,
    'utf8',
  );

  console.log(`admitted ${admitted.length}`);
  console.log('strata:', JSON.stringify(summary.strata));
  for (const representation of REPRESENTATIONS) {
    console.log(
      `  ${representation}: median ${summary.medianChars[representation]} chars · max ${summary.maxChars[representation]} · median ${summary.medianBytes[representation]} bytes`,
    );
  }
  console.log('wrote corpus/caracterizacion.csv and caracterizacion-resumen.json');
}

main();
