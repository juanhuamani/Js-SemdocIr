import assert from 'node:assert/strict';
import { once } from 'node:events';
import { after, before, describe, it } from 'node:test';
import type { AddressInfo } from 'node:net';

import {
  GenerationClientError,
  type GenerationClient,
  type GenerationRequest,
  type GenerationResponse,
} from '../src/generation/index.ts';
import { createAppServer } from '../src/interfaces/http/server.ts';

const source = [
  'function normalizeName(value) {',
  '  if (typeof value !== "string") throw new TypeError("value must be a string");',
  '  return value.trim().toLowerCase();',
  '}',
].join('\n');

describe('POST /api/generate', () => {
  let mode: 'ok' | 'provider-error' | 'missing-config' = 'ok';
  let captured: GenerationRequest | null = null;

  const client: GenerationClient = {
    async generate(request): Promise<GenerationResponse> {
      captured = request;
      if (mode === 'provider-error') {
        throw new GenerationClientError('el proveedor respondió 429', { statusCode: 429 });
      }
      return {
        output: 'Normaliza un nombre: valida el tipo, recorta y pasa a minúsculas.',
        metadata: {
          client: 'provider',
          model: request.model ?? 'test/model',
          inputTokens: 108,
          outputTokens: 25,
          latencyMs: 2600,
          simulated: false,
        },
      };
    },
  };

  const server = createAppServer({
    createProvider: () => {
      if (mode === 'missing-config') {
        throw new GenerationClientError('COMMANDCODE_MODEL no está definido');
      }
      return { client, model: 'test/model' };
    },
  });
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

  function post(body: unknown): Promise<Response> {
    return fetch(`${baseUrl}/api/generate`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body),
    });
  }

  it('sends the selected representation with the frozen probe parameters', async () => {
    mode = 'ok';
    captured = null;
    const response = await post({ source, representation: 'b1' });
    assert.equal(response.status, 200);
    const body = (await response.json()) as {
      mode: string;
      representation: string;
      output: string;
      input: string;
      metadata: { model: string; inputTokens: number; latencyMs: number };
    };
    assert.equal(body.mode, 'ui-probe');
    assert.equal(body.representation, 'b1');
    assert.match(body.output, /Normaliza un nombre/);
    assert.ok(body.input.length > 0);
    assert.equal(body.metadata.model, 'test/model');
    assert.equal(body.metadata.inputTokens, 108);
    assert.equal(body.metadata.latencyMs, 2600);

    assert.ok(captured !== null);
    const sent = captured as GenerationRequest;
    assert.equal(sent.model, 'test/model');
    assert.equal(sent.representation, 'b1');
    assert.equal(sent.parameters.temperature, 0);
    assert.equal(sent.parameters.maxTokens, 128);
    assert.equal(sent.parameters.reasoningEffort, 'off');
    assert.ok(sent.input.length > 0);
  });

  it('defaults to the P representation', async () => {
    mode = 'ok';
    captured = null;
    const response = await post({ source });
    assert.equal(response.status, 200);
    assert.equal((captured as GenerationRequest | null)?.representation, 'p');
  });

  it('rejects an unknown representation', async () => {
    const response = await post({ source, representation: 'b9' });
    assert.equal(response.status, 400);
    const body = (await response.json()) as { error: string };
    assert.match(body.error, /b0, b1, b2 o p/);
  });

  it('rejects a request without source', async () => {
    const response = await post({ representation: 'p' });
    assert.equal(response.status, 400);
  });

  it('returns 422 when the function is outside the admitted subset', async () => {
    const response = await post({ source: 'const x = 1;' });
    assert.equal(response.status, 422);
    const body = (await response.json()) as { cause: string | null };
    assert.equal(typeof body.cause, 'string');
  });

  it('returns 502 when the provider fails', async () => {
    mode = 'provider-error';
    const response = await post({ source });
    assert.equal(response.status, 502);
    const body = (await response.json()) as { statusCode: number };
    assert.equal(body.statusCode, 429);
    mode = 'ok';
  });

  it('returns 503 with a hint when the environment is incomplete', async () => {
    mode = 'missing-config';
    const response = await post({ source });
    assert.equal(response.status, 503);
    const body = (await response.json()) as { error: string; hint: string };
    assert.match(body.error, /COMMANDCODE_MODEL/);
    assert.match(body.hint, /\.env/);
    mode = 'ok';
  });

  it('rejects the wrong method with 405', async () => {
    const response = await fetch(`${baseUrl}/api/generate`);
    assert.equal(response.status, 405);
    assert.equal(response.headers.get('allow'), 'POST');
  });
});
