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

  it('returns all four representations and mock outcomes for pasted source', async () => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'function suma(a, b) { return a + b; }' }),
    });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      representations: Record<string, { content: string }>;
      generations: Array<{ output?: string; status: string }>;
    };
    assert.deepEqual(Object.keys(body.representations), ['b0', 'b1', 'b2', 'p']);
    assert.equal(body.generations.length, 4);
    assert.ok(body.generations.every((item) => item.status === 'succeeded'));
    assert.match(body.generations[0]?.output ?? '', /^\[MOCK\]/);
  });

  it('returns an actionable error for invalid JavaScript', async () => {
    const response = await fetch(`${baseUrl}/api/analyze`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ source: 'function {' }),
    });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /parse|syntax|unexpected/i);
  });
});
