// src/client/client.ts — provider-independent generation client contract.

import type { GenerationRequest } from './request.ts';

/** Common metadata returned by a generation client. */
export interface GenerationResponse {
  output: string;
  metadata: {
    client: string;
    model: string | null;
    inputTokens: number | null;
    outputTokens: number | null;
    latencyMs: number;
    simulated: boolean;
  };
}

/** Provider failure with optional HTTP context available for the error log. */
export class GenerationClientError extends Error {
  readonly statusCode: number | null;
  readonly responseBody: string | null;

  /**
   * @param message - Short provider/client error summary.
   * @param context - Optional HTTP status and response body.
   */
  constructor(
    message: string,
    context: { statusCode?: number | null; responseBody?: string | null } = {},
  ) {
    super(message);
    this.name = 'GenerationClientError';
    this.statusCode = context.statusCode ?? null;
    this.responseBody = context.responseBody ?? null;
  }
}

/** Adapter contract for the future provider client. */
export interface GenerationClient {
  generate(request: GenerationRequest): Promise<GenerationResponse>;
}
