// src/core/semdocir/rules/errors.ts — throw and try/catch (§4.2, §3.2).

import type { CatchClause, Node, ThrowStatement, TryStatement } from '@babel/types';

import { returnedValue } from '../expansion.ts';
import type { ExtractionContext } from './context.ts';

export function extractThrow(ctx: ExtractionContext, statement: ThrowStatement): void {
  ctx.markThrow();
  ctx.emit('ERR', ctx.throwContent(statement.argument));
  // Verbatim-only, like guarded throws (see emitGuardedEffect).
}

export function extractTry(ctx: ExtractionContext, statement: TryStatement): void {
  ctx.extractStatements(statement.block.body);
  if (statement.handler != null) extractCatchClause(ctx, statement.handler);
  if (statement.finalizer != null) ctx.extractStatements(statement.finalizer.body);
}

/**
 * One handler record per catch clause (§4.2):
 * `ERR CATCH (<param>) -> <efectoCatch>`, `EMPTY` when the body is empty.
 * A single-statement handler whose statement is a plain effect is consumed
 * into the record (canonical `ERR CATCH (e) -> RET []`); any other body is
 * extracted normally and summarized as `EMPTY` (documented simplification).
 */
function extractCatchClause(ctx: ExtractionContext, clause: CatchClause): void {
  const parameter = clause.param == null ? '' : catchParameter(ctx, clause.param);
  const body = clause.body.body;
  let consumed = false;
  let effect = 'EMPTY';
  if (body.length === 1) {
    const single = catchEffect(ctx, body[0]);
    if (single !== null) {
      effect = single;
      consumed = true;
    }
  }
  ctx.emit('ERR', `CATCH (${parameter}) -> ${effect}`);
  if (!consumed) ctx.extractStatements(body);
}

/**
 * Maps a handler statement to its `<efectoCatch>` (§3.2), or `null` when the
 * statement is not a plain effect (then it is extracted normally, so an
 * `await` inside a handler keeps its ASYNC record).
 */
function catchEffect(ctx: ExtractionContext, statement: Node): string | null {
  if (statement.type === 'ReturnStatement') {
    return `RET ${returnedValue(ctx.view, statement)}`;
  }
  if (statement.type === 'ThrowStatement') {
    ctx.markThrow();
    return ctx.throwContent(statement.argument);
  }
  if (statement.type === 'ExpressionStatement') {
    const expression = statement.expression;
    if (
      expression.type === 'CallExpression' ||
      expression.type === 'NewExpression' ||
      expression.type === 'OptionalCallExpression' ||
      expression.type === 'TaggedTemplateExpression'
    ) {
      return `CALL ${ctx.verbatim(expression)}`;
    }
    if (
      expression.type === 'AssignmentExpression' &&
      expression.operator === '=' &&
      expression.left.type === 'Identifier'
    ) {
      return `ASSIGN ${expression.left.name}`;
    }
  }
  return null;
}

function catchParameter(ctx: ExtractionContext, param: Node): string {
  return param.type === 'Identifier' ? param.name : ctx.verbatim(param);
}
