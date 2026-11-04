// src/generation/corpus-config.ts — corpus freeze block (spec §9, §15).
//
// Kept apart from the generation protocol so each file owns one concern:
// this one freezes WHERE the corpus comes from and with WHICH seed and
// versions it is characterised; protocol.ts owns WHAT is sent to the model.

/**
 * Corpus freeze: dataset version, checksums, the single seed used by every
 * later sampling, and the parser and tokenizer versions.
 */
export interface CorpusConfig {
  dataset: string;
  sourceUrl: string;
  sourceCommit: string;
  sourceSha256: string;
  downloadDate: string;
  seed: number;
  parserVersion: string;
  tokenizer: string;
}

/**
 * Validates the corpus freeze block.
 *
 * @param value - Candidate corpus block.
 * @returns The validated corpus configuration.
 * @throws {TypeError} If a field is missing, empty or of the wrong shape.
 */
export function validateCorpusConfig(value: unknown): CorpusConfig {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) {
    throw new TypeError('Corpus configuration must be a JSON object');
  }

  const corpus = value as Partial<Record<keyof CorpusConfig, unknown>>;
  const textFields = [
    'dataset',
    'sourceUrl',
    'sourceCommit',
    'sourceSha256',
    'parserVersion',
    'tokenizer',
  ] as const;
  for (const field of textFields) {
    const fieldValue = corpus[field];
    if (typeof fieldValue !== 'string' || fieldValue.length === 0) {
      throw new TypeError(`Corpus field "${field}" must be a non-empty string`);
    }
  }
  if (typeof corpus.downloadDate !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(corpus.downloadDate)) {
    throw new TypeError('Corpus field "downloadDate" must be an ISO date (YYYY-MM-DD)');
  }
  if (typeof corpus.seed !== 'number' || !Number.isInteger(corpus.seed) || corpus.seed < 0) {
    throw new TypeError('Corpus field "seed" must be a non-negative integer');
  }

  return corpus as unknown as CorpusConfig;
}
