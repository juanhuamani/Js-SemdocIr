import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';

import { createAppServer } from '../src/server.ts';

describe('local web app', () => {
  const server = createAppServer();
  let baseUrl: string;

  before(async () => {
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    const address = server.address() as AddressInfo;
    baseUrl = `http://127.0.0.1:${address.port}`;
  });

  after(() => {
    server.close();
  });

  it('serves the interactive page from the local server', async () => {
    const response = await fetch(baseUrl);
    assert.equal(response.status, 200);
    assert.match(response.headers.get('content-type') ?? '', /text\/html/);
    assert.match(await response.text(), /Procesar función/);
  });

  it('returns only the implemented JS-SemDocIR representation for pasted source', async () => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'function suma(a, b) { return a + b; }' }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      representation: { id: string; name: string; content: string };
      pipeline: Array<{ id: string; status: string }>;
      documentation: { status: string };
      stages: {
        ast: { rootType: string; nodeCount: number; text: string };
        filter: {
          admitted: boolean;
          checks: Array<{ name: string; status: string }>;
        };
        extraction: {
          name: string;
          params: string[];
          records: Array<{ category: string; content: string; order: number }>;
        };
        representation: string;
      };
      representations?: Record<string, unknown>;
    };
    assert.equal(body.representation.id, 'p');
    assert.equal(body.representation.name, 'JS-SemDocIR');
    assert.match(body.representation.content, /^func suma\(a, b\)/);
    assert.deepEqual(body.pipeline, [
      { id: 'parse', status: 'completado' },
      { id: 'filter', status: 'admitida' },
      { id: 'extract', status: 'completado' },
      { id: 'assemble', status: 'completado' },
    ]);
    assert.equal(body.documentation.status, 'not_configured');
    assert.equal(body.representations, undefined);
    assert.equal(body.stages.ast.rootType, 'FunctionDeclaration');
    assert.ok(body.stages.ast.nodeCount > 1);
    assert.match(body.stages.ast.text, /BinaryExpression/);
    assert.equal(body.stages.filter.admitted, true);
    assert.deepEqual(
      body.stages.filter.checks.map(({ status }) => status),
      ['aprobado', 'aprobado', 'aprobado', 'no evaluado'],
    );
    assert.equal(body.stages.extraction.name, 'suma');
    assert.deepEqual(body.stages.extraction.params, ['a', 'b']);
    assert.ok(body.stages.extraction.records.some(({ category }) => category === 'RET'));
    assert.equal(body.stages.representation, body.representation.content);
  });

  it('serves the separate B0/B1/B2/P comparison as an explicitly simulated preview', async () => {
    const source = 'function suma(a, b) { return a + b; }';
    const response = await fetch(`${baseUrl}/api/compare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      mode: string;
      clientMode: string;
      notice: string;
      artifacts: Record<string, { content: string }>;
      generations: Record<string, { status: string; output: string; simulated: boolean }>;
    };
    assert.equal(body.mode, 'experimental-comparison-preview');
    assert.equal(body.clientMode, 'mock');
    assert.match(body.notice, /simulada.*no se generó documentación/i);
    assert.deepEqual(Object.keys(body.artifacts), ['b0', 'b1', 'b2', 'p']);
    assert.equal(body.artifacts.b0?.content, source);
    assert.match(body.artifacts.b1?.content ?? '', /^<FunctionDeclaration/);
    assert.match(body.artifacts.b2?.content ?? '', /^\[0,/);
    assert.match(body.artifacts.p?.content ?? '', /^func suma\(a, b\)/);
    for (const id of ['b0', 'b1', 'b2', 'p']) {
      assert.equal(body.generations[id]?.status, 'succeeded');
      assert.equal(body.generations[id]?.simulated, true);
      assert.match(body.generations[id]?.output ?? '', /^\[MOCK\]/);
    }
  });

  it('rejects an unsupported function in the comparison preview without calling a model', async () => {
    const response = await fetch(`${baseUrl}/api/compare`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'function* unsupported() { yield 1; }' }),
    });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { cause: string; error: string };
    assert.equal(body.cause, 'generator');
    assert.match(body.error, /subconjunto admitido/i);
  });

  it('returns an actionable error for invalid JavaScript', async () => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'function {' }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as {
      error: string;
      failedStep: string;
      pipeline: Array<{ id: string; status: string }>;
      stages: { ast: unknown; filter: unknown; extraction: unknown; representation: unknown };
    };
    assert.match(body.error, /parse|syntax|unexpected/i);
    assert.equal(body.failedStep, 'parse');
    assert.deepEqual(body.stages, {
      ast: null,
      filter: null,
      extraction: null,
      representation: null,
    });
    assert.deepEqual(body.pipeline, [
      { id: 'parse', status: 'rechazada' },
      { id: 'filter', status: 'no ejecutado' },
      { id: 'extract', status: 'no ejecutado' },
      { id: 'assemble', status: 'no ejecutado' },
    ]);
  });

  it('stops at the admission filter and reports later stages as not executed', async () => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'function* unsupported() { yield 1; }' }),
    });
    assert.equal(response.status, 422);
    const body = (await response.json()) as {
      failedStep: string;
      pipeline: Array<{ id: string; status: string }>;
      stages: {
        ast: { rootType: string; text: string };
        filter: { admitted: boolean; cause: string; detail: string };
        extraction: unknown;
        representation: unknown;
      };
    };
    assert.equal(body.failedStep, 'filter');
    assert.equal(body.stages.ast.rootType, 'FunctionDeclaration');
    assert.match(body.stages.ast.text, /FunctionDeclaration/);
    assert.equal(body.stages.filter.admitted, false);
    assert.equal(body.stages.filter.cause, 'generator');
    assert.match(body.stages.filter.detail, /generator/i);
    assert.equal(body.stages.extraction, null);
    assert.equal(body.stages.representation, null);
    assert.deepEqual(body.pipeline, [
      { id: 'parse', status: 'completado' },
      { id: 'filter', status: 'rechazada' },
      { id: 'extract', status: 'no ejecutado' },
      { id: 'assemble', status: 'no ejecutado' },
    ]);
  });
});
