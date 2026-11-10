import assert from 'node:assert/strict';
import { createServer, type Server } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, describe, it } from 'node:test';

import { GenerationClientError } from '../src/generation/client.ts';
import { ResponsesGenerationClient } from '../src/generation/responses-client.ts';
import type { GenerationRequest } from '../src/generation/request.ts';

interface Captured {
  body: Record<string, unknown> | null;
}

function request(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    protocolVersion: 'test',
    clientMode: 'provider',
    provider: 'openai',
    model: 'gpt-test',
    modelVersion: 'v1',
    functionId: 'js-0001',
    representation: 'p',
    prompt: 'Write one sentence.',
    input: 'FUNCTION suma',
    parameters: {
      temperature: 0,
      topP: 'provider-default',
      maxTokens: 128,
      seed: null,
      reasoningEffort: 'off',
    },
    ...overrides,
  };
}

const okBody = {
  status: 'completed',
  output: [
    {
      type: 'message',
      content: [{ type: 'output_text', text: 'Adds two numbers and returns the sum.' }],
    },
  ],
  usage: {
    input_tokens: 96,
    output_tokens: 34,
    output_tokens_details: { reasoning_tokens: 0 },
  },
};

describe('ResponsesGenerationClient', () => {
  let server: Server;
  let client: ResponsesGenerationClient;
  const captured: Captured = { body: null };
  let reply: { status: number; body: unknown } = { status: 200, body: okBody };

  before(async () => {
    server = createServer((incoming, outgoing) => {
      const chunks: Buffer[] = [];
      incoming.on('data', (chunk: Buffer) => chunks.push(chunk));
      incoming.on('end', () => {
        captured.body = JSON.parse(Buffer.concat(chunks).toString('utf8')) as Record<
          string,
          unknown
        >;
        outgoing.writeHead(reply.status, { 'content-type': 'application/json' });
        outgoing.end(JSON.stringify(reply.body));
      });
    });
    await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
    const { port } = server.address() as AddressInfo;
    client = new ResponsesGenerationClient({
      baseUrl: `http://127.0.0.1:${port}/v1`,
      apiKey: 'test-key',
      model: 'gpt-test',
      timeoutMs: 5000,
    });
  });

  after(async () => {
    await new Promise<void>((resolve) => server.close(() => resolve()));
  });

  it('posts to /responses with instructions, input and reasoning none', async () => {
    reply = { status: 200, body: okBody };
    const response = await client.generate(request());

    assert.equal(response.output, 'Adds two numbers and returns the sum.');
    assert.equal(response.metadata.inputTokens, 96);
    assert.equal(response.metadata.outputTokens, 34);
    assert.equal(response.metadata.simulated, false);

    const body = captured.body;
    assert.ok(body);
    assert.equal(body.instructions, 'Write one sentence.');
    assert.equal(body.input, 'FUNCTION suma');
    assert.equal(body.max_output_tokens, 128);
    assert.equal(body.temperature, 0);
    assert.deepEqual(body.reasoning, { effort: 'none' });
    assert.equal(body.store, false);
    assert.equal('seed' in body, false);
    assert.equal('messages' in body, false);
  });

  it('rejects a truncated response', async () => {
    reply = {
      status: 200,
      body: {
        status: 'incomplete',
        incomplete_details: { reason: 'max_output_tokens' },
        output: [],
      },
    };
    await assert.rejects(() => client.generate(request()), /exhausted max_output_tokens/);
  });

  it('rejects a response without output text', async () => {
    reply = { status: 200, body: { status: 'completed', output: [] } };
    await assert.rejects(() => client.generate(request()), /no output text/);
  });

  it('surfaces the HTTP status and body', async () => {
    reply = { status: 500, body: { error: 'boom' } };
    await assert.rejects(
      () => client.generate(request()),
      (error: unknown) =>
        error instanceof GenerationClientError &&
        error.statusCode === 500 &&
        error.message.includes('HTTP 500'),
    );
  });

  it('refuses mock-mode requests', async () => {
    await assert.rejects(
      () => client.generate(request({ clientMode: 'mock' })),
      /rejects requests in mock mode/,
    );
  });

  it('refuses an empty representation', async () => {
    await assert.rejects(() => client.generate(request({ input: '  ' })), /empty representation/);
  });
});
