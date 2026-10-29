import assert from 'node:assert/strict';
import { once } from 'node:events';
import { createServer, type Server, type ServerResponse } from 'node:http';
import type { AddressInfo } from 'node:net';
import { after, before, beforeEach, describe, it } from 'node:test';

import { GenerationClientError } from '../src/generation/client.ts';
import {
  buildChatCompletionBody,
  composeUserMessage,
  ProviderGenerationClient,
} from '../src/generation/provider-client.ts';
import { loadProviderConfig } from '../src/generation/provider-config.ts';
import { DOCUMENTATION_PROMPT, validateFrozenProtocolConfig } from '../src/generation/protocol.ts';
import type { GenerationRequest } from '../src/generation/request.ts';

/** Builds a provider-mode request with the fields the adapter reads. */
function makeRequest(overrides: Partial<GenerationRequest> = {}): GenerationRequest {
  return {
    protocolVersion: '1.0',
    clientMode: 'provider',
    provider: 'commandcode',
    model: 'deepseek/deepseek-v4.1-flash',
    modelVersion: '2026-10-01',
    functionId: 'f1',
    representation: 'p',
    prompt: DOCUMENTATION_PROMPT,
    input: 'FN f INPUT a CALL g a RET r',
    parameters: {
      temperature: 0,
      topP: 'provider-default',
      maxTokens: 128,
      seed: null,
      reasoningEffort: null,
    },
    ...overrides,
  };
}

const SUCCESS_BODY = {
  choices: [{ message: { content: '  Returns the parsed value.  ' }, finish_reason: 'stop' }],
  usage: { prompt_tokens: 512, completion_tokens: 42 },
};

describe('provider generation client', () => {
  let server: Server;
  let baseUrl: string;
  let respond: (response: ServerResponse) => void;
  let lastBody: Record<string, unknown>;
  let lastAuthorization: string | undefined;
  let calls = 0;

  before(async () => {
    server = createServer((request, response) => {
      calls += 1;
      lastAuthorization = request.headers.authorization;
      let raw = '';
      request.on('data', (chunk) => {
        raw += String(chunk);
      });
      request.on('end', () => {
        lastBody = JSON.parse(raw) as Record<string, unknown>;
        respond(response);
      });
    });
    server.listen(0, '127.0.0.1');
    await once(server, 'listening');
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}/v1`;
  });

  after(() => {
    server.closeAllConnections();
    server.close();
  });

  beforeEach(() => {
    calls = 0;
    lastAuthorization = undefined;
    respond = (response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify(SUCCESS_BODY));
    };
  });

  function client(overrides: { model?: string | null; timeoutMs?: number } = {}) {
    return new ProviderGenerationClient({
      baseUrl,
      apiKey: 'test-key',
      model: overrides.model ?? null,
      timeoutMs: overrides.timeoutMs ?? 5000,
    });
  }

  it('sends one user turn with the frozen decoding parameters', async () => {
    await client().generate(makeRequest());

    assert.equal(calls, 1);
    assert.equal(lastAuthorization, 'Bearer test-key');
    assert.equal(lastBody.model, 'deepseek/deepseek-v4.1-flash');
    assert.equal(lastBody.temperature, 0);
    assert.equal(lastBody.max_tokens, 128);
    assert.equal(lastBody.stream, false);
    assert.equal('top_p' in lastBody, false);
    assert.equal('seed' in lastBody, false);
    assert.equal('reasoning_effort' in lastBody, false);

    const messages = lastBody.messages as Array<{ role: string; content: string }>;
    assert.equal(messages.length, 1);
    assert.equal(messages[0].role, 'user');
    assert.equal(messages[0].content, `${DOCUMENTATION_PROMPT}\n\nFN f INPUT a CALL g a RET r`);
  });

  it('normalises the comment text and token metadata', async () => {
    const result = await client().generate(makeRequest());

    assert.equal(result.output, 'Returns the parsed value.');
    assert.equal(result.metadata.client, 'provider');
    assert.equal(result.metadata.model, 'deepseek/deepseek-v4.1-flash');
    assert.equal(result.metadata.inputTokens, 512);
    assert.equal(result.metadata.outputTokens, 42);
    assert.equal(result.metadata.simulated, false);
    assert.ok(result.metadata.latencyMs >= 0);
  });

  it('falls back to the configured model when the request names none', async () => {
    const result = await client({ model: 'fallback-model' }).generate(makeRequest({ model: null }));

    assert.equal(lastBody.model, 'fallback-model');
    assert.equal(result.metadata.model, 'fallback-model');
  });

  it('refuses a mock-mode request without calling the provider', async () => {
    await assert.rejects(
      client().generate(makeRequest({ clientMode: 'mock' })),
      /Refusing a real provider call/,
    );
    assert.equal(calls, 0);
  });

  it('refuses an empty representation', async () => {
    await assert.rejects(client().generate(makeRequest({ input: '   ' })), /empty representation/);
    assert.equal(calls, 0);
  });

  it('surfaces the HTTP status and body on a provider error', async () => {
    respond = (response) => {
      response.writeHead(429, { 'content-type': 'application/json' });
      response.end('{"error":"rate limited"}');
    };

    await assert.rejects(client().generate(makeRequest()), (error: unknown) => {
      assert.ok(error instanceof GenerationClientError);
      assert.equal(error.statusCode, 429);
      assert.equal(error.responseBody, '{"error":"rate limited"}');
      return true;
    });
  });

  it('rejects a response that is not JSON', async () => {
    respond = (response) => {
      response.writeHead(200, { 'content-type': 'text/plain' });
      response.end('<html>oops</html>');
    };

    await assert.rejects(client().generate(makeRequest()), /not valid JSON/);
  });

  it('rejects a response without message content', async () => {
    respond = (response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(JSON.stringify({ choices: [] }));
    };

    await assert.rejects(client().generate(makeRequest()), /no message content/);
  });

  it('reports token exhaustion explicitly', async () => {
    respond = (response) => {
      response.writeHead(200, { 'content-type': 'application/json' });
      response.end(
        JSON.stringify({ choices: [{ message: { content: '' }, finish_reason: 'length' }] }),
      );
    };

    await assert.rejects(client().generate(makeRequest()), /finish_reason=length/);
  });

  it('reports a timeout as a provider error', async () => {
    respond = () => {
      // Deliberately never answers so the client-side timeout fires.
    };

    await assert.rejects(
      client({ timeoutMs: 30 }).generate(makeRequest()),
      /timed out after 30 ms/,
    );
  });
});

describe('chat completion body', () => {
  it('adds top_p, seed and reasoning_effort only when they are set', () => {
    const body = buildChatCompletionBody(
      makeRequest({
        parameters: {
          temperature: 0,
          topP: '0.9',
          maxTokens: 128,
          seed: 7,
          reasoningEffort: 'off',
        },
      }),
      'm',
    );

    assert.equal(body.top_p, 0.9);
    assert.equal(body.seed, 7);
    assert.equal(body.reasoning_effort, 'off');
  });

  it('joins prompt and representation with a blank line', () => {
    assert.equal(composeUserMessage(makeRequest({ prompt: 'p', input: 'i' })), 'p\n\ni');
  });
});

describe('provider configuration', () => {
  it('rejects a missing key without echoing any value', () => {
    assert.throws(
      () => loadProviderConfig({ COMMANDCODE_BASE_URL: 'https://example.test/v1' }),
      (error: unknown) => {
        assert.ok(error instanceof TypeError);
        assert.match(error.message, /COMMANDCODE_API_KEY is not set/);
        return true;
      },
    );
  });

  it('trims a trailing slash and keeps the documented default timeout', () => {
    const config = loadProviderConfig({
      COMMANDCODE_API_KEY: 'k',
      COMMANDCODE_BASE_URL: 'https://example.test/v1///',
    });

    assert.equal(config.baseUrl, 'https://example.test/v1');
    assert.equal(config.timeoutMs, 60_000);
    assert.equal(config.model, null);
  });

  it('rejects a non-HTTP endpoint', () => {
    assert.throws(
      () =>
        loadProviderConfig({
          COMMANDCODE_API_KEY: 'k',
          COMMANDCODE_BASE_URL: 'ftp://example.test',
        }),
      /absolute http\(s\) URL/,
    );
  });
});

describe('frozen protocol validation', () => {
  const frozen = {
    protocolVersion: '1.0',
    status: 'frozen',
    prompt: DOCUMENTATION_PROMPT,
    generation: {
      clientMode: 'provider',
      allowRealApi: true,
      provider: 'commandcode',
      model: 'deepseek/deepseek-v4.1-flash',
      modelVersion: '2026-10-01',
      temperature: 0,
      topP: 'provider-default',
      maxTokens: 128,
      seed: null,
      reasoningEffort: 'off',
    },
    retry: { maxAttempts: 3, initialDelayMs: 1000, backoffMultiplier: 2 },
  };

  it('accepts a frozen run', () => {
    const config = validateFrozenProtocolConfig(frozen);

    assert.equal(config.generation.model, 'deepseek/deepseek-v4.1-flash');
  });

  it('rejects the safe draft as a frozen run', () => {
    assert.throws(
      () =>
        validateFrozenProtocolConfig({
          ...frozen,
          status: 'pending-advisor-and-model-approval',
          generation: {
            ...frozen.generation,
            clientMode: 'mock',
            allowRealApi: false,
            provider: null,
            model: null,
            modelVersion: null,
          },
        }),
      /does not match a frozen run/,
    );
  });

  it('rejects a frozen run without a model version', () => {
    assert.throws(
      () =>
        validateFrozenProtocolConfig({
          ...frozen,
          generation: { ...frozen.generation, modelVersion: '' },
        }),
      /does not match a frozen run/,
    );
  });

  it('rejects credentials smuggled into the protocol', () => {
    assert.throws(
      () =>
        validateFrozenProtocolConfig({
          ...frozen,
          generation: { ...frozen.generation, apiKey: 'leak' },
        }),
      /must not contain secret fields/,
    );
  });
});
