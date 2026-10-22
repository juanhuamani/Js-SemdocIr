// src/filter.ts — admission filter (spec §1.2–1.3, §14.2).
//
// Contract (especificacion_propuesta.md §14.2):
//   Input:  AST (JSON) produced by src/parse.ts.
//   Output: { admitted, cause, detail } — admitted or excluded WITH a cause.
//
// Admission conditions (spec §1.3): (1) it is a unit per §1.1; (2) syntactic
// analysis succeeds [satisfied upstream, in parse.ts]; (3) it contains no
// rejected node from the §1.2 table (deterministic check of the COMPLETE tree,
// unlike the extractor, which respects frontiers); (4) its longest
// serialization (B1) does not exceed the model window [Phase 2].
//
// The filter is deterministic: same function → same classification.

import type {
  ArrowFunctionExpression,
  ClassMethod,
  ClassPrivateMethod,
  File,
  FunctionDeclaration,
  FunctionExpression,
  MemberExpression,
  Node,
  ObjectMethod,
  Program,
} from '@babel/types';

import { walk, ABORT } from './walk.ts';

/**
 * Catalog of exclusion causes. Stable keys (English, kebab-case) for
 * `corpus/exclusiones.csv`. Single source of truth for causes.
 */
export const CAUSES = {
  NOT_A_UNIT: 'not-a-unit',
  SYNTAX: 'syntax', // upstream: syntax error in parse.ts
  CLASS: 'class',
  GENERATOR: 'generator',
  IMPORT_META: 'import-meta',
  DYNAMIC_IMPORT: 'dynamic-import',
  WITH: 'with',
  ARGUMENTS: 'arguments',
  EVAL: 'eval',
  WINDOW: 'window', // Phase 2: window guard over B1
} as const;

export type Cause = (typeof CAUSES)[keyof typeof CAUSES];

/** Node types rejected directly (spec §1.2). */
const REJECTED_NODE_TYPES = new Map<string, Cause>([
  ['ClassDeclaration', CAUSES.CLASS],
  ['ClassExpression', CAUSES.CLASS],
  ['MetaProperty', CAUSES.IMPORT_META],
  ['ImportExpression', CAUSES.DYNAMIC_IMPORT],
  ['WithStatement', CAUSES.WITH],
]);

/** Function node types that may be generators (spec §1.2). */
type FunctionLikeNode =
  FunctionDeclaration | FunctionExpression | ObjectMethod | ClassMethod | ClassPrivateMethod;

function isFunctionNode(node: Node): node is FunctionLikeNode {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod' ||
    node.type === 'ClassPrivateMethod'
  );
}

/** A recognized function unit (spec §1.1). */
export interface Unit {
  node: FunctionDeclaration | FunctionExpression | ArrowFunctionExpression;
  name: string;
  isAsync: boolean;
}

/** Result of the admission filter. */
export interface FilterResult {
  admitted: boolean;
  cause: Cause | null;
  detail: string | null;
}

function isFunctionValue(
  node: Node | null | undefined,
): node is FunctionExpression | ArrowFunctionExpression {
  return (
    node !== null &&
    node !== undefined &&
    (node.type === 'FunctionExpression' || node.type === 'ArrowFunctionExpression')
  );
}

/**
 * Returns the static name of a member assignment (`module.exports.f`), or
 * `null` if the name is not statically determinable.
 */
function memberName(member: MemberExpression): string | null {
  const prop = member.property;
  if (prop.type === 'Identifier' && !member.computed) return prop.name;
  if (prop.type === 'StringLiteral') return prop.value;
  return null;
}

/**
 * Detects whether the top-level statement body is a function unit (spec §1.1)
 * and, if so, returns its node, its name and whether it is async.
 *
 * Recognized forms:
 *   1. `function name(...) { ... }` (named FunctionDeclaration).
 *   2. `const/let/var name = function () { ... }` or `= () => ...`.
 *   3. `module.exports.name = function () { ... }` (member assignment).
 *
 * @param body - `ast.program.body`.
 * @returns the unit, or `null` if the fragment is not a single function unit.
 */
export function detectUnit(body: Program['body']): Unit | null {
  if (!Array.isArray(body) || body.length !== 1) return null;
  const stmt = body[0];

  if (stmt.type === 'FunctionDeclaration') {
    const name = stmt.id?.name;
    if (name !== undefined) {
      return { node: stmt, name, isAsync: Boolean(stmt.async) };
    }
  }

  if (stmt.type === 'VariableDeclaration' && stmt.declarations.length === 1) {
    const decl = stmt.declarations[0];
    if (decl.id.type === 'Identifier' && isFunctionValue(decl.init)) {
      return { node: decl.init, name: decl.id.name, isAsync: Boolean(decl.init.async) };
    }
  }

  if (stmt.type === 'ExpressionStatement' && stmt.expression.type === 'AssignmentExpression') {
    const { left, right, operator } = stmt.expression;
    if (operator === '=' && isFunctionValue(right) && left.type === 'MemberExpression') {
      const name = memberName(left);
      if (name !== null) {
        return { node: right, name, isAsync: Boolean(right.async) };
      }
    }
  }

  return null;
}

/**
 * Finds the first rejected node from the §1.2 table in the COMPLETE tree.
 *
 * @param program - `ast.program`.
 * @returns the rejected node's cause and detail, or `null` if none.
 */
export function findRejectedNode(program: Program): { cause: Cause; detail: string } | null {
  let found: { cause: Cause; detail: string } | null = null;

  walk(program, (node) => {
    // Generators (including async) — spec §1.2.
    if (isFunctionNode(node) && node.generator === true) {
      found = { cause: CAUSES.GENERATOR, detail: `${node.type} generator` };
      return ABORT;
    }

    // Identifiers with non-local semantics — spec §1.2. Literal reading of the
    // table: the `arguments`/`eval` identifier is rejected in any position.
    if (node.type === 'Identifier') {
      if (node.name === 'arguments') {
        found = { cause: CAUSES.ARGUMENTS, detail: 'identifier "arguments"' };
        return ABORT;
      }
      if (node.name === 'eval') {
        found = { cause: CAUSES.EVAL, detail: 'identifier "eval"' };
        return ABORT;
      }
    }

    // Directly rejected node types — spec §1.2.
    const cause = REJECTED_NODE_TYPES.get(node.type);
    if (cause !== undefined) {
      found = { cause, detail: `node ${node.type}` };
      return ABORT;
    }

    return undefined; // descend
  });

  return found;
}

/**
 * Decides whether a function is admitted or excluded with a cause.
 *
 * @param ast - AST returned by parseFunction.
 * @param options - `windowLimit` enables the window guard (Phase 2, over B1
 *   length); inactive by default.
 * @returns the classification result.
 */
export function filter(ast: File, options: { windowLimit?: number | null } = {}): FilterResult {
  const { windowLimit = null } = options;
  const body = ast.program.body;

  // Condition 1 — it is a unit (§1.1).
  if (detectUnit(body) === null) {
    return {
      admitted: false,
      cause: CAUSES.NOT_A_UNIT,
      detail: 'the fragment is not an admitted function unit (§1.1)',
    };
  }

  // Condition 3 — no rejected nodes (§1.2, complete tree).
  const rejected = findRejectedNode(ast.program);
  if (rejected !== null) {
    return { admitted: false, cause: rejected.cause, detail: rejected.detail };
  }

  // Condition 4 — window guard (Phase 2): compares B1 length with `windowLimit`.
  // Without B1 in Phase 1, it stays inactive.
  if (windowLimit !== null) {
    // TODO (Phase 2): exclude with CAUSES.WINDOW when B1 exceeds `windowLimit`.
  }

  return { admitted: true, cause: null, detail: null };
}
