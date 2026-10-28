// src/client/generation-service.ts — cache, bounded retry, and resume (F2.6).

import { createHash } from 'node:crypto';

import { GenerationClientError, type GenerationClient, type GenerationResponse } from './client.ts';
import {
  type GenerationAttempt,
  type GenerationCache,
  type GenerationCacheRecord,
  type PersistedGenerationError,
} from './cache.ts';
import { FileGenerationCache } from './cache.ts';
import { loadProtocolConfig } from './protocol.ts';
import type { GenerationRequest } from './request.ts';

/** Result of a successful generation call or cache hit. */
export interface GenerationSucceeded {
  status: 'succeeded';
  cacheKey: string;
  cacheHit: boolean;
  attempts: number;
  response: GenerationResponse;
}

/** Result of a persisted terminal failure. */
export interface GenerationFailed {
  status: 'failed';
  cacheKey: string;
  cacheHit: boolean;
  attempts: number;
  error: PersistedGenerationError;
}

/** Outcome from one idempotent request run. */
export type GenerationResult = GenerationSucceeded | GenerationFailed;

/** Injectable timing hooks make retry behavior testable without waiting. */
export interface GenerationServiceOptions {
  cache?: GenerationCache;
  now?: () => Date;
  sleep?: (milliseconds: number) => Promise<void>;
}

const defaultProtocol = loadProtocolConfig();

/**
 * Builds a stable cache key from request identity and all generation inputs.
 * The input is represented by its SHA-256 hash to avoid embedding code in the
 * key while still invalidating cache entries when the representation changes.
 *
 * @param request - Fully assembled generation request.
 * @returns Lowercase SHA-256 cache key.
 */
export function createGenerationCacheKey(request: GenerationRequest): string {
  const keyMaterial = {
    functionId: request.functionId,
    representation: request.representation,
    clientMode: request.clientMode,
    provider: request.provider,
    model: request.model,
    modelVersion: request.modelVersion,
    protocolVersion: request.protocolVersion,
    prompt: request.prompt,
    parameters: request.parameters,
    inputHash: createHash('sha256').update(request.input, 'utf8').digest('hex'),
  };
  return createHash('sha256').update(JSON.stringify(keyMaterial), 'utf8').digest('hex');
}

/**
 * Provides idempotent generation with persistent success/error records and a
 * maximum of three total attempts using exponential backoff.
 */
export class GenerationService {
  private readonly client: GenerationClient;
  private readonly cache: GenerationCache;
  private readonly now: () => Date;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly inFlight = new Map<string, Promise<GenerationResult>>();

  /**
   * @param client - Provider adapter. F2.5 supplies only the mock client.
   * @param options - Optional cache and timing overrides for tests.
   */
  constructor(client: GenerationClient, options: GenerationServiceOptions = {}) {
    this.client = client;
    this.cache = options.cache ?? new FileGenerationCache();
    this.now = options.now ?? (() => new Date());
    this.sleep = options.sleep ?? delay;
  }

  /**
   * Gets or generates one function/representation result.
   *
   * Successful and terminally failed requests are not repeated automatically.
   * A pending record resumes within its original three-attempt budget; a
   * process-interrupted attempt is counted as consumed.
   *
   * @param request - Single-representation request.
   * @returns Success or a persisted terminal failure.
   */
  run(request: GenerationRequest): Promise<GenerationResult> {
    const cacheKey = createGenerationCacheKey(request);
    const running = this.inFlight.get(cacheKey);
    if (running !== undefined) return running;

    const operation = this.runSingle(cacheKey, request);
    this.inFlight.set(cacheKey, operation);
    void operation.then(
      () => this.inFlight.delete(cacheKey),
      () => this.inFlight.delete(cacheKey),
    );
    return operation;
  }

  private async runSingle(cacheKey: string, request: GenerationRequest): Promise<GenerationResult> {
    let record = await this.cache.get(cacheKey);
    if (record !== null) {
      if (createGenerationCacheKey(record.request) !== cacheKey) {
        throw new Error(`Cached request does not match its cache key ${cacheKey}`);
      }
      if (record.status === 'succeeded') {
        return {
          status: 'succeeded',
          cacheKey,
          cacheHit: true,
          attempts: record.attempts.length,
          response: record.response,
        };
      }
      if (record.status === 'failed') {
        return {
          status: 'failed',
          cacheKey,
          cacheHit: true,
          attempts: record.attempts.length,
          error: record.error,
        };
      }
      record = await this.reconcileInterruptedAttempt(record);
      if (record.status === 'failed') {
        return {
          status: 'failed',
          cacheKey,
          cacheHit: true,
          attempts: record.attempts.length,
          error: record.error,
        };
      }
    } else {
      record = {
        schemaVersion: 1,
        cacheKey,
        request,
        status: 'pending',
        attempts: [],
        updatedAt: this.now().toISOString(),
      };
      await this.cache.put(record);
    }

    if (record === null || record.status !== 'pending') {
      throw new Error(`Generation cache did not resolve to a pending record for ${cacheKey}`);
    }
    let pendingRecord = record;

    const { maxAttempts, initialDelayMs, backoffMultiplier } = defaultProtocol.retry;
    while (pendingRecord.attempts.length < maxAttempts) {
      const attempt: GenerationAttempt = {
        number: pendingRecord.attempts.length + 1,
        startedAt: this.now().toISOString(),
        finishedAt: null,
        status: 'started',
      };
      pendingRecord = {
        ...pendingRecord,
        status: 'pending',
        attempts: [...pendingRecord.attempts, attempt],
      };
      await this.cache.put(pendingRecord);

      let response: GenerationResponse;
      try {
        response = await this.client.generate(request);
        if (typeof response.output !== 'string' || response.output.trim().length === 0) {
          throw new TypeError('Generation client returned an empty output');
        }
      } catch (error) {
        const persistedError = toPersistedError(error);
        attempt.status = 'failed';
        attempt.finishedAt = this.now().toISOString();
        attempt.error = persistedError;
        const attempts = [...pendingRecord.attempts.slice(0, -1), attempt];
        const exhausted = attempts.length >= maxAttempts;
        if (exhausted) {
          const failed: GenerationCacheRecord = {
            schemaVersion: 1,
            cacheKey,
            request,
            status: 'failed',
            attempts,
            error: persistedError,
            updatedAt: this.now().toISOString(),
          };
          await this.cache.put(failed);
          return {
            status: 'failed',
            cacheKey,
            cacheHit: false,
            attempts: attempts.length,
            error: persistedError,
          };
        }
        pendingRecord = {
          schemaVersion: 1,
          cacheKey,
          request,
          status: 'pending',
          attempts,
          updatedAt: this.now().toISOString(),
        };
        await this.cache.put(pendingRecord);
        await this.sleep(initialDelayMs * backoffMultiplier ** (attempt.number - 1));
        continue;
      }

      attempt.status = 'succeeded';
      attempt.finishedAt = this.now().toISOString();
      record = {
        schemaVersion: 1,
        cacheKey,
        request,
        status: 'succeeded',
        attempts: [...pendingRecord.attempts.slice(0, -1), attempt],
        response,
        updatedAt: this.now().toISOString(),
      };
      await this.cache.put(record);
      return {
        status: 'succeeded',
        cacheKey,
        cacheHit: false,
        attempts: record.attempts.length,
        response,
      };
    }

    // Pending records with an exhausted budget can only arise from an
    // interruption after the final attempt started but before it completed.
    const lastError = pendingRecord.attempts.at(-1)?.error ?? {
      name: 'InterruptedAttemptError',
      message: 'The final attempt was interrupted before completion.',
    };
    const failed: GenerationCacheRecord = {
      schemaVersion: 1,
      cacheKey,
      request,
      status: 'failed',
      attempts: pendingRecord.attempts,
      error: lastError,
      updatedAt: this.now().toISOString(),
    };
    await this.cache.put(failed);
    return {
      status: 'failed',
      cacheKey,
      cacheHit: false,
      attempts: failed.attempts.length,
      error: lastError,
    };
  }

  private async reconcileInterruptedAttempt(
    record: Extract<GenerationCacheRecord, { status: 'pending' }>,
  ): Promise<GenerationCacheRecord> {
    const lastAttempt = record.attempts.at(-1);
    if (lastAttempt?.status !== 'started') return record;

    const interrupted: GenerationAttempt = {
      ...lastAttempt,
      status: 'interrupted',
      finishedAt: this.now().toISOString(),
      error: {
        name: 'InterruptedAttemptError',
        message:
          'The process ended before this attempt completed; it counts toward the attempt limit.',
      },
    };
    const attempts = [...record.attempts.slice(0, -1), interrupted];
    if (attempts.length >= defaultProtocol.retry.maxAttempts) {
      const failed: GenerationCacheRecord = {
        schemaVersion: 1,
        cacheKey: record.cacheKey,
        request: record.request,
        status: 'failed',
        attempts,
        error: interrupted.error!,
        updatedAt: this.now().toISOString(),
      };
      await this.cache.put(failed);
      return failed;
    }
    const pending: GenerationCacheRecord = {
      ...record,
      status: 'pending',
      attempts,
      updatedAt: this.now().toISOString(),
    };
    await this.cache.put(pending);
    return pending;
  }
}

function toPersistedError(error: unknown): PersistedGenerationError {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  const redact = (value: string): string =>
    value
      .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
      .replace(
        /((?:["']?)(?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|authorization|password|secret|token)(?:["']?)(\s*[:=]\s*["']?))([^"'\s,;}]+)(["']?)/gi,
        '$1[REDACTED]$4',
      );
  const persisted: PersistedGenerationError = { name: name || 'Error', message: redact(message) };
  if (error instanceof GenerationClientError) {
    persisted.statusCode = error.statusCode;
    persisted.responseBody = error.responseBody === null ? null : redact(error.responseBody);
  }
  return persisted;
}

function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
