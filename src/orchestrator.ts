// src/orchestrator.ts — one-function × one-representation jobs (F2.7).

import type { GenerationResult } from './client/generation-service.ts';
import { GenerationService } from './client/generation-service.ts';
import type { RepresentationArtifact, RepresentationBundle } from './representations.ts';
import { REPRESENTATION_IDS } from './representations.ts';
import { buildGenerationRequest } from './request.ts';

/** One independently executable input job for a single representation. */
export type RepresentationJob = RepresentationArtifact;

/** Traceable generation result linked back to its input artifact. */
export type RepresentationJobResult = GenerationResult & {
  functionId: string;
  sourceHash: string;
  representation: RepresentationJob['representation'];
  inputArtifactPath: string;
};

/**
 * Creates four independent job descriptors for a single function bundle.
 * This function does not invoke a client or start any generation work.
 *
 * @param bundle - Validated B0/B1/B2/P representation bundle.
 * @returns One descriptor per representation in canonical order.
 */
export function createRepresentationJobs(bundle: RepresentationBundle): RepresentationJob[] {
  return REPRESENTATION_IDS.map((representation) => bundle.artifacts[representation]);
}

/**
 * Executes exactly one function × representation job.
 * The caller chooses a single artifact descriptor; this function never fans
 * out to other representations or other functions. The generation service
 * handles caching, retry limits, persistence, and resumability.
 *
 * @param job - One representation artifact.
 * @param service - Configured generation service, normally using the mock
 *   client until provider/model approval is granted.
 * @returns Generation outcome with source and artifact lineage.
 */
export async function runRepresentationJob(
  job: RepresentationJob,
  service: GenerationService,
): Promise<RepresentationJobResult> {
  const outcome = await service.run(buildGenerationRequest(job));
  return {
    ...outcome,
    functionId: job.functionId,
    sourceHash: job.sourceHash,
    representation: job.representation,
    inputArtifactPath: job.relativePath,
  };
}
