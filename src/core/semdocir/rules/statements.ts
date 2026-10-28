// src/core/semdocir/rules/statements.ts — statement dispatch.
//
// The switch is the only place that maps an AST statement to a rule; every
// rule receives the same ExtractionContext.

import type { Node, Statement } from '@babel/types';

import type { ExtractionContext } from './context.ts';
import { extractExpressionStatement, extractVariableDeclaration } from './expressions.ts';
import { extractIf, extractSwitch } from './conditionals.ts';
import { extractReturn } from './header.ts';
import { extractLoop } from './loops.ts';
import { extractThrow, extractTry } from './errors.ts';

export function extractStatements(ctx: ExtractionContext, statements: readonly Statement[]): void {
  for (const statement of statements) extractStatement(ctx, statement);
}

export function extractStatement(ctx: ExtractionContext, statement: Node): void {
  switch (statement.type) {
    case 'BlockStatement':
      extractStatements(ctx, statement.body);
      return;
    case 'ExpressionStatement':
      extractExpressionStatement(ctx, statement.expression);
      return;
    case 'VariableDeclaration':
      extractVariableDeclaration(ctx, statement);
      return;
    case 'IfStatement':
      extractIf(ctx, statement);
      return;
    case 'SwitchStatement':
      extractSwitch(ctx, statement);
      return;
    case 'ForStatement':
    case 'ForInStatement':
    case 'ForOfStatement':
    case 'WhileStatement':
    case 'DoWhileStatement':
      extractLoop(ctx, statement);
      return;
    case 'ReturnStatement':
      extractReturn(ctx, statement);
      return;
    case 'ThrowStatement':
      extractThrow(ctx, statement);
      return;
    case 'BreakStatement':
    case 'ContinueStatement':
      return; // unguarded jumps: governed by COND LOOP (§4.3-c)
    case 'TryStatement':
      extractTry(ctx, statement);
      return;
    case 'LabeledStatement':
      extractStatement(ctx, statement.body);
      return;
    case 'FunctionDeclaration':
      return; // frontier (§1.1, §4.3-e)
    default:
      return; // EmptyStatement/DebuggerStatement; rejected nodes never arrive
  }
}
