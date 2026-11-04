// scripts/sample-rubric.mjs — sampling policy for the 100-case rubric (§11.2).
//
// The corpus is not balanced: asynchronous functions are 2,9 % of the admitted
// set, so "12–13 per stratum" cannot be met. Frozen policy (decision G):
//
//   1. quota_i = n_i * 100 / N, at least 1 per non-empty stratum;
//   2. the leftover goes to the largest fractional part (ties: larger stratum);
//   3. within a stratum, cases are ordered by sha256("42:<id>") and the first
//      quota_i are taken — one seed, no language-level randomness.
//
// Artifact (outside git): corpus/muestra-rubrica.csv

import { createHash } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORPUS = path.join(ROOT, 'corpus');
const TARGET = 100;
const SEED = 42;

/**
 * Reads the per-function characterization written by S5.
 *
 * @returns {Array<{id: string, estrato: string}>} One entry per admitted function.
 */
function readCharacterization() {
  const lines = fs
    .readFileSync(path.join(CORPUS, 'caracterizacion.csv'), 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);
  const [, ...rows] = lines;
  return rows.map((line) => {
    const [id, estrato] = line.split(',');
    return { id, estrato };
  });
}

/**
 * Allocates the sample across strata: proportional, at least one each, leftover
 * to the largest fractional part.
 *
 * @param {Map<string, number>} sizes - Stratum sizes.
 * @param {number} total - Sample size.
 * @returns {Map<string, number>} Quota per stratum summing to `total`.
 */
function allocate(sizes, total) {
  const corpusSize = [...sizes.values()].reduce((sum, size) => sum + size, 0);
  const exact = new Map(
    [...sizes].map(([stratum, size]) => [stratum, (size * total) / corpusSize]),
  );
  const quotas = new Map(
    [...exact].map(([stratum, value]) => [stratum, Math.max(1, Math.floor(value))]),
  );

  let assigned = [...quotas.values()].reduce((sum, quota) => sum + quota, 0);
  while (assigned < total) {
    const [stratum] = [...exact]
      .filter(([name]) => quotas.get(name) < sizes.get(name))
      .sort((a, b) => {
        const fraction = (a[1] % 1) - (b[1] % 1);
        if (Math.abs(fraction) > Number.EPSILON) return fraction > 0 ? -1 : 1;
        return sizes.get(b[0]) - sizes.get(a[0]);
      })[0];
    quotas.set(stratum, quotas.get(stratum) + 1);
    assigned += 1;
  }
  while (assigned > total) {
    const [stratum] = [...quotas].filter(([, quota]) => quota > 1).sort((a, b) => b[1] - a[1])[0];
    quotas.set(stratum, quotas.get(stratum) - 1);
    assigned -= 1;
  }
  return quotas;
}

/**
 * Deterministic per-case ordering key.
 *
 * @param {string} id - Function id.
 * @returns {string} Digest that fixes the draw.
 */
function key(id) {
  return createHash('sha256').update(`${SEED}:${id}`, 'utf8').digest('hex');
}

/**
 * Draws the rubric sample and writes it.
 *
 * @returns {void}
 */
function main() {
  const cases = readCharacterization();
  const byStratum = new Map();
  for (const item of cases) {
    const group = byStratum.get(item.estrato) ?? [];
    group.push(item.id);
    byStratum.set(item.estrato, group);
  }

  const sizes = new Map([...byStratum].map(([stratum, ids]) => [stratum, ids.length]));
  const quotas = allocate(sizes, TARGET);

  const sample = [];
  for (const stratum of [...sizes.keys()].sort()) {
    const ordered = [...byStratum.get(stratum)].sort((a, b) => key(a).localeCompare(key(b)));
    sample.push(...ordered.slice(0, quotas.get(stratum)).map((id) => [id, stratum]));
  }

  if (sample.length !== TARGET) {
    throw new Error(`sample has ${sample.length} cases, expected ${TARGET}`);
  }

  fs.writeFileSync(
    path.join(CORPUS, 'muestra-rubrica.csv'),
    ['id,estrato', ...sample.map((row) => row.join(','))].join('\n') + '\n',
    'utf8',
  );

  console.log(`sample ${sample.length} of ${cases.length} (seed ${SEED})`);
  for (const stratum of [...sizes.keys()].sort()) {
    console.log(`  ${stratum}: ${quotas.get(stratum)} of ${sizes.get(stratum)}`);
  }
}

main();
