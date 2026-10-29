// src/generation/provider-client.ts — HTTP adapter for an OpenAI-compatible provider.

import { GenerationClientError, type GenerationClient, type GenerationResponse } from './client.ts';
import type { ProviderConfig } from './provider-config.ts';
import type { GenerationRequest } from './request.ts';

/** Name recorded in response metadata for this adapter. */
export const PROVIDER_CLIENT_NAME = 'provider';

/** Chat Completions payload fields this adapter reads back. */
interface ChatCompletionPayload {
  choices?: Array<{ message?: { content?: unknown }; finish_reason?: unknown }>;
  usage?: { prompt_tokens?: unknown; completion_tokens?: unknown };
}

/**
 * Joins the shared instruction and the representation into one user turn.
 *
 * The two parts are kept apart in the request so the cache key can hash the
 * representation separately; the provider sees a single message.
 *
 * @param request - Single-representation request.
 * @returns Message content sent to the provider.
 */
export function composeUserMessage(request: GenerationRequest): string {
  return `${request.prompt}\n\n${request.input}`;
}

/**
 * Builds the Chat Completions body for one request.
 *
 * @param request - Single-representation request.
 * @param model - Resolved model identifier.
 * @returns JSON-serialisable request body.
 */
export function buildChatCompletionBody(
  request: GenerationRequest,
  model: string,
): Record<string, unknown> {
  const body: Record<string, unknown> = {
    model,
    messages: [{ role: 'user', content: composeUserMessage(request) }],
    temperature: request.parameters.temperature,
    max_tokens: request.parameters.maxTokens,
    stream: false,
  };

  if (request.parameters.topP !== 'provider-default') {
    body.top_p = Number(request.parameters.topP);
  }
  if (request.parameters.seed !== null) {
    body.seed = request.parameters.seed;
  }
  if (request.parameters.reasoningEffort !== null) {
    body.reasoning_effort = request.parameters.reasoningEffort;
  }

  return body;
}

/**
 * Reads the assistant text from a parsed payload.
 *
 * @param payload - Parsed JSON response.
 * @returns Trimmed comment text.
 * @throws {GenerationClientError} If no usable text is present.
 */
function readOutput(payload: ChatCompletionPayload): string {
  const choice = payload.choices?.[0];
  const content = choice?.message?.content;
  if (typeof content !== 'string' || content.trim().length === 0) {
    if (choice?.finish_reason === 'length') {
      throw new GenerationClientError(
        'Provider exhausted max_tokens before writing the comment (finish_reason=length)',
      );
    }
    throw new GenerationClientError('Provider response contains no message content');
  }
  return content.trim();
}

/**
 * Narrows a numeric token count, returning `null` when the provider omits it.
 *
 * @param value - Raw usage field.
 * @returns Integer count or `null`.
 */
function readTokenCount(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

/**
 * Sends one request to an OpenAI-compatible endpoint.
 *
 * Retries are deliberately not implemented here: `GenerationService` owns the
 * three-attempt budget, so a failure must surface once and be recorded once.
 */
export class ProviderGenerationClient implements GenerationClient {
  private readonly config: ProviderConfig;

  /**
   * @param config - Validated endpoint, credentials and timeout.
   */
  constructor(config: ProviderConfig) {
    this.config = config;
  }

  /**
   * Calls the provider and normalises its response.
   *
   * @param request - Single-representation request.
   * @returns Generated comment and call metadata.
   * @throws {GenerationClientError} On refusal, timeout, HTTP error or bad payload.
   */
  async generate(request: GenerationRequest): Promise<GenerationResponse> {
    if (request.clientMode !== 'provider') {
      throw new GenerationClientError('Refusing a real provider call for a mock-mode request');
    }
    if (request.input.trim().length === 0) {
      throw new GenerationClientError('Refusing to send an empty representation');
    }

    const model = request.model ?? this.config.model;
    if (model === null || model.length === 0) {
      throw new GenerationClientError('No model selected for the provider request');
    }

    const started = performance.now();
    let response: Response;
    try {
      response = await fetch(`${this.config.baseUrl}/chat/completions`, {
        method: 'POST',
        headers: {
          'content-type': 'application/json',
          authorization: `Bearer ${this.config.apiKey}`,
        },
        body: JSON.stringify(buildChatCompletionBody(request, model)),
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

    const raw = await response.text();
    const latencyMs = Math.round(performance.now() - started);

    if (!response.ok) {
      throw new GenerationClientError(`Provider responded with HTTP ${response.status}`, {
        statusCode: response.status,
        responseBody: raw.slice(0, 2000),
      });
    }

    let payload: ChatCompletionPayload;
    try {
      payload = JSON.parse(raw) as ChatCompletionPayload;
    } catch {
      throw new GenerationClientError('Provider response is not valid JSON', {
        statusCode: response.status,
        responseBody: raw.slice(0, 2000),
      });
    }

    return {
      output: readOutput(payload),
      metadata: {
        client: PROVIDER_CLIENT_NAME,
        model,
        inputTokens: readTokenCount(payload.usage?.prompt_tokens),
        outputTokens: readTokenCount(payload.usage?.completion_tokens),
        latencyMs,
        simulated: false,
      },
    };
  }
}
