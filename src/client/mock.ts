// src/client/mock.ts — deterministic local-only generation client (F2.5).

import type { GenerationClient, GenerationResponse } from './client.ts';
import type { GenerationRequest } from '../request.ts';

/** A fixed marker, not a generated documentation comment. */
export const MOCK_OUTPUT = '[MOCK] No language-model generation was performed.';

/**
 * Local deterministic provider used to exercise request integration without
 * network access, credentials, or API cost.
 */
export class MockGenerationClient implements GenerationClient {
  /**
   * Returns a fixed mock result and records that no model call took place.
   *
   * @param _request - Accepted to satisfy the shared client contract; contents
   *   are not interpreted by this mock.
   * @returns A deterministic, explicitly simulated response.
   */
  async generate(_request: GenerationRequest): Promise<GenerationResponse> {
    void _request;
    return {
      output: MOCK_OUTPUT,
      metadata: {
        client: 'mock',
        model: null,
        inputTokens: null,
        outputTokens: null,
        latencyMs: 0,
        simulated: true,
      },
    };
  }
}
