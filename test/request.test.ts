// test/request.test.ts — request, protocol, and mock-client integration (F2.5).

import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { describe, it } from 'node:test';

import { MockGenerationClient, MOCK_OUTPUT } from '../src/client/mock.ts';
import { buildRepresentationBundle } from '../src/representations.ts';
import { buildGenerationRequest } from '../src/request.ts';
import {
  DOCUMENTATION_PROMPT,
  loadProtocolConfig,
  validateProtocolConfig,
} from '../src/protocol.ts';

describe('F2.5 generation request and mock client', () => {
  it('loads the versioned protocol with real API disabled and no model selected', () => {
    const protocol = loadProtocolConfig();
    assert.equal(protocol.prompt, DOCUMENTATION_PROMPT);
    assert.equal(protocol.generation.clientMode, 'mock');
    assert.equal(protocol.generation.allowRealApi, false);
    assert.equal(protocol.generation.provider, null);
    assert.equal(protocol.generation.model, null);
    assert.equal(protocol.generation.modelVersion, null);
    assert.deepEqual(protocol.retry, {
      maxAttempts: 3,
      initialDelayMs: 1000,
      backoffMultiplier: 2,
    });
  });

  it('builds one request containing the exact prompt, parameters, and one representation', () => {
    const bundle = buildRepresentationBundle('function f(value) { return value; }', {
      sourceId: 'request-fixture',
    });
    const request = buildGenerationRequest(bundle.artifacts.p);

    assert.equal(request.functionId, 'request-fixture');
    assert.equal(request.representation, 'p');
    assert.equal(request.prompt, DOCUMENTATION_PROMPT);
    assert.equal(request.input, bundle.artifacts.p.content);
    assert.deepEqual(request.parameters, {
      temperature: 0,
      topP: 'provider-default',
      maxTokens: 128,
      seed: null,
    });
    assert.equal('representations' in request, false);
  });

  it('returns a fixed simulated result with no token or model claims', async () => {
    const artifact = buildRepresentationBundle('function f() {}').artifacts.b0;
    const response = await new MockGenerationClient().generate(buildGenerationRequest(artifact));

    assert.equal(response.output, MOCK_OUTPUT);
    assert.equal(response.metadata.client, 'mock');
    assert.equal(response.metadata.simulated, true);
    assert.equal(response.metadata.model, null);
    assert.equal(response.metadata.inputTokens, null);
    assert.equal(response.metadata.outputTokens, null);
  });

  it('rejects unsafe protocol settings and secret fields', () => {
    const protocol = loadProtocolConfig();
    assert.throws(
      () =>
        validateProtocolConfig({
          ...protocol,
          generation: { ...protocol.generation, allowRealApi: true },
        }),
      /safe F2\.5 draft/,
    );
    assert.throws(
      () => validateProtocolConfig({ ...protocol, apiKey: 'must-not-be-stored' }),
      /secret fields/,
    );
  });

  it('keeps protocol.json free of credentials', () => {
    const protocolText = readFileSync(new URL('../protocol.json', import.meta.url), 'utf8');
    assert.doesNotMatch(protocolText, /api[_-]?key|authorization|password|secret/i);
  });
});
