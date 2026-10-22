// src/serializers/nit.ts — deterministic node-index traversal (F2.3).

import type { Node } from '@babel/types';

import { getNodeChildren, getNodePayload, type SerializedNodePayload } from './shared.ts';

type NitTuple = [id: number, type: string, value: SerializedNodePayload | null, children: number[]];

/**
 * Serializes a selected function AST node using the B2/NIT representation.
 * Each node is emitted as one compact JSON tuple per line. IDs are assigned
 * sequentially in pre-order, and direct child IDs follow Babel `VISITOR_KEYS`
 * order. The root is the function node itself; Babel's `File` and `Program`
 * wrappers are not included.
 *
 * @param node - Selected Babel function node.
 * @param source - Exact source text from which the AST was parsed.
 * @returns A deterministic JSON Lines serialization with no trailing newline.
 */
export function serializeNit(node: Node, source: string): string {
  const tuples: NitTuple[] = [];

  const visit = (current: Node): number => {
    const id = tuples.length;
    const tuple: NitTuple = [id, current.type, getNodePayload(current, source), []];
    tuples.push(tuple);

    for (const child of getNodeChildren(current)) {
      tuple[3].push(visit(child));
    }

    return id;
  };

  visit(node);
  return tuples.map((tuple) => JSON.stringify(tuple)).join('\n');
}
