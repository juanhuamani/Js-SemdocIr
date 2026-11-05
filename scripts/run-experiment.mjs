#!/usr/bin/env node
/**
 * Runs the JS-SemDocIR experiment over the frozen corpus.
 *
 * Pilot:   npm run experiment -- --limit 50 --out experimento/piloto.jsonl
 * Full:    npm run experiment
 * Dry run: npm run experiment -- --dry-run
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import path from 'node:path';

import { GenerationService } from '../src/generation/generation-service.ts';
import { FileGenerationCache } from '../src/generation/cache.ts';
import { ProviderGenerationClient } from '../src/generation/provider-client.ts';
import { loadProviderConfig } from '../src/generation/provider-config.ts';

const REPRESENTATIONS = ['b0', 'b1', 'b2', 'p'];
const PROMPT_PATH = path.resolve('protocol.json');
const CORPUS_PATH = path.resolve('corpus/admitido.jsonl');
const REPR_DIR = path.resolve('corpus/repr');

function parseArgs(argv) {
  const options = {
    limit: null,
    concurrency: 4,
    out: null,
    version: process.env.COMMANDCODE_MODEL_VERSION ?? 'unfrozen',
    dryRun: false,
  };
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === '--limit') options.limit = Number(argv[(i += 1)]);
    else if (arg === '--concurrency') options.concurrency = Number(argv[(i += 1)]);
    else if (arg === '--out') options.out = argv[(i += 1)];
    else if (arg === '--version') options.version = argv[(i += 1)];
    else if (arg === '--dry-run') options.dryRun = true;
    else throw new Error(`Argumento desconocido: ${arg}`);
  }
  options.out ??= options.limit === null ? 'experimento/salidas.jsonl' : 'experimento/piloto.jsonl';
  return options;
}

async function readJsonLines(file) {
  const lines = [];
  const reader = createInterface({ input: createReadStream(file, 'utf8'), crlfDelay: Infinity });
  for await (const line of reader) {
    if (line.trim().length > 0) lines.push(JSON.parse(line));
  }
  return lines;
}

function selectEvenly(records, limit) {
  if (limit === null || limit >= records.length) return records;
  const step = Math.max(1, Math.floor(records.length / limit));
  const selected = [];
  for (let i = 0; i < records.length && selected.length < limit; i += step)
    selected.push(records[i]);
  return selected;
}

function buildRequest(record, representation, input, protocol, config, version) {
  return {
    protocolVersion: '1.0-experiment',
    clientMode: 'provider',
    provider: 'commandcode',
    model: config.model,
    modelVersion: version,
    functionId: record.id,
    representation,
    prompt: protocol.prompt,
    input,
    parameters: {
      temperature: 0,
      topP: 'provider-default',
      maxTokens: 128,
      seed: null,
      reasoningEffort: 'off',
    },
  };
}

function summarize(results, startedAt) {
  const total = results.length;
  const ok = results.filter((r) => r.status === 'succeeded');
  const empty = ok.filter((r) => r.output.trim().length === 0);
  const jsdoc = ok.filter(
    (r) => r.output.trimStart().startsWith('/**') || r.output.includes('@param'),
  );
  const truncated = results.filter(
    (r) => r.error?.includes('max_tokens') || r.error?.includes('length'),
  );
  const inputTokens = ok.reduce((sum, r) => sum + r.inputTokens, 0);
  const outputTokens = ok.reduce((sum, r) => sum + r.outputTokens, 0);
  const latencies = ok.map((r) => r.latencyMs).sort((a, b) => a - b);
  const p50 = latencies.length === 0 ? 0 : latencies[Math.floor(latencies.length / 2)];
  const cost = (inputTokens * 0.15 + outputTokens * 0.6) / 1_000_000;
  const minutes = ((Date.now() - startedAt) / 60000).toFixed(1);

  return [
    `llamadas: ${total} · éxito: ${ok.length} · error: ${total - ok.length}`,
    `vacías: ${empty.length} (${((empty.length / Math.max(total, 1)) * 100).toFixed(1)} %)`,
    `con bloque JSDoc/@param: ${jsdoc.length} (${((jsdoc.length / Math.max(total, 1)) * 100).toFixed(1)} %)`,
    `truncadas: ${truncated.length}`,
    `tokens: ${inputTokens} entrada · ${outputTokens} salida`,
    `latencia p50: ${p50} ms · total: ${minutes} min`,
    `costo estimado: ${cost.toFixed(4)} USD`,
    `salida: ${results.path ?? 'definida por --out'}`,
  ].join('\n');
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const protocol = JSON.parse(await readFile(PROMPT_PATH, 'utf8'));
  const records = selectEvenly(await readJsonLines(CORPUS_PATH), options.limit);
  const tasks = records.flatMap((record) =>
    REPRESENTATIONS.map((representation) => ({ record, representation })),
  );

  if (options.dryRun) {
    console.log(
      `funciones: ${records.length} · llamadas: ${tasks.length} · concurrencia: ${options.concurrency}`,
    );
    return;
  }

  const config = loadProviderConfig();
  const service = new GenerationService(new ProviderGenerationClient(config), {
    cache: new FileGenerationCache(path.resolve('experimento/cache')),
  });

  const startedAt = Date.now();
  const results = new Array(tasks.length);
  let next = 0;
  let done = 0;

  async function worker() {
    while (next < tasks.length) {
      const index = next;
      next += 1;
      const { record, representation } = tasks[index];
      let input;
      try {
        input = await readFile(path.join(REPR_DIR, representation, `${record.id}.txt`), 'utf8');
      } catch {
        results[index] = {
          id: record.id,
          representation,
          status: 'failed',
          error: 'missing-representation',
          attempts: 0,
          cacheHit: false,
          inputTokens: 0,
          outputTokens: 0,
          latencyMs: 0,
        };
        continue;
      }

      const result = await service.run(
        buildRequest(record, representation, input, protocol, config, options.version),
      );
      results[index] =
        result.status === 'succeeded'
          ? {
              id: record.id,
              representation,
              status: 'succeeded',
              functionName: record.func_name,
              output: result.response.output,
              attempts: result.attempts,
              cacheHit: result.cacheHit,
              inputTokens: result.response.metadata.inputTokens,
              outputTokens: result.response.metadata.outputTokens,
              latencyMs: result.response.metadata.latencyMs,
              model: result.response.metadata.model,
            }
          : {
              id: record.id,
              representation,
              status: 'failed',
              error: result.error.message,
              attempts: result.attempts,
              cacheHit: result.cacheHit,
              inputTokens: 0,
              outputTokens: 0,
              latencyMs: 0,
            };

      done += 1;
      if (done % 20 === 0 || done === tasks.length) {
        process.stdout.write(`\r${done}/${tasks.length} llamadas…`);
      }
    }
  }

  await Promise.all(Array.from({ length: options.concurrency }, () => worker()));
  process.stdout.write('\n');

  await mkdir(path.dirname(path.resolve(options.out)), { recursive: true });
  await writeFile(
    path.resolve(options.out),
    results.map((r) => JSON.stringify(r)).join('\n') + '\n',
    'utf8',
  );
  results.path = options.out;
  console.log(summarize(results, startedAt));
}

await main();
