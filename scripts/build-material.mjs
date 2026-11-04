// scripts/build-material.mjs — S2 and S3 of the experimental protocol (§14.4).
//
// One parse per function, one shared AST, four representations derived from it:
// B0 (source), B1 (SBT), B2 (NIT) and P (JS-SemDocIR). No function is parsed
// twice and no representation is derived from another text form.
//
// Artifacts (outside git):
//   corpus/ast/<id>.json            shared Babel AST
//   corpus/repr/{b0,b1,b2,p}/<id>.txt
//   corpus/material-report.json     counts and byte sizes per representation

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { analyzeFunction } from '../src/core/analysis.ts';
import { serializeNit } from '../src/representations/serializers/nit.ts';
import { serializeSbt } from '../src/representations/serializers/sbt.ts';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CORPUS = path.join(ROOT, 'corpus');
const REPRESENTATIONS = ['b0', 'b1', 'b2', 'p'];

/**
 * Creates the directory tree and returns the writer for one representation.
 *
 * @param {string} directory - Target directory.
 * @returns {(id: string, content: string) => void} Writer keyed by function id.
 */
function writer(directory) {
  fs.mkdirSync(directory, { recursive: true });
  return (id, content) => fs.writeFileSync(path.join(directory, `${id}.txt`), content, 'utf8');
}

/**
 * Builds the AST and the four representations for every admitted function.
 *
 * @returns {void}
 */
function main() {
  const admittedPath = path.join(CORPUS, 'admitido.jsonl');
  const lines = fs
    .readFileSync(admittedPath, 'utf8')
    .split('\n')
    .filter((line) => line.trim().length > 0);

  const astDirectory = path.join(CORPUS, 'ast');
  fs.mkdirSync(astDirectory, { recursive: true });

  const writers = Object.fromEntries(
    REPRESENTATIONS.map((representation) => [
      representation,
      writer(path.join(CORPUS, 'repr', representation)),
    ]),
  );
  const bytes = Object.fromEntries(REPRESENTATIONS.map((representation) => [representation, 0]));
  const failures = [];

  for (const line of lines) {
    const record = JSON.parse(line);
    try {
      const analysis = analyzeFunction(record.code);
      if (!analysis.admission.admitted || analysis.functionNode === null) {
        failures.push({ id: record.id, cause: analysis.admission.cause });
        continue;
      }

      fs.writeFileSync(
        path.join(astDirectory, `${record.id}.json`),
        JSON.stringify(analysis.ast),
        'utf8',
      );

      const contents = {
        b0: record.code,
        b1: serializeSbt(analysis.functionNode, record.code),
        b2: serializeNit(analysis.functionNode, record.code),
        p: analysis.representation,
      };
      for (const representation of REPRESENTATIONS) {
        writers[representation](record.id, contents[representation]);
        bytes[representation] += Buffer.byteLength(contents[representation], 'utf8');
      }
    } catch (error) {
      failures.push({ id: record.id, cause: String(error.message).split('\n')[0] });
    }
  }

  const report = {
    functions: lines.length,
    built: lines.length - failures.length,
    failures,
    bytes,
  };
  fs.writeFileSync(
    path.join(CORPUS, 'material-report.json'),
    `${JSON.stringify(report, null, 2)}\n`,
    'utf8',
  );

  console.log(`built ${report.built}/${report.functions} functions`);
  for (const representation of REPRESENTATIONS) {
    console.log(`  ${representation}: ${(bytes[representation] / 1024).toFixed(1)} KiB`);
  }
  if (failures.length > 0) {
    console.error(`${failures.length} failures; first: ${JSON.stringify(failures[0])}`);
    process.exitCode = 1;
  }
}

main();
