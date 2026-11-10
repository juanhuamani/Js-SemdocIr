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

interface ProviderDefaults {
  /** Prefix of the environment variables, without the trailing underscore. */
  prefix: string;
  /** Used when `<PREFIX>_BASE_URL` is not set. */
  defaultBaseUrl?: string;
  /** Used when `<PREFIX>_MODEL` is not set. */
  defaultModel?: string;
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
 * Reads provider settings from the environment under a variable prefix.
 *
 * Error messages name the variable but never echo its value, so a mistyped key
 * cannot leak into a log.
 *
 * @param env - Environment to read.
 * @param defaults - Variable prefix and optional fallbacks.
 * @returns Validated connection settings.
 * @throws {TypeError} If a required variable is missing or malformed.
 */
function loadConfig(env: NodeJS.ProcessEnv, defaults: ProviderDefaults): ProviderConfig {
  const { prefix } = defaults;
  const apiKey = (env[`${prefix}_API_KEY`] ?? '').trim();
  const baseUrl = (
    (env[`${prefix}_BASE_URL`] ?? '').trim() ||
    (defaults.defaultBaseUrl ?? '')
  ).trim();
  const model = ((env[`${prefix}_MODEL`] ?? '').trim() || (defaults.defaultModel ?? '')).trim();
  const timeoutRaw = (env[`${prefix}_TIMEOUT_MS`] ?? '').trim();

  if (apiKey.length === 0) {
    throw new TypeError(`${prefix}_API_KEY is not set`);
  }
  if (baseUrl.length === 0) {
    throw new TypeError(`${prefix}_BASE_URL is not set`);
  }
  if (!isHttpUrl(baseUrl)) {
    throw new TypeError(`${prefix}_BASE_URL must be an absolute http(s) URL`);
  }

  const timeoutMs = timeoutRaw.length === 0 ? DEFAULT_TIMEOUT_MS : Number(timeoutRaw);
  if (!Number.isInteger(timeoutMs) || timeoutMs <= 0) {
    throw new TypeError(`${prefix}_TIMEOUT_MS must be a positive integer`);
  }

  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    apiKey,
    model: model.length === 0 ? null : model,
    timeoutMs,
  };
}

/**
 * Reads the CommandCode (Chat Completions) settings from the environment.
 *
 * @param env - Environment to read; defaults to `process.env`.
 * @returns Validated connection settings.
 * @throws {TypeError} If a required variable is missing or malformed.
 */
export function loadProviderConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  return loadConfig(env, { prefix: 'COMMANDCODE' });
}

/**
 * Reads the OpenAI Responses settings from the environment.
 *
 * Defaults to the public OpenAI endpoint and `gpt-5.3-codex`, the only model
 * that served the experiment with reasoning disabled.
 *
 * @param env - Environment to read; defaults to `process.env`.
 * @returns Validated connection settings.
 * @throws {TypeError} If a required variable is missing or malformed.
 */
export function loadResponsesConfig(env: NodeJS.ProcessEnv = process.env): ProviderConfig {
  return loadConfig(env, {
    prefix: 'OPENAI',
    defaultBaseUrl: 'https://api.openai.com/v1',
    defaultModel: 'gpt-5.3-codex',
  });
}
