// test/orchestrator.test.ts — traceable single-representation jobs (F2.7).

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { type GenerationClient, type GenerationResponse } from '../src/client/client.ts';
import { FileGenerationCache } from '../src/client/cache.ts';
import { createGenerationCacheKey, GenerationService } from '../src/client/generation-service.ts';
import { MockGenerationClient } from '../src/client/mock.ts';
import { createRepresentationJobs, runRepresentationJob } from '../src/orchestrator.ts';
import { buildRepresentationBundle, REPRESENTATION_IDS } from '../src/representations.ts';
import { buildGenerationRequest } from '../src/request.ts';

function response(output: string): GenerationResponse {
  return {
    output,
    metadata: {
      client: 'test',
      model: null,
      inputTokens: null,
      outputTokens: null,
      latencyMs: 0,
      simulated: true,
    },
  };
}

class RepresentationAwareClient implements GenerationClient {
  readonly seen: string[] = [];

  async generate(
    request: Parameters<GenerationClient['generate']>[0],
  ): Promise<GenerationResponse> {
    this.seen.push(request.representation);
    if (request.representation === 'b1') throw new Error('simulated B1-only failure');
    return response(`simulated ${request.representation} output`);
  }
}

describe('one-function × one-representation orchestration', () => {
  it('creates four traceable descriptors without starting generation', () => {
    const bundle = buildRepresentationBundle('function identify(value) { return value; }', {
      sourceId: 'orchestrator-fixture',
    });
    const jobs = createRepresentationJobs(bundle);

    assert.deepEqual(
      jobs.map(({ representation }) => representation),
      REPRESENTATION_IDS,
    );
    for (const job of jobs) {
      assert.equal(job.functionId, bundle.functionId);
      assert.equal(job.sourceHash, bundle.sourceHash);
      assert.equal(job.relativePath, bundle.artifacts[job.representation].relativePath);
    }
  });

  it('runs only the requested representation with the mock client', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jssemdocir-orchestrator-one-'));
    try {
      const bundle = buildRepresentationBundle('function identify(value) { return value; }', {
        sourceId: 'orchestrator-mock-fixture',
      });
      const jobs = createRepresentationJobs(bundle);
      const service = new GenerationService(new MockGenerationClient(), {
        cache: new FileGenerationCache(directory),
        sleep: async () => undefined,
      });
      const selectedJob = jobs.find(({ representation }) => representation === 'p');
      assert.ok(selectedJob);

      const result = await runRepresentationJob(selectedJob, service);

      assert.equal(result.status, 'succeeded');
      assert.equal(result.representation, 'p');
      assert.equal(result.functionId, bundle.functionId);
      assert.equal(result.sourceHash, bundle.sourceHash);
      assert.equal(result.inputArtifactPath, bundle.artifacts.p.relativePath);
      assert.equal(result.response.metadata.client, 'mock');
      const unselectedKey = createGenerationCacheKey(buildGenerationRequest(bundle.artifacts.b0));
      assert.equal(await new FileGenerationCache(directory).get(unselectedKey), null);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });

  it('keeps a representation failure scoped to its own independent job', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jssemdocir-orchestrator-independent-'));
    try {
      const bundle = buildRepresentationBundle('function identify(value) { return value; }', {
        sourceId: 'orchestrator-independent-fixture',
      });
      const jobs = createRepresentationJobs(bundle);
      const client = new RepresentationAwareClient();
      const service = new GenerationService(client, {
        cache: new FileGenerationCache(directory),
        sleep: async () => undefined,
      });
      const b1 = jobs.find(({ representation }) => representation === 'b1');
      const b2 = jobs.find(({ representation }) => representation === 'b2');
      assert.ok(b1);
      assert.ok(b2);

      const failed = await runRepresentationJob(b1, service);
      const succeeded = await runRepresentationJob(b2, service);

      assert.equal(failed.status, 'failed');
      assert.equal(failed.representation, 'b1');
      assert.equal(succeeded.status, 'succeeded');
      assert.equal(succeeded.representation, 'b2');
      assert.deepEqual(client.seen, ['b1', 'b1', 'b1', 'b2']);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
