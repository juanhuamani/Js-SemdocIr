// src/generation/errors.ts — persisted error shape and redaction (F2.6).
//
// A failed call is stored, not rethrown: the record must survive the process
// and must not leak credentials into the cache.

import type { PersistedGenerationError } from './cache.ts';
import { GenerationClientError } from './client.ts';

/**
 * Converts a thrown value into the persisted shape, redacting anything that
 * looks like a credential in the message or the provider response body.
 */
export function toPersistedError(error: unknown): PersistedGenerationError {
  const name = error instanceof Error ? error.name : 'Error';
  const message = error instanceof Error ? error.message : String(error);
  const persisted: PersistedGenerationError = { name: name || 'Error', message: redact(message) };
  if (error instanceof GenerationClientError) {
    persisted.statusCode = error.statusCode;
    persisted.responseBody = error.responseBody === null ? null : redact(error.responseBody);
  }
  return persisted;
}

/** Masks bearer tokens and `key: value` / `key=value` credential pairs. */
function redact(value: string): string {
  return value
    .replace(/\bBearer\s+[^\s,;]+/gi, 'Bearer [REDACTED]')
    .replace(
      /((?:["']?)(?:api[_-]?key|api[_-]?token|access[_-]?token|refresh[_-]?token|authorization|password|secret|token)(?:["']?)(\s*[:=]\s*["']?))([^"'\s,;}]+)(["']?)/gi,
      '$1[REDACTED]$4',
    );
}

/** Default sleep between attempts; injectable so tests never wait. */
export function delay(milliseconds: number): Promise<void> {
  return new Promise((resolveDelay) => setTimeout(resolveDelay, milliseconds));
}
