// src/protocol.ts — non-secret, validated generation protocol (F2.5).

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

/** Exact shared instruction from especificacion_propuesta.md §7. */
export const DOCUMENTATION_PROMPT =
  'You are given a JavaScript function represented in a structured textual format. Write a concise documentation comment (2 to 4 sentences) for the function: state what it does with its inputs, the main conditions it checks, the operations it performs, how it handles errors, and what it returns. Do not speculate about behavior that is not represented in the input. Output only the comment text.';

/** Draft decoding/client settings. Real API settings remain deliberately unset. */
export interface ProtocolConfig {
  protocolVersion: string;
  status: 'pending-advisor-and-model-approval';
  prompt: string;
  generation: {
    clientMode: 'mock';
    allowRealApi: false;
    provider: null;
    model: null;
    modelVersion: null;
    temperature: 0;
    topP: 'provider-default';
    maxTokens: 128;
    seed: null;
  };
  retry: {
    maxAttempts: 3;
    initialDelayMs: 1000;
    backoffMultiplier: 2;
  };
}

const SECRET_PROPERTY_NAMES = new Set([
  'apikey',
  'apitoken',
  'authorization',
  'accesstoken',
  'credential',
  'credentials',
  'password',
  'refreshtoken',
  'secret',
  'token',
]);

/**
 * Rejects protocol objects that contain fields conventionally used for
 * credentials, including nested objects and arrays.
 *
 * @param value - Value to inspect.
 * @returns `true` if a secret-like property name is present.
 */
function containsSecretProperty(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(containsSecretProperty);
  if (value === null || typeof value !== 'object') return false;

  return Object.entries(value).some(([key, child]) => {
    const normalized = key.replaceAll(/[^a-z]/gi, '').toLowerCase();
    return SECRET_PROPERTY_NAMES.has(normalized) || containsSecretProperty(child);
  });
}

/**
 * Validates and narrows unknown JSON data to the F2.5 mock-only protocol.
 *
 * @param value - Parsed JSON value.
 * @returns A validated protocol configuration.
 * @throws {TypeError} If the shape, prompt, or safety constraints are invalid.
 */
export function validateProtocolConfig(value: unknown): ProtocolConfig {
  if (containsSecretProperty(value)) {
    throw new TypeError('Protocol configuration must not contain secret fields');
  }
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Protocol configuration must be a JSON object');
  }

  const config = value as Partial<ProtocolConfig>;
  const generation = config.generation;
  const retry = config.retry;
  if (
    typeof config.protocolVersion !== 'string' ||
    config.protocolVersion.length === 0 ||
    config.status !== 'pending-advisor-and-model-approval' ||
    config.prompt !== DOCUMENTATION_PROMPT ||
    generation === undefined ||
    generation.clientMode !== 'mock' ||
    generation.allowRealApi !== false ||
    generation.provider !== null ||
    generation.model !== null ||
    generation.modelVersion !== null ||
    generation.temperature !== 0 ||
    generation.topP !== 'provider-default' ||
    generation.maxTokens !== 128 ||
    generation.seed !== null ||
    retry === undefined ||
    retry.maxAttempts !== 3 ||
    retry.initialDelayMs !== 1000 ||
    retry.backoffMultiplier !== 2
  ) {
    throw new TypeError('Protocol configuration does not match the safe F2.5 draft');
  }

  return config as ProtocolConfig;
}

/**
 * Loads the versioned protocol draft from JSON and validates its safe defaults.
 *
 * @param path - Optional absolute path to a protocol JSON file.
 * @returns Validated, mock-only protocol configuration.
 */
export function loadProtocolConfig(
  path = fileURLToPath(new URL('../../../protocol.json', import.meta.url)),
): ProtocolConfig {
  const parsed: unknown = JSON.parse(readFileSync(path, 'utf8'));
  return validateProtocolConfig(parsed);
}
