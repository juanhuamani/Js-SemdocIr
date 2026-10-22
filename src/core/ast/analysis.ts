import { createHash } from 'node:crypto';
import type { Node } from '@babel/types';

import { assemble } from '../semdocir/assembler.ts';
import { extractFunction, type ExtractorResult } from '../semdocir/extractor.ts';
import { detectUnit, filter, type FilterResult, type Unit } from './filter.ts';
import { parseFunction } from './parse.ts';

/** One parse/filter/extract/assemble pass over a JavaScript function source. */
export interface FunctionAnalysis {
  source: string;
  sourceHash: string;
  ast: ReturnType<typeof parseFunction>;
  functionNode: Node | null;
  unit: Unit | null;
  admission: FilterResult;
  extracted: ExtractorResult | null;
  representation: string | null;
}

/**
 * Parses and classifies the input once; for admitted functions it also creates
 * the canonical JS-SemDocIR representation P. This is the shared source of
 * truth for the product view and experimental comparison.
 */
export function analyzeFunction(source: string): FunctionAnalysis {
  const ast = parseFunction(source);
  const unit = detectUnit(ast.program.body);
  const admission = filter(ast);
  const sourceHash = createHash('sha256').update(source, 'utf8').digest('hex');

  if (!admission.admitted || unit === null) {
    return {
      source,
      sourceHash,
      ast,
      functionNode: unit?.node ?? null,
      unit,
      admission,
      extracted: null,
      representation: null,
    };
  }

  const extracted = extractFunction(source, ast);
  return {
    source,
    sourceHash,
    ast,
    functionNode: unit.node,
    unit,
    admission,
    extracted,
    representation: assemble(extracted),
  };
}
