// src/core/semdocir/model.ts — vocabulary of the JS-SemDocIR extractor.
//
// Types and type guards shared by the extraction rules. No behaviour lives
// here: a rule module decides what to emit, this module only says what a node
// is (spec §2, §4).

import type {
  ArrowFunctionExpression,
  AwaitExpression,
  BreakStatement,
  CallExpression,
  ClassMethod,
  ClassPrivateMethod,
  ContinueStatement,
  DoWhileStatement,
  ForInStatement,
  ForOfStatement,
  ForStatement,
  FunctionDeclaration,
  FunctionExpression,
  NewExpression,
  Node,
  ObjectMethod,
  OptionalCallExpression,
  ReturnStatement,
  TaggedTemplateExpression,
  ThrowStatement,
  UnaryExpression,
  WhileStatement,
} from '@babel/types';

/** Categories in canonical order (E2). */
export const CATEGORIES = ['INPUT', 'COND', 'CALL', 'ASYNC', 'ERR', 'RET', 'ND'] as const;

/** A JS-SemDocIR category keyword. */
export type Category = (typeof CATEGORIES)[number];

/** One JS-SemDocIR record: the text AFTER the category keyword. */
export interface Record {
  category: Category;
  content: string;
  /** Monotonic counter following source order; the assembler sorts by it (E2). */
  order: number;
}

/** Result of extraction: header data plus the records by category. */
export interface ExtractorResult {
  name: string;
  isAsync: boolean;
  /** Rendered parameters, in order (also emitted as INPUT records). */
  params: string[];
  records: Record[];
  /** A `throw` exists (guarded or not) — drives the `ERR NOCATCH` marker (§2.3). */
  hasThrow: boolean;
}

/** Function node types that delimit a traversal frontier (§1.1). */
export type FunctionNode = FunctionDeclaration | FunctionExpression | ArrowFunctionExpression;

/** Operation sites that generate CALL/ASYNC records (§4.2, E7). */
export type OperationNode =
  | AwaitExpression
  | CallExpression
  | NewExpression
  | OptionalCallExpression
  | TaggedTemplateExpression;

/** Direct effects that can carry a guard (§2.2, §4.2). */
export type DirectEffectNode =
  BreakStatement | ContinueStatement | ReturnStatement | ThrowStatement;

/** Loop statements rendered as `COND LOOP <header>` (§4.2, E6). */
export type LoopNode =
  DoWhileStatement | ForInStatement | ForOfStatement | ForStatement | WhileStatement;

/** Function-like nodes: traversal frontiers for binding analysis (I-F2.7-01). */
export type FunctionLikeAll = FunctionNode | ObjectMethod | ClassMethod | ClassPrivateMethod;

export function isFunctionNode(node: Node): node is FunctionNode {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

export function isFunctionLikeNode(node: Node): node is FunctionLikeAll {
  return (
    isFunctionNode(node) ||
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod' ||
    node.type === 'ClassPrivateMethod'
  );
}

export function isOperationNode(node: Node): node is OperationNode {
  return (
    node.type === 'AwaitExpression' ||
    node.type === 'CallExpression' ||
    node.type === 'NewExpression' ||
    node.type === 'OptionalCallExpression' ||
    node.type === 'TaggedTemplateExpression'
  );
}

export function isDirectEffect(node: Node): node is DirectEffectNode {
  return (
    node.type === 'BreakStatement' ||
    node.type === 'ContinueStatement' ||
    node.type === 'ReturnStatement' ||
    node.type === 'ThrowStatement'
  );
}

/** `typeof`/`delete` applied to a non-literal operand is a dynamic operation (§4.4). */
export function isDynamicUnary(node: Node): node is UnaryExpression {
  if (node.type !== 'UnaryExpression') return false;
  if (node.operator !== 'typeof' && node.operator !== 'delete') return false;
  const operand = node.argument;
  return (
    operand.type === 'Identifier' ||
    operand.type === 'MemberExpression' ||
    operand.type === 'OptionalMemberExpression'
  );
}

/** Destructuring targets are not representable as a single `<ident>` (§4.4). */
export function isDestructuring(node: Node): boolean {
  return node.type === 'ArrayPattern' || node.type === 'ObjectPattern';
}

/** Maximum nesting of substitutions; a safety guard, not a semantic limit. */
export const MAX_EXPANSION_DEPTH = 32;

/** A free-variable reference position used by expression expansion (I-F2.7-01). */
export interface IdentifierPosition {
  name: string;
  start: number;
  end: number;
}
