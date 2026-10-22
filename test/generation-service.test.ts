// test/generation-service.test.ts — cache, retry, error, and resume tests (F2.6).

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import {
  GenerationClientError,
  type GenerationClient,
  type GenerationResponse,
} from '../src/client/client.ts';
import { FileGenerationCache, type GenerationCacheRecord } from '../src/client/cache.ts';
import { createGenerationCacheKey, GenerationService } from '../src/client/generation-service.ts';
import { buildRepresentationBundle } from '../src/representations.ts';
import { buildGenerationRequest, type GenerationRequest } from '../src/request.ts';

const fixedDate = new Date('2026-10-20T12:00:00.000Z');

function requestFor(representation: 'b0' | 'b1' | 'b2' | 'p' = 'b0'): GenerationRequest {
  const bundle = buildRepresentationBundle('function f(value) { return value; }', {
    sourceId: 'cache-fixture',
  });
  return buildGenerationRequest(bundle.artifacts[representation]);
}

function response(output = 'Mock documentation result.'): GenerationResponse {
  return {
    output,
    metadata: {
      client: 'test',
      model: 'test-model',
      inputTokens: 10,
      outputTokens: 5,
      latencyMs: 4,
      simulated: true,
    },
  };
}

class SequenceClient implements GenerationClient {
  calls = 0;
  private readonly outcomes: Array<GenerationResponse | Error>;

  constructor(outcomes: Array<GenerationResponse | Error>) {
    this.outcomes = outcomes;
  }

  async generate(): Promise<GenerationResponse> {
    const outcome = this.outcomes[this.calls];
    this.calls += 1;
    if (outcome instanceof Error) throw outcome;
    if (outcome === undefined) throw new Error('No test outcome configured');
    return outcome;
  }
}

describe('generation cache key', () => {
  it('includes function, representation, model identity, protocol, parameters, prompt, and payload', () => {
    const request = requestFor();
    const baseline = createGenerationCacheKey(request);

    assert.notEqual(createGenerationCacheKey(requestFor('b1')), baseline);
    assert.notEqual(createGenerationCacheKey({ ...request, modelVersion: 'model-v1' }), baseline);
    assert.notEqual(
      createGenerationCacheKey({ ...request, prompt: `${request.prompt}!` }),
      baseline,
    );
    assert.notEqual(
      createGenerationCacheKey({ ...request, input: `${request.input}\n` }),
      baseline,
    );
    assert.notEqual(
      createGenerationCacheKey({
        ...request,
        parameters: { ...request.parameters, maxTokens: 64 },
      }),
      baseline,
    );
  });
});

describe('generation service', () => {
  it('persists success and reuses it without repeating the provider call', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jssemdocir-cache-success-'));
    try {
      const cache = new FileGenerationCache(directory);
      const client = new SequenceClient([response()]);
      const service = new GenerationService(client, {
        cache,
        now: () => fixedDate,
        sleep: async () => undefined,
      });
      const request = requestFor();

      const first = await service.run(request);
      const second = await service.run(request);

      assert.equal(first.status, 'succeeded');
      assert.equal(first.cacheHit, false);
      assert.equal(second.status, 'succeeded');
      assert.equal(second.cacheHit, true);
      assert.equal(client.calls, 1);
      assert.equal(second.response.output, 'Mock documentation result.');
      assert.equal((await cache.get(first.cacheKey))?.status, 'succeeded');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('uses three total attempts with exponential backoff and persists terminal errors', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jssemdocir-cache-failure-'));
    try {
      const cache = new FileGenerationCache(directory);
      const client = new SequenceClient([
        new Error('provider unavailable'),
        new Error('temporary provider failure'),
        new GenerationClientError('HTTP: Bearer abc123 api_key=hidden-value', {
          statusCode: 503,
          responseBody: '{"error":"quota exceeded","api_key":"hidden-value"}',
        }),
      ]);
      const delays: number[] = [];
      const service = new GenerationService(client, {
        cache,
        now: () => fixedDate,
        sleep: async (milliseconds) => {
          delays.push(milliseconds);
        },
      });
      const request = requestFor();

      const result = await service.run(request);
      const resumed = await new GenerationService(client, { cache }).run(request);
      const record = await cache.get(result.cacheKey);

      assert.equal(result.status, 'failed');
      assert.equal(result.attempts, 3);
      assert.deepEqual(delays, [1000, 2000]);
      assert.equal(client.calls, 3);
      assert.equal(resumed.status, 'failed');
      assert.equal(resumed.cacheHit, true);
      assert.equal(client.calls, 3);
      assert.equal(record?.status, 'failed');
      assert.deepEqual(
        record?.attempts.map(({ status }) => status),
        ['failed', 'failed', 'failed'],
      );
      assert.match(result.error.message, /Bearer \[REDACTED\]/);
      assert.match(result.error.message, /api_key=\[REDACTED\]/);
      assert.equal(result.error.statusCode, 503);
      assert.match(result.error.responseBody ?? '', /"api_key":"\[REDACTED\]"/);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('resumes a pending request inside its remaining attempt budget', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jssemdocir-cache-resume-'));
    try {
      const cache = new FileGenerationCache(directory);
      const request = requestFor();
      const cacheKey = createGenerationCacheKey(request);
      const previousError = { name: 'Error', message: 'temporary failure' };
      const record: GenerationCacheRecord = {
        schemaVersion: 1,
        cacheKey,
        request,
        status: 'pending',
        attempts: [
          {
            number: 1,
            startedAt: fixedDate.toISOString(),
            finishedAt: fixedDate.toISOString(),
            status: 'failed',
            error: previousError,
          },
        ],
        updatedAt: fixedDate.toISOString(),
      };
      await cache.put(record);

      const client = new SequenceClient([response('Recovered after restart.')]);
      const result = await new GenerationService(client, {
        cache,
        now: () => fixedDate,
        sleep: async () => undefined,
      }).run(request);

      assert.equal(result.status, 'succeeded');
      assert.equal(result.attempts, 2);
      assert.equal(result.response.output, 'Recovered after restart.');
      assert.equal(client.calls, 1);
      assert.deepEqual(
        (await cache.get(cacheKey))?.attempts.map(({ status }) => status),
        ['failed', 'succeeded'],
      );
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('counts a process-interrupted started attempt against the three-attempt limit', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jssemdocir-cache-interrupted-'));
    try {
      const cache = new FileGenerationCache(directory);
      const request = requestFor();
      const cacheKey = createGenerationCacheKey(request);
      const attempts = [1, 2, 3].map((number) => ({
        number,
        startedAt: fixedDate.toISOString(),
        finishedAt: null,
        status: 'started' as const,
      }));
      await cache.put({
        schemaVersion: 1,
        cacheKey,
        request,
        status: 'pending',
        attempts,
        updatedAt: fixedDate.toISOString(),
      });
      const client = new SequenceClient([response()]);

      const result = await new GenerationService(client, {
        cache,
        now: () => fixedDate,
        sleep: async () => undefined,
      }).run(request);

      assert.equal(result.status, 'failed');
      assert.equal(result.attempts, 3);
      assert.equal(result.cacheHit, true);
      assert.equal(client.calls, 0);
      assert.equal((await cache.get(cacheKey))?.status, 'failed');
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('coalesces simultaneous identical calls in one service instance', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jssemdocir-cache-flight-'));
    try {
      const client = new SequenceClient([response()]);
      const service = new GenerationService(client, {
        cache: new FileGenerationCache(directory),
        now: () => fixedDate,
        sleep: async () => undefined,
      });
      const request = requestFor();
      const [first, second] = await Promise.all([service.run(request), service.run(request)]);

      assert.equal(first.status, 'succeeded');
      assert.equal(second.status, 'succeeded');
      assert.equal(client.calls, 1);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
