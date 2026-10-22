import { createHash } from 'node:crypto';

import type { Node } from '@babel/types';

import { analyzeFunction } from '../../core/ast/analysis.ts';
import type { FilterResult } from '../../core/ast/filter.ts';
import { serializeNit } from './serializers/nit.ts';
import { serializeSbt } from './serializers/sbt.ts';

/** Stable identifiers for the four experimental input representations. */
export const REPRESENTATION_IDS = ['b0', 'b1', 'b2', 'p'] as const;
export type RepresentationId = (typeof REPRESENTATION_IDS)[number];

/** One reproducible representation artifact, ready for persistence. */
export interface RepresentationArtifact {
  functionId: string;
  representation: RepresentationId;
  sourceHash: string;
  relativePath: string;
  content: string;
}

/** The four representations and their shared function identity. */
export interface RepresentationBundle {
  functionId: string;
  sourceId: string | null;
  sourceHash: string;
  artifacts: Record<RepresentationId, RepresentationArtifact>;
}

export interface BuildRepresentationOptions {
  sourceId?: string;
}

/** Raised when input passes syntax parsing but fails the frozen admission rule. */
export class FunctionNotAdmittedError extends Error {
  readonly admission: FilterResult;

  constructor(admission: FilterResult) {
    super(`Function is not admitted: ${admission.cause ?? 'unknown'} (${admission.detail ?? ''})`);
    this.name = 'FunctionNotAdmittedError';
    this.admission = admission;
  }
}

/** Creates B0/B1/B2/P from the shared core analysis, without reparsing. */
export function buildRepresentationBundle(
  source: string,
  options: BuildRepresentationOptions = {},
): RepresentationBundle {
  const sourceId = options.sourceId ?? null;
  if (sourceId !== null && sourceId.trim().length === 0) {
    throw new TypeError('sourceId must not be empty or whitespace');
  }

  const analysis = analyzeFunction(source);
  if (!analysis.admission.admitted || analysis.functionNode === null) {
    throw new FunctionNotAdmittedError(analysis.admission);
  }
  const sourceHash = analysis.sourceHash;
  const functionId = sourceId ?? `sha256:${sourceHash}`;
  const filename = `${createHash('sha256').update(functionId, 'utf8').digest('hex')}.txt`;
  const functionNode: Node = analysis.functionNode;
  const contents: Record<RepresentationId, string> = {
    b0: source,
    b1: serializeSbt(functionNode, source),
    b2: serializeNit(functionNode, source),
    p: analysis.representation!,
  };
  const artifacts = Object.fromEntries(
    REPRESENTATION_IDS.map((representation) => [
      representation,
      {
        functionId,
        representation,
        sourceHash,
        relativePath: `repr/${representation}/${filename}`,
        content: contents[representation],
      },
    ]),
  ) as Record<RepresentationId, RepresentationArtifact>;

  return { functionId, sourceId, sourceHash, artifacts };
}
