// src/ast.ts — AST traversal utilities (ESTree family, Babel).
//
// Shared by the filter (SF1.2, FULL-tree traversal) and the extractor
// (SF1.3/SF1.4, traversal with FUNCTION frontiers). A single, well-defined
// traversal avoids divergence between the two.

import type { Node } from '@babel/types';

/** Value returned by `enter` to stop the whole traversal. */
export const ABORT = Symbol('abort');

/**
 * Node keys that are neither child nodes nor contain nodes: position metadata
 * and comments/tokens. Excluded from traversal.
 */
const META_KEYS = new Set<string>([
  'loc',
  'start',
  'end',
  'range',
  'extra',
  'leadingComments',
  'trailingComments',
  'innerComments',
  'comments',
  'tokens',
  'errors',
]);

/**
 * Determines whether a value is an AST node. A node is an object with a
 * string-valued `type` property, which no Babel metadata carries.
 *
 * @param value - value to test.
 * @returns `true` if `value` is an AST node.
 */
export function isNode(value: unknown): value is Node {
  return (
    value !== null &&
    typeof value === 'object' &&
    typeof (value as { type?: unknown }).type === 'string'
  );
}

/**
 * Depth-first traversal of the AST, visiting every node.
 *
 * `enter(node, parent)` controls the traversal by its return value:
 *   - `false` → do not descend into `node`'s children (frontier); continue
 *     with the siblings. This is the basis of the nested-function frontier.
 *   - `ABORT` → stop the whole traversal.
 *   - anything else → descend normally.
 *
 * @param node - root node of the traversal.
 * @param enter - visitor callback.
 * @param parent - parent of `node` (defaults to `null`).
 * @returns `false` if aborted via `ABORT`, otherwise `true`.
 */
export function walk(
  node: Node,
  enter: (node: Node, parent: Node | null) => false | typeof ABORT | void,
  parent: Node | null = null,
): boolean {
  if (!isNode(node)) return true;

  const action = enter(node, parent);
  if (action === false) return true;
  if (action === ABORT) return false;

  const record = node as unknown as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (META_KEYS.has(key)) continue;
    const child = record[key];
    if (Array.isArray(child)) {
      for (const item of child) {
        if (walk(item as Node, enter, node) === false) return false;
      }
    } else if (walk(child as Node, enter, node) === false) {
      return false;
    }
  }
  return true;
}
