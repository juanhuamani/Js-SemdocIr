// src/generation/responses-client.ts — OpenAI Responses API adapter (Codex models).

import { GenerationClientError, type GenerationClient, type GenerationResponse } from './client.ts';
import type { ProviderConfig } from './provider-config.ts';
import type { GenerationRequest } from './request.ts';

export const RESPONSES_CLIENT_NAME = 'responses';

interface ResponsesContentPart {
  type?: unknown;
  text?: unknown;
}

interface ResponsesOutputItem {
  type?: unknown;
  content?: unknown;
}

interface ResponsesPayload {
  output?: unknown;
  status?: unknown;
  incomplete_details?: { reason?: unknown } | null;
  usage?: {
    input_tokens?: unknown;
    output_tokens?: unknown;
    output_tokens_details?: { reasoning_tokens?: unknown } | null;
  } | null;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

/**
 * Builds the Responses request body.
 *
 * The endpoint rejects `seed`, so the request carries no sampling seed. Codex
 * must be told to stop reasoning explicitly, or it spends the whole output
 * budget thinking and returns an empty comment.
 *
 * @param request - Assembled generation request.
 * @param model - Concrete model identifier.
 * @returns JSON body for `POST /responses`.
 */
export function buildResponsesBody(request: GenerationRequest, model: string): object {
  const body: Record<string, unknown> = {
    model,
    instructions: request.prompt,
    input: request.input,
    max_output_tokens: request.parameters.maxTokens,
    temperature: request.parameters.temperature,
    reasoning: { effort: 'none' },
    store: false,
  };
  if (request.parameters.topP !== 'provider-default') {
    body.top_p = request.parameters.topP;
  }
  return body;
}

function readText(payload: ResponsesPayload): string {
  const output = payload.output;
  if (!Array.isArray(output)) return '';
  const parts: string[] = [];
  for (const item of output as ResponsesOutputItem[]) {
    if (!isRecord(item) || !Array.isArray(item.content)) continue;
    for (const part of item.content as ResponsesContentPart[]) {
      if (isRecord(part) && part.type === 'output_text' && typeof part.text === 'string') {
        parts.push(part.text);
      }
    }
  }
  return parts.join('\n').trim();
}

function readTokenCount(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) ? value : 0;
}

/**
 * Generates documentation through the OpenAI Responses API.
 *
 * Only the transport differs from the Chat Completions adapter: retries and
 * persistence belong to the generation service.
 */
export class ResponsesGenerationClient implements GenerationClient {
  private readonly config: ProviderConfig;

  constructor(config: ProviderConfig) {
    this.config = config;
  }

  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    if (request.clientMode !== 'provider') {
      throw new GenerationClientError('The provider client rejects requests in mock mode.');
    }
    if (request.input.trim().length === 0) {
      throw new GenerationClientError('Cannot generate from an empty representation.');
    }
    const model = (request.model ?? this.config.model ?? '').trim();
    if (model.length === 0) {
      throw new GenerationClientError('No model is set for the provider request.');
    }

    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/responses`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(buildResponsesBody(request, model)),
        signal: AbortSignal.timeout(this.config.timeoutMs),
      });
    } catch (error) {
      if (error instanceof Error && error.name === 'TimeoutError') {
        throw new GenerationClientError(
          `Provider request timed out after ${this.config.timeoutMs} ms`,
        );
      }
      throw new GenerationClientError('Provider request failed before a response was received');
    }

    const latencyMs = Math.round(performance.now() - started);
    const raw = await response.text();
    if (!response.ok) {
      throw new GenerationClientError(`Provider responded with HTTP ${response.status}`, {
        statusCode: response.status,
        responseBody: raw.slice(0, 2000),
      });
    }

    let payload: unknown;
    try {
      payload = JSON.parse(raw);
    } catch {
      throw new GenerationClientError('Provider response is not valid JSON');
    }
    if (!isRecord(payload)) {
      throw new GenerationClientError('Provider response is not a JSON object');
    }

    const typed = payload as ResponsesPayload;
    if (typed.status === 'incomplete' && typed.incomplete_details?.reason === 'max_output_tokens') {
      throw new GenerationClientError(
        'Provider exhausted max_output_tokens before writing the comment (status=incomplete)',
      );
    }

    const output = readText(typed);
    if (output.length === 0) {
      throw new GenerationClientError('Provider response contains no output text');
    }

    return {
      output,
      metadata: {
        client: RESPONSES_CLIENT_NAME,
        model,
        inputTokens: readTokenCount(typed.usage?.input_tokens),
        outputTokens: readTokenCount(typed.usage?.output_tokens),
        latencyMs,
        simulated: false,
      },
    };
  }
}
