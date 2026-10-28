// src/core/semdocir/rules/context.ts — capabilities a rule may use.
//
// Rules are plain functions over this interface: they never import the
// Extractor class, so the dispatcher can live above them without a cycle.

import type {
  AssignmentExpression,
  Node,
  ReturnStatement,
  Statement,
  VariableDeclaration,
} from '@babel/types';

import type { Category } from '../model.ts';
import type { SourceView } from '../source.ts';

export interface ExtractionContext {
  readonly view: SourceView;

  emit(category: Category, content: string): void;
  /** Records that a `throw` exists in the unit (§2.3). */
  markThrow(): void;

  verbatim(node: Node | null | undefined): string;
  expanded(node: Node | null | undefined): string;
  destination(target: string | undefined): string;
  expandedReturnedValue(statement: ReturnStatement): string;
  throwContent(expression: Node | null | undefined): string;

  extractStatement(statement: Node): void;
  extractStatements(statements: readonly Statement[]): void;
  extractValue(expression: Node | null | undefined, target?: string): void;
  extractAssignment(expression: AssignmentExpression): void;
  extractVariableDeclaration(statement: VariableDeclaration): void;
}
