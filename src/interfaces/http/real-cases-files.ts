// real-cases-files.ts - read-only access to the stored experiment files.

import { readFile } from 'node:fs/promises';

export type RepresentationId = 'b0' | 'b1' | 'b2' | 'p';

export interface CaseMetrics {
  readonly bleu: number | null;
  readonly rougeL: number | null;
  readonly bertscore: number | null;
  readonly latencyMs: number | null;
  readonly inputTokens: number | null;
  readonly outputTokens: number | null;
  readonly cacheHit: boolean | null;
  readonly attempts: number | null;
}

export interface DatasetRecord {
  id: string;
  repo: string;
  path: string;
  func_name: string;
  url: string;
  docstring: string;
  partition?: string;
}

export interface OutputRecord {
  id: string;
  representation: RepresentationId;
  status: string;
  functionName: string;
  output: string;
  attempts: number;
  cacheHit: boolean;
  inputTokens: number;
  outputTokens: number;
  latencyMs: number;
  model: string;
}

export interface ScoreRow {
  id: string;
  representation: RepresentationId;
  bleu?: number;
  precision?: number;
  recall?: number;
  f1?: number;
}

export interface ProtocolFile {
  protocolVersion: string;
  prompt: string;
  generation: { temperature: number; topP: string; maxTokens: number; seed: number | null };
  corpus: { dataset: string; sourceCommit: string; seed: number; parserVersion: string };
}

export async function readJsonl<T>(file: string): Promise<T[]> {
  const text = await readFile(file, 'utf8');
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim().length > 0)
    .map((line) => JSON.parse(line) as T);
}

export async function readOptionalText(file: string): Promise<string | null> {
  try {
    return await readFile(file, 'utf8');
  } catch {
    return null;
  }
}

export function scoreKey(id: string, representation: RepresentationId): string {
  return `${id}|${representation}`;
}

export function metricsFor(
  representation: RepresentationId,
  output: OutputRecord | undefined,
  bleu: ReadonlyMap<string, number | null>,
  rouge: ReadonlyMap<string, number | null>,
  bert: ReadonlyMap<string, number | null>,
): CaseMetrics {
  const key = scoreKey(output?.id ?? '', representation);
  return {
    bleu: bleu.get(key) ?? null,
    rougeL: rouge.get(key) ?? null,
    bertscore: bert.get(key) ?? null,
    latencyMs: output?.latencyMs ?? null,
    inputTokens: output?.inputTokens ?? null,
    outputTokens: output?.outputTokens ?? null,
    cacheHit: output?.cacheHit ?? null,
    attempts: output?.attempts ?? null,
  };
}
