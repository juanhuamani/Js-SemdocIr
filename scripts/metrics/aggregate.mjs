#!/usr/bin/env node
/**
 * Une BLEU, BERTScore, tokens y latencia en una tabla por condición.
 *
 * Uso: node scripts/metrics/aggregate.mjs \
 *   --experiment experimento/salidas.jsonl \
 *   --bleu experimento/metricas/bleu.jsonl \
 *   --bertscore experimento/metricas/bertscore.jsonl
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';

const REPRESENTATIONS = ['b0', 'b1', 'b2', 'p'];

function parseArgs(argv) {
  const options = {
    experiment: 'experimento/salidas.jsonl',
    bleu: 'experimento/metricas/bleu.jsonl',
    bertscore: 'experimento/metricas/bertscore.jsonl',
    rouge: 'experimento/metricas/rouge.jsonl',
    out: 'experimento/metricas/tabla.csv',
  };
  for (let i = 0; i < argv.length; i += 1) {
    const key = argv[i].replace(/^--/, '');
    if (!(key in options)) throw new Error(`Argumento desconocido: ${argv[i]}`);
    options[key] = argv[(i += 1)];
  }
  return options;
}

async function readJsonLines(file) {
  const text = await readFile(file, 'utf8');
  return text
    .split('\n')
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line));
}

const mean = (values) => (values.length === 0 ? 0 : values.reduce((a, b) => a + b, 0) / values.length);
const median = (values) => {
  if (values.length === 0) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)];
};
const key = (row) => `${row.id}::${row.representation}`;

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const optional = async (file) => {
    try {
      return await readJsonLines(file);
    } catch {
      return [];
    }
  };
  const [outputs, bleuRows, bertRows, rougeRows] = await Promise.all([
    readJsonLines(options.experiment),
    readJsonLines(options.bleu),
    readJsonLines(options.bertscore),
    optional(options.rouge),
  ]);

  const bleu = new Map(bleuRows.map((row) => [key(row), row.bleu]));
  const bert = new Map(bertRows.map((row) => [key(row), row.f1]));
  const rouge = new Map(rougeRows.map((row) => [key(row), row.f1]));
  const rows = outputs.filter((row) => row.status === 'succeeded');

  const lines = ['condicion,n,bleu_medio,bertscore_f1_medio,rougeL_medio,tokens_entrada_medio,tokens_salida_medio,latencia_ms_mediana'];
  const table = [];

  for (const representation of REPRESENTATIONS) {
    const group = rows.filter((row) => row.representation === representation);
    if (group.length === 0) continue;
    const bleuValues = group.map((row) => bleu.get(key(row))).filter((value) => typeof value === 'number');
    const bertValues = group.map((row) => bert.get(key(row))).filter((value) => typeof value === 'number');
    const rougeValues = group.map((row) => rouge.get(key(row))).filter((value) => typeof value === 'number');
    const entry = {
      representation,
      n: group.length,
      bleu: mean(bleuValues),
      bert: mean(bertValues),
      rouge: mean(rougeValues),
      inputTokens: mean(group.map((row) => row.inputTokens)),
      outputTokens: mean(group.map((row) => row.outputTokens)),
      latency: median(group.map((row) => row.latencyMs)),
    };
    table.push(entry);
    lines.push(
      [
        representation,
        entry.n,
        entry.bleu.toFixed(2),
        entry.bert.toFixed(4),
        entry.rouge.toFixed(4),
        entry.inputTokens.toFixed(1),
        entry.outputTokens.toFixed(1),
        entry.latency,
      ].join(','),
    );
  }

  await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
  await writeFile(path.resolve(options.out), `${lines.join('\n')}\n`, 'utf8');

  console.log('| Condición | n | BLEU-4 | BERTScore F1 | ROUGE-L | Tokens entrada | Tokens salida | Latencia p50 |');
  console.log('|---|---:|---:|---:|---:|---:|---:|---:|');
  for (const row of table) {
    console.log(
      `| ${row.representation} | ${row.n} | ${row.bleu.toFixed(2)} | ${row.bert.toFixed(4)} | ${row.rouge.toFixed(4)} | ${row.inputTokens.toFixed(0)} | ${row.outputTokens.toFixed(0)} | ${row.latency} ms |`,
    );
  }
  console.log(`\nTabla escrita en ${options.out}`);
}

await main();
