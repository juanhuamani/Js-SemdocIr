import type { IncomingMessage, ServerResponse } from 'node:http';

import {
  type GenerationCache,
  type GenerationCacheRecord,
} from '../../evaluation/generation/cache.ts';
import { GenerationService } from '../../evaluation/generation/generation-service.ts';
import { MockGenerationClient } from '../../evaluation/generation/mock.ts';
import {
  createRepresentationJobs,
  runRepresentationJob,
} from '../../evaluation/generation/orchestrator.ts';
import {
  buildRepresentationBundle,
  FunctionNotAdmittedError,
  type RepresentationId,
} from '../../evaluation/representations/index.ts';
import { readJson, sendJson } from '../http.ts';

class InMemoryGenerationCache implements GenerationCache {
  private readonly records = new Map<string, GenerationCacheRecord>();

  async get(cacheKey: string): Promise<GenerationCacheRecord | null> {
    return this.records.get(cacheKey) ?? null;
  }

  async put(record: GenerationCacheRecord): Promise<void> {
    this.records.set(record.cacheKey, record);
  }
}

const comparisonService = new GenerationService(new MockGenerationClient(), {
  cache: new InMemoryGenerationCache(),
});

/** Experimental-only route, separated from the product/core analysis path. */
export async function handleCompareRoute(
  request: IncomingMessage,
  response: ServerResponse,
): Promise<void> {
  try {
    const parsed = await readJson(request);
    if (typeof parsed !== 'object' || parsed === null || !('source' in parsed)) {
      sendJson(response, 400, { error: 'Envía el código fuente en el campo "source".' });
      return;
    }
    const source = parsed.source;
    if (typeof source !== 'string' || source.trim().length === 0) {
      sendJson(response, 400, { error: 'Pega una función JavaScript antes de comparar.' });
      return;
    }

    const bundle = buildRepresentationBundle(source);
    const outcomes = await Promise.all(
      createRepresentationJobs(bundle).map((job) => runRepresentationJob(job, comparisonService)),
    );
    const generations: Partial<Record<RepresentationId, Record<string, unknown>>> = {};
    for (const outcome of outcomes) {
      generations[outcome.representation] =
        outcome.status === 'succeeded'
          ? {
              status: outcome.status,
              output: outcome.response.output,
              simulated: outcome.response.metadata.simulated,
              cacheHit: outcome.cacheHit,
              attempts: outcome.attempts,
            }
          : {
              status: outcome.status,
              error: outcome.error.message,
              simulated: true,
              cacheHit: outcome.cacheHit,
              attempts: outcome.attempts,
            };
    }

    sendJson(response, 200, {
      mode: 'experimental-comparison-preview',
      clientMode: 'mock',
      functionId: bundle.functionId,
      sourceHash: bundle.sourceHash,
      artifacts: bundle.artifacts,
      generations,
      notice:
        'Vista de comparación del protocolo experimental. La respuesta es simulada; no se generó documentación ni se llamó a un modelo.',
    });
  } catch (error) {
    if (error instanceof FunctionNotAdmittedError) {
      sendJson(response, 422, {
        error: 'La función no pertenece al subconjunto admitido.',
        cause: error.admission.cause,
        detail: error.admission.detail,
      });
      return;
    }
    const status = error instanceof SyntaxError ? 400 : 500;
    sendJson(response, status, { error: error instanceof Error ? error.message : String(error) });
  }
}
