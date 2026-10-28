// src/core/semdocir/expansion.ts — expression expansion (I-F2.7-01).
//
// RET/CALL/COND records are rendered like `verbatim`, except that each free
// reference to a registered pure binding is replaced by its own expanded
// rendering wrapped in parentheses.

import type { Node, ReturnStatement } from '@babel/types';

import { collectReferencePositions, type BindingTable } from './bindings.ts';
import { MAX_EXPANSION_DEPTH, type IdentifierPosition } from './model.ts';
import { normalize, verbatim, type SourceView } from './source.ts';

/**
 * Expanded rendering for RET/CALL/COND records (I-F2.7-01). Substitution
 * recurses until no registered variable remains (R2), with a depth guard.
 *
 * @param view - verbatim source view.
 * @param table - pure bindings of the current function.
 * @param node - node to render.
 * @param depth - current substitution depth.
 */
export function expanded(
  view: SourceView,
  table: BindingTable,
  node: Node | null | undefined,
  depth = 0,
): string {
  if (node == null) return '';
  if (depth >= MAX_EXPANSION_DEPTH) return verbatim(view, node);

  if (node.type === 'Identifier' && table.has(node.name)) {
    return expanded(view, table, table.get(node.name), depth + 1);
  }

  let baseStart = node.start;
  const baseEnd = node.end;
  if (node.type === 'NewExpression' && node.callee.start != null && node.end != null) {
    baseStart = node.callee.start;
  }
  if (baseStart == null || baseEnd == null) return verbatim(view, node);

  const positions: IdentifierPosition[] = [];
  collectReferencePositions(node, positions);
  const occurrences = positions.filter(
    (position) =>
      position.start >= baseStart && position.end <= baseEnd && table.has(position.name),
  );
  if (occurrences.length === 0) return view.span(baseStart, baseEnd);

  occurrences.sort((left, right) => left.start - right.start);
  let text = '';
  let cursor = baseStart;
  for (const occurrence of occurrences) {
    if (occurrence.start < cursor) continue; // defensive: skip overlaps
    text += view.raw(cursor, occurrence.start);
    text += `(${expanded(view, table, table.get(occurrence.name), depth + 1)})`;
    cursor = occurrence.end;
  }
  text += view.raw(cursor, baseEnd);
  return normalize(text);
}

/**
 * Returned value with expression expansion (I-F2.7-01), for RET records and
 * the `-> RET` value inside COND records.
 */
export function expandedReturnedValue(
  view: SourceView,
  table: BindingTable,
  statement: ReturnStatement,
): string {
  return statement.argument == null ? 'undefined' : expanded(view, table, statement.argument);
}

/**
 * Returned value WITHOUT expansion. Used only for the consumed `RET` inside
 * `ERR CATCH` records: strict R3 of I-F2.7-01 keeps ERR content unexpanded.
 */
export function returnedValue(view: SourceView, statement: ReturnStatement): string {
  return statement.argument == null ? 'undefined' : verbatim(view, statement.argument);
}
