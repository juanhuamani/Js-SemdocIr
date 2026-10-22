// src/serializers/sbt.ts — deterministic structure-based traversal (F2.2).

import type { Node } from '@babel/types';

import { getNodeChildren, getNodePayload } from './shared.ts';

/**
 * Serializes a selected function AST node using the B1/SBT representation.
 * The root is the function node itself; Babel's `File` and `Program` wrappers
 * are not included. Child nodes follow Babel `VISITOR_KEYS` order.
 *
 * @param node - Selected Babel function node.
 * @param source - Exact source text from which the AST was parsed.
 * @returns One deterministic SBT line.
 */
export function serializeSbt(node: Node, source: string): string {
  const payload = getNodePayload(node, source);
  const children = getNodeChildren(node).map((child) => serializeSbt(child, source));
  const parts = [`<${node.type}`];

  if (payload !== null) parts.push(JSON.stringify(payload));
  parts.push(...children, `${node.type}>`);

  return parts.join(' ');
}
