// src/core/semdocir/rules/header.ts — parameters, returns and throw content
// (§3.2).

import type { Node, ReturnStatement } from '@babel/types';

import type { ExtractionContext } from './context.ts';
import { extractValue } from './expressions.ts';

export function extractReturn(ctx: ExtractionContext, statement: ReturnStatement): void {
  ctx.emit('RET', ctx.expandedReturnedValue(statement));
  if (statement.argument != null) extractValue(ctx, statement.argument);
}

/** Renders one parameter for the header and its INPUT record (§3.2). */
export function renderParameter(ctx: ExtractionContext, param: Node): string {
  if (param.type === 'Identifier') return param.name;
  if (param.type === 'AssignmentPattern') {
    return `${renderParameter(ctx, param.left)} = ${ctx.verbatim(param.right)}`;
  }
  if (param.type === 'RestElement') return `...${renderParameter(ctx, param.argument)}`;
  // Outside the §3.2 grammar (destructuring, TS modifiers): verbatim fallback.
  return ctx.verbatim(param);
}

/** `THROW <expr>` content; a missing argument (unreachable) degrades to `THROW`. */
export function throwContent(ctx: ExtractionContext, expression: Node | null | undefined): string {
  return expression == null ? 'THROW' : `THROW ${ctx.verbatim(expression)}`;
}
