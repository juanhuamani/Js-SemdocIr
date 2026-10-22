// src/representations.ts — common identity and artifact contract (F2.4).

import { createHash } from 'node:crypto';

import type { Node } from '@babel/types';

import { assemble } from './assembler.ts';
import { extractFunction } from './extractor.ts';
import { detectUnit, filter, type FilterResult } from './filter.ts';
import { parseFunction } from './parse.ts';
import { serializeNit } from './serializers/nit.ts';
import { serializeSbt } from './serializers/sbt.ts';

/** Stable identifiers for the four experimental input representations. */
export const REPRESENTATION_IDS = ['b0', 'b1', 'b2', 'p'] as const;

/** A supported representation identifier. */
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
  /** Original upstream identifier, when the caller supplied one. */
  sourceId: string | null;
  /** SHA-256 of the exact UTF-8 source, independent of `functionId`. */
  sourceHash: string;
  artifacts: Record<RepresentationId, RepresentationArtifact>;
}

/** Options for building a representation bundle. */
export interface BuildRepresentationOptions {
  /** Stable dataset/source identifier. SHA-256 of `source` is used if omitted. */
  sourceId?: string;
}

/** Admission failure raised before any representation is generated. */
export class FunctionNotAdmittedError extends Error {
  readonly admission: FilterResult;

  constructor(admission: FilterResult) {
    super(`Function is not admitted: ${admission.cause ?? 'unknown'} (${admission.detail ?? ''})`);
    this.name = 'FunctionNotAdmittedError';
    this.admission = admission;
  }
}

/**
 * Computes a lowercase hexadecimal SHA-256 digest of UTF-8 text.
 *
 * @param value - Text to hash.
 * @returns A 64-character lowercase hexadecimal digest.
 */
function sha256(value: string): string {
  return createHash('sha256').update(value, 'utf8').digest('hex');
}

/**
 * Creates B0, B1, B2, and P from one admitted function and one parsed AST.
 *
 * If `sourceId` is supplied, it is used unchanged as the function identity;
 * otherwise, the identity is `sha256:<sourceHash>`. A second hash of the
 * function identity supplies a path-safe artifact filename, so arbitrary
 * upstream IDs never become path components.
 *
 * @param source - Exact source text of one JavaScript function.
 * @param options - Optional stable source identifier.
 * @returns A bundle containing all four representations and artifact paths.
 * @throws {TypeError} If a supplied source identifier is empty or whitespace.
 * @throws {SyntaxError} If parsing fails.
 * @throws {FunctionNotAdmittedError} If the function fails the admission
 *   filter.
 */
export function buildRepresentationBundle(
  source: string,
  options: BuildRepresentationOptions = {},
): RepresentationBundle {
  const sourceId = options.sourceId ?? null;
  if (sourceId !== null && sourceId.trim().length === 0) {
    throw new TypeError('sourceId must not be empty or whitespace');
  }

  const sourceHash = sha256(source);
  const functionId = sourceId ?? `sha256:${sourceHash}`;
  const filename = `${sha256(functionId)}.txt`;
  const ast = parseFunction(source);
  const admission = filter(ast);
  if (!admission.admitted) throw new FunctionNotAdmittedError(admission);

  const unit = detectUnit(ast.program.body);
  if (unit === null) {
    // Defensive consistency check: `filter` and `detectUnit` share the same
    // unit rule, so reaching this branch indicates an internal contract bug.
    throw new Error('Admitted AST did not resolve to a function unit');
  }

  // Keep an explicit reference to the selected root node: B1 and B2 both
  // consume this exact node from the single parse above.
  const functionNode: Node = unit.node;
  const contents: Record<RepresentationId, string> = {
    b0: source,
    b1: serializeSbt(functionNode, source),
    b2: serializeNit(functionNode, source),
    p: assemble(extractFunction(source, ast)),
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
