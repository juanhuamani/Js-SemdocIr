import type { GenerationResult } from './generation-service.ts';
import { GenerationService } from './generation-service.ts';
import type { RepresentationArtifact, RepresentationBundle } from '../representations/index.ts';
import { REPRESENTATION_IDS } from '../representations/index.ts';
import { buildGenerationRequest } from './request.ts';

export type RepresentationJob = RepresentationArtifact;

export type RepresentationJobResult = GenerationResult & {
  functionId: string;
  sourceHash: string;
  representation: RepresentationJob['representation'];
  inputArtifactPath: string;
};

/** Creates one independent generation job for each experimental input. */
export function createRepresentationJobs(bundle: RepresentationBundle): RepresentationJob[] {
  return REPRESENTATION_IDS.map((representation) => bundle.artifacts[representation]);
}

/** Runs exactly one function-by-representation job. */
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
