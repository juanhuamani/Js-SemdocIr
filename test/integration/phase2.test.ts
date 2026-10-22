// test/integration/phase2.test.ts — end-to-end local Phase 2 smoke test.

import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';

import { type GenerationClient, type GenerationResponse } from '../../src/client/client.ts';
import { FileGenerationCache } from '../../src/client/cache.ts';
import { GenerationService } from '../../src/client/generation-service.ts';
import { MockGenerationClient, MOCK_OUTPUT } from '../../src/client/mock.ts';
import { createRepresentationJobs, runRepresentationJob } from '../../src/orchestrator.ts';
import { buildRepresentationBundle, REPRESENTATION_IDS } from '../../src/representations.ts';

class CountingMockClient implements GenerationClient {
  readonly requests: Parameters<GenerationClient['generate']>[0][] = [];
  private readonly mock = new MockGenerationClient();

  async generate(
    request: Parameters<GenerationClient['generate']>[0],
  ): Promise<GenerationResponse> {
    this.requests.push(request);
    return this.mock.generate(request);
  }
}

describe('Phase 2 local end-to-end integration', () => {
  it('builds B0/B1/B2/P and runs one mock job per representation with cache reuse', async () => {
    const directory = await mkdtemp(join(tmpdir(), 'jssemdocir-phase2-integration-'));
    try {
      const source = [
        'function normalizeName(value) {',
        '  if (typeof value !== "string") throw new TypeError("value must be a string");',
        '  return value.trim().toLowerCase();',
        '}',
      ].join('\n');
      const bundle = buildRepresentationBundle(source, {
        sourceId: 'integration:normalize-name',
      });
      const jobs = createRepresentationJobs(bundle);
      const client = new CountingMockClient();
      const cache = new FileGenerationCache(directory);
      const service = new GenerationService(client, {
        cache,
        sleep: async () => undefined,
      });

      assert.deepEqual(
        jobs.map(({ representation }) => representation),
        REPRESENTATION_IDS,
      );
      assert.equal(bundle.artifacts.b0.content, source);

      const firstPass = [];
      for (const job of jobs) firstPass.push(await runRepresentationJob(job, service));

      assert.equal(client.requests.length, REPRESENTATION_IDS.length);
      assert.deepEqual(
        client.requests.map(({ representation }) => representation),
        REPRESENTATION_IDS,
      );
      for (const [index, result] of firstPass.entries()) {
        assert.equal(result.status, 'succeeded');
        assert.equal(result.cacheHit, false);
        assert.equal(result.functionId, bundle.functionId);
        assert.equal(result.sourceHash, bundle.sourceHash);
        assert.equal(result.representation, REPRESENTATION_IDS[index]);
        assert.equal(
          result.inputArtifactPath,
          bundle.artifacts[result.representation].relativePath,
        );
        assert.equal(result.response.output, MOCK_OUTPUT);
        assert.equal(result.response.metadata.simulated, true);

        const record = await cache.get(result.cacheKey);
        assert.equal(record?.status, 'succeeded');
        assert.equal(record?.request.representation, result.representation);
        assert.equal(record?.request.input, bundle.artifacts[result.representation].content);
      }

      const resumedPass = [];
      for (const job of jobs) resumedPass.push(await runRepresentationJob(job, service));
      assert.ok(resumedPass.every((result) => result.status === 'succeeded' && result.cacheHit));
      assert.equal(client.requests.length, REPRESENTATION_IDS.length);
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  });
});
