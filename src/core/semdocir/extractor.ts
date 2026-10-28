// src/core/semdocir/extractor.ts — AST → JS-SemDocIR records (spec §2, §4).
//
// Contract (§14.2): input is the AST from core/ast/parse.ts plus the source
// text (required for verbatim extraction, E3); output is the records grouped
// by category, which the assembler renders.
//
// Traversal rules (§1.1, §4.1):
//   - FULL traversal of the admitted tree with FUNCTION frontiers: every
//     nested FunctionDeclaration/FunctionExpression/ArrowFunctionExpression
//     delimits a frontier and is NOT traversed (§4.3-e).
//   - Operation sites (call / `new` / tagged template / `await`) generate
//     CALL/ASYNC records only at the TOP level of an expression (E7).
//   - Zero lexical heuristics (§4.1-4): no rule depends on identifier names.
//
// Determinism (§4.1-1): `order` follows emission order, which follows source
// order; the assembler sorts records within each category by it (E2).
//
// Interpretation decisions (flagged for advisor validation):
//   - A `throw` argument is NEVER decomposed into CALL records (§3.3).
//   - A `return` argument IS decomposed, guarded or not (E4, E7).
//   - `ND external semantics` (§4.4) is DEFERRED to Phase 2: it requires
//     import binding resolution, which an isolated fragment cannot provide.
//
// The rules live in ./rules; this file is the facade that owns the mutable
// state and implements the context those rules receive.

import type {
  AssignmentExpression,
  Comment,
  File,
  Node,
  ReturnStatement,
  Statement,
  VariableDeclaration,
} from '@babel/types';

import { detectUnit, type Unit } from '../ast/filter.ts';
import { BindingTable } from './bindings.ts';
import { expanded as expandNode, expandedReturnedValue as expandReturned } from './expansion.ts';
import type { Category, ExtractorResult, Record } from './model.ts';
import type { ExtractionContext } from './rules/context.ts';
import {
  extractAssignment as runAssignment,
  extractValue as runValue,
  extractVariableDeclaration as runVariableDeclaration,
} from './rules/expressions.ts';
import { renderParameter, throwContent as renderThrow } from './rules/header.ts';
import {
  extractStatement as runStatement,
  extractStatements as runStatements,
} from './rules/statements.ts';
import { SourceView, verbatim as verbatimOf } from './source.ts';

/** Extracts the records of one admitted unit. Single use. */
class Extractor implements ExtractionContext {
  readonly view: SourceView;
  readonly table = new BindingTable();
  private readonly records: Record[] = [];
  private counter = 0;
  private hasThrow = false;

  constructor(source: string, comments: readonly Comment[]) {
    this.view = new SourceView(source, comments);
  }

  extract(unit: Unit): ExtractorResult {
    const params = unit.node.params.map((param) => renderParameter(this, param));
    for (const param of params) this.emit('INPUT', param);

    const body = unit.node.body;
    if (body.type === 'BlockStatement') {
      this.table.register(unit.node, body.body);
      this.extractStatements(body.body);
    } else {
      // Arrow with a concise body: implicit return (§4.3-i).
      this.emit('RET', this.view.slice(body));
      this.extractValue(body);
    }

    return {
      name: unit.name,
      isAsync: unit.isAsync,
      params,
      records: this.records,
      hasThrow: this.hasThrow,
    };
  }

  emit(category: Category, content: string): void {
    this.records.push({ category, content, order: this.counter++ });
  }

  markThrow(): void {
    this.hasThrow = true;
  }

  verbatim(node: Node | null | undefined): string {
    return verbatimOf(this.view, node);
  }

  expanded(node: Node | null | undefined): string {
    return expandNode(this.view, this.table, node);
  }

  destination(target: string | undefined): string {
    return target === undefined ? '' : ` -> ${target}`;
  }

  expandedReturnedValue(statement: ReturnStatement): string {
    return expandReturned(this.view, this.table, statement);
  }

  throwContent(expression: Node | null | undefined): string {
    return renderThrow(this, expression);
  }

  /** Delegates one statement to the rule dispatcher. */
  extractStatement(statement: Node): void {
    runStatement(this, statement);
  }

  extractStatements(statements: readonly Statement[]): void {
    runStatements(this, statements);
  }

  extractValue(expression: Node | null | undefined, target?: string): void {
    runValue(this, expression, target);
  }

  extractAssignment(expression: AssignmentExpression): void {
    runAssignment(this, expression);
  }

  extractVariableDeclaration(statement: VariableDeclaration): void {
    runVariableDeclaration(this, statement);
  }
}

/**
 * Extracts the JS-SemDocIR records of an admitted function unit.
 *
 * @param source - source text of the function (needed for verbatim slices, E3).
 * @param ast - AST returned by parseFunction; must be an admitted unit.
 * @returns header data and the records by category.
 * @throws {Error} if the AST is not a function unit (§1.1) — the filter
 *   (core/ast/filter.ts) must run first.
 */
export function extractFunction(source: string, ast: File): ExtractorResult {
  const unit = detectUnit(ast.program.body);
  if (unit === null) {
    throw new Error('extractFunction: the AST is not a function unit (spec §1.1)');
  }
  return new Extractor(source, ast.comments ?? []).extract(unit);
}

export { CATEGORIES } from './model.ts';
export type { Category, ExtractorResult, Record } from './model.ts';
