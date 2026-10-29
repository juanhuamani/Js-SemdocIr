// src/generation/provider-config.ts — endpoint and credentials from the environment.

/** Connection settings for an OpenAI-compatible provider. */
export interface ProviderConfig {
  /** Base URL up to the version segment, without a trailing slash. */
  baseUrl: string;
  apiKey: string;
  /** Optional fallback model; a request that names a model wins over this. */
  model: string | null;
  timeoutMs: number;
}

const DEFAULT_TIMEOUT_MS = 60_000;

/**
 * Reports whether a string is an absolute HTTP(S) URL.
 *
 * @param value - Candidate endpoint.
 * @returns `true` when the value parses and uses http or https.
 */
function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === 'http:' || url.protocol === 'https:';
  } catch {
    return false;
  }
}

/**
 * Reads provider settings from the process environment.
 *
 * Error messages name the variable but never echo its value, so a mistyped key
 * cannot leak into a log.
 *
 * @param env - Environment to read; defaults to `process.env`.
 * @returns Validated connection settings.
 * @throws {TypeError} If a required variable is missing or malformed.
 */
export function loadProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  const apiKey = (env.COMMANDCODE_API_KEY ?? '').trim();
  const baseUrl = (env.COMMANDCODE_BASE_URL ?? '').trim();
  const model = (env.COMMANDCODE_MODEL ?? '').trim();
  const timeoutRaw = (env.COMMANDCODE_TIMEOUT_MS ?? '').trim();

  if (apiKey.length === 0) {
    throw new TypeError('COMMANDCODE_API_KEY is not set');
  }
  if (baseUrl.length === 0) {
    throw new TypeError('COMMANDCODE_BASE_URL is not set');
  }
  if (!isHttpUrl(baseUrl)) {
    throw new TypeError('COMMANDCODE_BASE_URL must be an absolute http(s) URL');
  }

  const timeoutMs = timeoutRaw.length === 0 ? DEFAULT_TIMEOUT_MS : Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError('COMMANDCODE_TIMEOUT_MS must be a positive integer');
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model: model.length === 0 ? null : model,
    timeoutMs,
  };
}
