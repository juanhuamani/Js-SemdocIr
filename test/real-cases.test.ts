// test/real-cases.test.ts - replay data is read from stored files, never generated.

import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';

import { loadRealCases } from '../src/interfaces/http/real-cases.ts';

const id = 'js-0001';

function jsonl(rows: unknown[]): string {
  return `${rows.map((row) => JSON.stringify(row)).join('\n')}\n`;
}

describe('real cases replay loader', () => {
  let root: string;

  before(async () => {
    root = await mkdtemp(join(tmpdir(), 'jssemdocir-cases-'));
    await mkdir(join(root, 'corpus/repr/b0'), { recursive: true });
    await mkdir(join(root, 'corpus/repr/b1'), { recursive: true });
    await mkdir(join(root, 'corpus/repr/b2'), { recursive: true });
    await mkdir(join(root, 'corpus/repr/p'), { recursive: true });
    await mkdir(join(root, 'experimento/metricas-codex-full'), { recursive: true });

    await writeFile(
      join(root, 'corpus/admitido.jsonl'),
      jsonl([
        {
          id,
          repo: 'axios/axios',
          path: 'lib/axios.js',
          func_name: 'createInstance',
          url: 'https://github.com/axios/axios/blob/abc/lib/axios.js#L15-L26',
          docstring: 'Create an instance of Axios',
        },
      ]),
    );
    for (const representation of ['b0', 'b1', 'b2', 'p']) {
      await writeFile(
        join(root, `corpus/repr/${representation}/${id}.txt`),
        `input-${representation}`,
      );
    }

    const base = {
      id,
      status: 'succeeded',
      functionName: 'createInstance',
      output: 'Creates an instance.',
      attempts: 1,
      cacheHit: false,
      inputTokens: 10,
      outputTokens: 4,
      latencyMs: 1200,
      model: 'test/model',
    };
    await writeFile(
      join(root, 'experimento/salidas-codex.jsonl'),
      jsonl(['b0', 'b1', 'b2', 'p'].map((representation) => ({ ...base, representation }))),
    );
    await writeFile(
      join(root, 'experimento/metricas-codex-full/bleu.jsonl'),
      jsonl(['b0', 'b1', 'b2', 'p'].map((representation) => ({ id, representation, bleu: 2.5 }))),
    );
    await writeFile(
      join(root, 'experimento/metricas-codex-full/rouge.jsonl'),
      jsonl(
        ['b0', 'b1', 'b2', 'p'].map((representation) => ({
          id,
          representation,
          f1: 0.25,
        })),
      ),
    );
    await writeFile(
      join(root, 'experimento/metricas-codex-full/bertscore.jsonl'),
      jsonl(['b0', 'b1', 'b2', 'p'].map((representation) => ({ id, representation, f1: 0.4 }))),
    );
    await writeFile(
      join(root, 'protocol.json'),
      JSON.stringify({
        protocolVersion: '1.0-draft',
        prompt: 'Write one sentence.',
        generation: { temperature: 0, topP: 'provider-default', maxTokens: 128, seed: null },
        corpus: {
          dataset: 'test',
          sourceCommit: 'abc',
          seed: 42,
          parserVersion: '@babel/parser 8.0.7',
        },
      }),
    );
  });

  after(async () => {
    await rm(root, { recursive: true, force: true });
  });

  it('builds a replay case from datasets, run records and metric files', async () => {
    const payload = await loadRealCases(root);
    const [item] = payload.cases;

    assert.equal(payload.mode, 'demo-replay');
    assert.match(payload.notice, /precalculados/i);
    assert.equal(payload.run.model, 'test/model');
    assert.equal(payload.cases.length, 1);
    assert.equal(item?.id, id);
    assert.equal(item?.category, 'acierto');
    assert.equal(item?.input, 'input-p');
    assert.equal(item?.output, 'Creates an instance.');
    assert.equal(item?.reference, 'Create an instance of Axios');
    assert.equal(item?.metrics.bleu, 2.5);
    assert.equal(item?.metrics.rougeL, 0.25);
    assert.equal(item?.metrics.bertscore, 0.4);
    assert.equal(item?.metrics.latencyMs, 1200);
    assert.equal(item?.parameters.model, 'test/model');
    assert.equal(item?.parameters.temperature, 0);
    assert.deepEqual(
      item?.representations.map(({ id: representation }) => representation),
      ['b0', 'b1', 'b2', 'p'],
    );
  });

  it('rejects a run without any curated case', async () => {
    await writeFile(join(root, 'experimento/salidas-codex.jsonl'), jsonl([]));
    await assert.rejects(loadRealCases(root), /No se encontraron casos/);
  });
});
