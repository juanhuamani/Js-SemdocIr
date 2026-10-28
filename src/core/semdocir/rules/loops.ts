// src/core/semdocir/rules/loops.ts — loop headers and operands (E6).

import type { LoopNode } from '../model.ts';
import type { ExtractionContext } from './context.ts';
import { extractAssignment, extractValue } from './expressions.ts';

export function extractLoop(ctx: ExtractionContext, statement: LoopNode): void {
  ctx.emit('COND', `LOOP ${loopHeader(ctx, statement)}`);
  extractLoopOperands(ctx, statement);
  if (statement.body.type === 'BlockStatement') {
    ctx.extractStatements(statement.body.body);
  } else {
    ctx.extractStatement(statement.body);
  }
}

/** Decomposes top-level calls in the loop's own expressions (E7). */
function extractLoopOperands(ctx: ExtractionContext, statement: LoopNode): void {
  switch (statement.type) {
    case 'ForStatement': {
      const { init, test, update } = statement;
      if (init != null) {
        if (init.type === 'VariableDeclaration') ctx.extractVariableDeclaration(init);
        else if (init.type === 'AssignmentExpression') extractAssignment(ctx, init);
        else extractValue(ctx, init);
      }
      if (test != null) extractValue(ctx, test);
      if (update != null) extractValue(ctx, update);
      return;
    }
    case 'ForInStatement':
    case 'ForOfStatement':
      extractValue(ctx, statement.right);
      return;
    case 'WhileStatement':
    case 'DoWhileStatement':
      extractValue(ctx, statement.test);
      return;
  }
}

/**
 * Verbatim loop header (E6): the fragment from the keyword to the closing
 * parenthesis. `do…while` renders as `do while (<test>)` because its header
 * spans two source fragments around the body.
 */
function loopHeader(ctx: ExtractionContext, statement: LoopNode): string {
  if (statement.type === 'DoWhileStatement') {
    const { body, end } = statement;
    if (body.end == null || end == null) return 'do';
    return `do ${ctx.view.span(body.end, end).replace(/;$/, '')}`;
  }
  if (statement.start == null || statement.body.start == null) return '';
  return ctx.view.span(statement.start, statement.body.start);
}
