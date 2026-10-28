// src/core/semdocir/bindings.ts — pure-binding analysis (I-F2.7-01).
//
// A binding is substitutable when its name is bound exactly ONCE in the
// complete function and its single introduction is a top-level pure
// assignment. Pure means: no operation sites, function values, dynamic
// operations or mutations anywhere in the right-hand side (R1).

import { VISITOR_KEYS, type Node, type Statement } from '@babel/types';

import { ABORT, isNode, walk } from '../ast/walk.ts';
import {
  isDynamicUnary,
  isFunctionLikeNode,
  isOperationNode,
  type IdentifierPosition,
} from './model.ts';

/**
 * Collects the names bound by a binding pattern (declarators, assignment
 * targets, catch and function parameters). Used only to COUNT binding events
 * by name, never to substitute (I-F2.7-01).
 *
 * @param pattern - Binding pattern node.
 * @param count - Receives each bound name.
 */
export function collectPatternNames(pattern: Node, count: (name: string) => void): void {
  switch (pattern.type) {
    case 'Identifier':
      count(pattern.name);
      return;
    case 'AssignmentPattern':
      collectPatternNames(pattern.left, count);
      return;
    case 'RestElement':
      collectPatternNames(pattern.argument, count);
      return;
    case 'ArrayPattern':
      for (const element of pattern.elements) {
        if (element !== null) collectPatternNames(element, count);
      }
      return;
    case 'ObjectPattern':
      for (const property of pattern.properties) {
        if (property.type === 'RestElement') collectPatternNames(property, count);
        else if (property.type === 'ObjectProperty') collectPatternNames(property.value, count);
      }
      return;
    default:
      return; // unsupported shapes never parse under the frozen parser config
  }
}

/**
 * A pure right-hand side (R1): no operation sites, function values, dynamic
 * operations, mutations, or nested assignments anywhere inside.
 */
export function isPureRhs(node: Node): boolean {
  let pure = true;
  walk(node, (current) => {
    if (
      isOperationNode(current) ||
      isFunctionLikeNode(current) ||
      isDynamicUnary(current) ||
      current.type === 'UpdateExpression' ||
      current.type === 'AssignmentExpression' ||
      current.type === 'YieldExpression'
    ) {
      pure = false;
      return ABORT;
    }
    return undefined;
  });
  return pure;
}

/**
 * Collects the free-variable reference positions of `node` in expression
 * context. Skips function frontiers, non-computed member/property keys,
 * shorthand object values, and assignment/update targets, which are never
 * substitutable references.
 */
export function collectReferencePositions(node: Node, out: IdentifierPosition[]): void {
  if (isFunctionLikeNode(node)) return;
  switch (node.type) {
    case 'Identifier': {
      if (typeof node.start === 'number' && typeof node.end === 'number') {
        out.push({ name: node.name, start: node.start, end: node.end });
      }
      return;
    }
    case 'MemberExpression':
    case 'OptionalMemberExpression': {
      collectReferencePositions(node.object, out);
      if (node.computed) collectReferencePositions(node.property, out);
      return;
    }
    case 'ObjectProperty': {
      if (node.computed) collectReferencePositions(node.key, out);
      if (!node.shorthand) collectReferencePositions(node.value, out);
      return;
    }
    case 'AssignmentExpression': {
      collectReferencePositions(node.right, out);
      return; // the left side is an assignment target, not a reference
    }
    case 'UpdateExpression':
      return; // the argument is a mutation target, not a reference
    default: {
      const record = node as unknown as { [key: string]: unknown };
      for (const key of VISITOR_KEYS[node.type] ?? []) {
        const child = record[key];
        if (Array.isArray(child)) {
          for (const entry of child) {
            if (isNode(entry)) collectReferencePositions(entry, out);
          }
        } else if (isNode(child)) {
          collectReferencePositions(child, out);
        }
      }
    }
  }
}

/** Binding-event counts and substitutable assignments of one function. */
export class BindingTable {
  /** Binding-event counts by name across the COMPLETE function (I-F2.7-01). */
  private readonly counts = new Map<string, number>();
  /** Substitutable pure single assignments: name → right-hand side node. */
  private readonly pure = new Map<string, Node>();

  /**
   * Registers the substitutable pure bindings of the function body: names
   * bound exactly once in the COMPLETE function (counted across nested
   * functions for safety) whose single introduction is a top-level pure
   * assignment.
   */
  register(functionNode: Node, statements: readonly Statement[]): void {
    this.countEvents(functionNode);

    const candidates: Array<{ name: string; rhs: Node; index: number }> = [];
    statements.forEach((statement, index) => {
      if (statement.type === 'VariableDeclaration' && statement.declarations.length === 1) {
        const declarator = statement.declarations[0];
        if (
          declarator !== undefined &&
          declarator.id.type === 'Identifier' &&
          declarator.init != null &&
          isPureRhs(declarator.init)
        ) {
          candidates.push({ name: declarator.id.name, rhs: declarator.init, index });
        }
        return;
      }
      if (
        statement.type === 'ExpressionStatement' &&
        statement.expression.type === 'AssignmentExpression' &&
        statement.expression.operator === '=' &&
        statement.expression.left.type === 'Identifier' &&
        isPureRhs(statement.expression.right)
      ) {
        candidates.push({
          name: statement.expression.left.name,
          rhs: statement.expression.right,
          index,
        });
      }
    });

    // Cycle safety (R2): a candidate whose right-hand side references itself
    // or a LATER candidate is rejected. Every cyclic reference chain contains
    // such an edge, so no substitution can recurse forever.
    const indexByName = new Map(candidates.map((candidate) => [candidate.name, candidate.index]));
    const accepted = candidates.filter((candidate) => {
      const positions: IdentifierPosition[] = [];
      collectReferencePositions(candidate.rhs, positions);
      return !positions.some(
        (position) => (indexByName.get(position.name) ?? -1) >= candidate.index,
      );
    });

    for (const { name, rhs } of accepted) {
      if (this.counts.get(name) === 1) this.pure.set(name, rhs);
    }
  }

  /** Whether `name` resolves to a substitutable pure binding. */
  has(name: string): boolean {
    return this.pure.has(name);
  }

  /** Right-hand side of a substitutable binding. */
  get(name: string): Node | undefined {
    return this.pure.get(name);
  }

  /** Counts every binding event by name across the complete function subtree. */
  private countEvents(functionNode: Node): void {
    const bump = (name: string): void => {
      this.counts.set(name, (this.counts.get(name) ?? 0) + 1);
    };

    walk(functionNode, (node) => {
      switch (node.type) {
        case 'VariableDeclarator':
          collectPatternNames(node.id, bump);
          return undefined;
        case 'AssignmentExpression':
          collectPatternNames(node.left, bump);
          return undefined;
        case 'UpdateExpression':
          if (node.argument.type === 'Identifier') bump(node.argument.name);
          return undefined;
        case 'CatchClause':
          if (node.param != null) collectPatternNames(node.param, bump);
          return undefined;
        case 'ForInStatement':
        case 'ForOfStatement':
          if (node.left.type !== 'VariableDeclaration') collectPatternNames(node.left, bump);
          return undefined;
        default:
          if (isFunctionLikeNode(node)) {
            for (const param of node.params) collectPatternNames(param, bump);
          }
          return undefined;
      }
    });
  }
}
