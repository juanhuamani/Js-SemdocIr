// src/core/semdocir/rules/expressions.ts — values, destinations and operation
// sites (§4.2, §4.3-d, E4, E7).

import type {
  AssignmentExpression,
  CallExpression,
  NewExpression,
  Node,
  OptionalCallExpression,
  TaggedTemplateExpression,
  VariableDeclaration,
  VariableDeclarator,
} from '@babel/types';

import { walk } from '../../ast/walk.ts';
import { isDestructuring, isDynamicUnary, isFunctionNode, isOperationNode } from '../model.ts';
import type { OperationNode } from '../model.ts';
import type { ExtractionContext } from './context.ts';

/**
 * Extracts an expression that may itself be an operation site (with an
 * optional destination `-> <id>`) or contain nested top-level sites.
 */
export function extractValue(
  ctx: ExtractionContext,
  expression: Node | null | undefined,
  target?: string,
): void {
  if (expression == null) return;
  if (isOperationNode(expression)) {
    emitOperation(ctx, expression, target);
    return;
  }
  decompose(ctx, expression);
}

export function extractExpressionStatement(ctx: ExtractionContext, expression: Node): void {
  if (expression.type === 'AssignmentExpression') {
    extractAssignment(ctx, expression);
    return;
  }
  extractValue(ctx, expression);
}

/**
 * `x = call()` produces the destination `-> x` (§4.2); a destructuring
 * target produces an ND record (§4.4); property assignment is outside the
 * v1.0 categories (§4.3-h); `x = 5` produces no record.
 */
export function extractAssignment(ctx: ExtractionContext, expression: AssignmentExpression): void {
  let target: string | undefined;
  if (expression.operator === '=') {
    if (expression.left.type === 'Identifier') {
      target = expression.left.name;
    } else if (isDestructuring(expression.left) && isOperationNode(expression.right)) {
      ctx.emit('ND', `assignment target: ${ctx.verbatim(expression.left)}`);
    }
  }
  extractValue(ctx, expression.right, target);
}

export function extractVariableDeclaration(
  ctx: ExtractionContext,
  statement: VariableDeclaration,
): void {
  for (const declarator of statement.declarations) extractDeclarator(ctx, declarator);
}

function extractDeclarator(ctx: ExtractionContext, declarator: VariableDeclarator): void {
  const { id, init } = declarator;
  if (init == null) return; // `let x;` — nothing to extract
  if (id.type === 'Identifier') {
    extractValue(ctx, init, id.name);
    return;
  }
  if (isOperationNode(init)) {
    ctx.emit('ND', `assignment target: ${ctx.verbatim(id)}`);
  }
  extractValue(ctx, init);
}

/**
 * Decomposes nested top-level operation sites inside a non-operation
 * expression (E7). Sites nested inside another site stay verbatim (§4.3-d),
 * functions are frontiers (§4.3-e) and `typeof`/`delete` register ND (§4.4).
 */
function decompose(ctx: ExtractionContext, expression: Node): void {
  walk(expression, (node) => {
    if (isFunctionNode(node)) return false;
    if (isOperationNode(node)) {
      emitOperation(ctx, node); // nested sites carry no destination (§4.2)
      return false;
    }
    if (isDynamicUnary(node)) {
      ctx.emit('ND', `dynamic operation: ${ctx.verbatim(node)}`);
      return false;
    }
    return undefined;
  });
}

function emitOperation(ctx: ExtractionContext, node: OperationNode, target?: string): void {
  if (node.type === 'AwaitExpression') {
    ctx.emit('ASYNC', `await ${ctx.verbatim(node.argument)}${ctx.destination(target)}`);
    // E4 duplication: the awaited call is also a call site.
    if (isOperationNode(node.argument)) emitOperation(ctx, node.argument, target);
    return;
  }
  ctx.emit('CALL', `${ctx.expanded(node)}${ctx.destination(target)}`);
  emitCalleeNonDeterminability(ctx, node);
}

/**
 * §4.4: a `this` receiver and a computed callee make the call target
 * non-determinable. Both facts are registered when they co-occur.
 */
function emitCalleeNonDeterminability(
  ctx: ExtractionContext,
  node: CallExpression | NewExpression | OptionalCallExpression | TaggedTemplateExpression,
): void {
  const callee = node.type === 'TaggedTemplateExpression' ? node.tag : node.callee;
  if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return;
  if (callee.object.type === 'ThisExpression') {
    ctx.emit('ND', 'receiver is calling-context dependent: this');
  }
  if (callee.computed) {
    ctx.emit('ND', `callee not statically resolvable: ${ctx.verbatim(callee)}`);
  }
}
