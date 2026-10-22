// src/serializers/shared.ts — shared AST and payload rules for B1/B2.

import { VISITOR_KEYS, type Node } from '@babel/types';

import { isNode } from '../ast.ts';

/** Node payload shared by SBT and NIT. */
export interface SerializedNodePayload {
  source: string | null;
  fields: Record<string, string | number | boolean | null>;
}

/** Babel properties omitted as metadata or duplicated by the exact source. */
const OMITTED_FIELDS = new Set([
  'type',
  'loc',
  'start',
  'end',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'comments',
  'tokens',
  'errors',
  'name',
  'value',
  'raw',
  'cooked',
]);

/** Babel node kinds whose exact source text is included in the payload. */
const SOURCE_VALUE_TYPES = new Set([
  'Identifier',
  'StringLiteral',
  'NumericLiteral',
  'BooleanLiteral',
  'NullLiteral',
  'BigIntLiteral',
  'DecimalLiteral',
  'RegExpLiteral',
  'DirectiveLiteral',
  'TemplateLiteral',
]);

/**
 * Builds the canonical node payload defined in
 * `test/fixtures/serializers/CONTRACT.md`.
 *
 * @param node - Babel AST node.
 * @param source - Original source text used to parse the node.
 * @returns A payload, or `null` if the node has no lexical value or scalar
 *   semantic fields.
 * @throws {TypeError} If a lexical-value node does not have valid source
 *   offsets.
 */
export function getNodePayload(node: Node, source: string): SerializedNodePayload | null {
  const record = node as unknown as Record<string, unknown>;
  let sourceValue: string | null = null;

  if (SOURCE_VALUE_TYPES.has(node.type)) {
    const start = record.start;
    const end = record.end;
    if (
      typeof start !== 'number' ||
      typeof end !== 'number' ||
      !Number.isInteger(start) ||
      !Number.isInteger(end) ||
      start < 0 ||
      end < start ||
      end > source.length
    ) {
      throw new TypeError(`Node ${node.type} has invalid source offsets`);
    }
    sourceValue = source.slice(start, end);
  }

  const fields = Object.fromEntries(
    Object.entries(record)
      .filter(
        ([key, value]) =>
          !OMITTED_FIELDS.has(key) &&
          (value === null ||
            typeof value === 'string' ||
            typeof value === 'number' ||
            typeof value === 'boolean'),
      )
      .sort(([left], [right]) => (left < right ? -1 : left > right ? 1 : 0)),
  ) as Record<string, string | number | boolean | null>;

  if (sourceValue === null && Object.keys(fields).length === 0) return null;
  return { source: sourceValue, fields };
}

/**
 * Returns a node's direct structural children in Babel visitor-key order.
 *
 * @param node - Babel AST node.
 * @returns Ordered child nodes.
 */
export function getNodeChildren(node: Node): Node[] {
  const record = node as unknown as Record<string, unknown>;
  const keys = VISITOR_KEYS[node.type];
  if (keys === undefined) {
    throw new TypeError(`No Babel visitor keys registered for node ${node.type}`);
  }

  const children: Node[] = [];
  for (const key of keys) {
    const value = record[key];
    if (Array.isArray(value)) {
      for (const child of value) {
        if (isNode(child)) children.push(child);
      }
    } else if (isNode(value)) {
      children.push(value);
    }
  }
  return children;
}
