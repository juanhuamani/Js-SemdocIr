// src/core/semdocir/rules/conditionals.ts — `if`/`else`/`switch` guards (E5).

import type { IfStatement, Node, SwitchStatement } from '@babel/types';

import { isDirectEffect, type DirectEffectNode } from '../model.ts';
import type { ExtractionContext } from './context.ts';
import { extractValue } from './expressions.ts';

export function extractIf(ctx: ExtractionContext, statement: IfStatement): void {
  const test = ctx.expanded(statement.test);
  extractValue(ctx, statement.test); // E7: top-level calls in the condition
  extractBranch(ctx, statement.consequent, test);
  const alternate = statement.alternate;
  if (alternate == null) return;
  if (alternate.type === 'IfStatement') {
    extractIf(ctx, alternate); // elif: nested if (§4.2)
    return;
  }
  extractBranch(ctx, alternate, `!(${test})`); // negated guard (§4.3-b)
}

/**
 * Applies `guard` to the branch's DIRECT effects; every other statement is
 * extracted without the guard (§4.2, §4.3-a).
 */
export function extractBranch(ctx: ExtractionContext, branch: Node, guard: string): void {
  if (branch.type === 'BlockStatement') {
    for (const inner of branch.body) {
      if (isDirectEffect(inner)) emitGuardedEffect(ctx, inner, guard);
      else ctx.extractStatement(inner);
    }
    return;
  }
  if (isDirectEffect(branch)) {
    emitGuardedEffect(ctx, branch, guard);
    return;
  }
  ctx.extractStatement(branch);
}

export function emitGuardedEffect(
  ctx: ExtractionContext,
  effect: DirectEffectNode,
  guard: string,
): void {
  switch (effect.type) {
    case 'ReturnStatement': {
      ctx.emit('COND', `${guard} -> RET ${ctx.expandedReturnedValue(effect)}`);
      // E4/E7: a returned call is also a call site, guarded or not.
      if (effect.argument != null) extractValue(ctx, effect.argument);
      return;
    }
    case 'ThrowStatement':
      // The thrown expression stays verbatim-only: the frozen canonical
      // getUser instance (§3.3) registers no CALL for `new Error(...)`.
      ctx.markThrow();
      ctx.emit('COND', `${guard} -> ${ctx.throwContent(effect.argument)}`);
      return;
    case 'BreakStatement':
      if (effect.label !== null) return; // labeled jumps: not registered (§1.2)
      ctx.emit('COND', `${guard} -> BREAK`);
      return;
    case 'ContinueStatement':
      if (effect.label !== null) return;
      ctx.emit('COND', `${guard} -> CONTINUE`);
      return;
  }
}

export function extractSwitch(ctx: ExtractionContext, statement: SwitchStatement): void {
  ctx.emit('COND', `switch(${ctx.expanded(statement.discriminant)})`);
  extractValue(ctx, statement.discriminant);
  for (const caseClause of statement.cases) {
    const guard = caseClause.test == null ? 'default' : `case ${ctx.expanded(caseClause.test)}`;
    for (const inner of caseClause.consequent) {
      if (isDirectEffect(inner)) emitGuardedEffect(ctx, inner, guard);
      else ctx.extractStatement(inner);
    }
  }
}
