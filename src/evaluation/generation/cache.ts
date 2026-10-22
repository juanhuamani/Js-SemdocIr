// src/client/cache.ts — persistent local generation cache (F2.6).

import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import { dirname, join, resolve } from 'node:path';

import type { GenerationResponse } from './client.ts';
import type { GenerationRequest } from './request.ts';

/** A sanitized error persisted for one generation attempt or job. */
export interface PersistedGenerationError {
  name: string;
  message: string;
  statusCode?: number | null;
  responseBody?: string | null;
}

/** One provider attempt, including interrupted attempts. */
export interface GenerationAttempt {
  number: number;
  startedAt: string;
  finishedAt: string | null;
  status: 'started' | 'succeeded' | 'failed' | 'interrupted';
  error?: PersistedGenerationError;
}

interface CacheRecordBase {
  schemaVersion: 1;
  cacheKey: string;
  request: GenerationRequest;
  attempts: GenerationAttempt[];
  updatedAt: string;
}

/** Durable state for a request, suitable for audit and restart recovery. */
export type GenerationCacheRecord =
  | (CacheRecordBase & { status: 'pending'; response?: never; error?: never })
  | (CacheRecordBase & { status: 'succeeded'; response: GenerationResponse; error?: never })
  | (CacheRecordBase & { status: 'failed'; error: PersistedGenerationError; response?: never });

/** Minimal persistence interface used by the generation service. */
export interface GenerationCache {
  get(cacheKey: string): Promise<GenerationCacheRecord | null>;
  put(record: GenerationCacheRecord): Promise<void>;
}

/**
 * JSON-file cache. Files are written atomically beneath `.cache/generations`
 * by default; the directory is intended to remain outside version control.
 */
export class FileGenerationCache implements GenerationCache {
  readonly directory: string;

  /**
   * @param directory - Cache directory; defaults to `.cache/generations` under
   *   the current working directory.
   */
  constructor(directory = resolve('.cache/generations')) {
    this.directory = directory;
  }

  /**
   * Reads a cached job if present and validates its envelope.
   *
   * @param cacheKey - SHA-256 cache key.
   * @returns The durable cache record, or `null` when absent.
   * @throws {Error} If the key or cached record is malformed.
   */
  async get(cacheKey: string): Promise<GenerationCacheRecord | null> {
    const path = this.pathFor(cacheKey);
    let contents: string;
    try {
      contents = await readFile(path, 'utf8');
    } catch (error) {
      if (isFileNotFound(error)) return null;
      throw error;
    }

    const parsed: unknown = JSON.parse(contents);
    if (!isCacheRecord(parsed) || parsed.cacheKey !== cacheKey) {
      throw new Error(`Invalid generation cache record for ${cacheKey}`);
    }
    return parsed;
  }

  /**
   * Atomically persists one cache record.
   *
   * @param record - Record to store.
   */
  async put(record: GenerationCacheRecord): Promise<void> {
    const path = this.pathFor(record.cacheKey);
    await mkdir(dirname(path), { recursive: true });
    const temporaryPath = join(this.directory, `${record.cacheKey}.${randomUUID()}.tmp`);
    try {
      await writeFile(temporaryPath, JSON.stringify(record), { encoding: 'utf8', flag: 'wx' });
      await rename(temporaryPath, path);
    } finally {
      await rm(temporaryPath, { force: true });
    }
  }

  private pathFor(cacheKey: string): string {
    if (!/^[a-f0-9]{64}$/.test(cacheKey)) {
      throw new TypeError('cacheKey must be a lowercase SHA-256 hex digest');
    }
    return join(this.directory, `${cacheKey}.json`);
  }
}

function isFileNotFound(error: unknown): boolean {
  return (
    error !== null &&
    typeof error === 'object' &&
    'code' in error &&
    (error as { code?: unknown }).code === 'ENOENT'
  );
}

function isCacheRecord(value: unknown): value is GenerationCacheRecord {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false;
  const record = value as Record<string, unknown>;
  return (
    record.schemaVersion === 1 &&
    typeof record.cacheKey === 'string' &&
    typeof record.request === 'object' &&
    record.request !== null &&
    Array.isArray(record.attempts) &&
    typeof record.updatedAt === 'string' &&
    (record.status === 'pending' || record.status === 'succeeded' || record.status === 'failed')
  );
}
