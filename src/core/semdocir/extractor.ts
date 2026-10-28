// src/extractor.ts — AST → JS-SemDocIR records (spec §2, §4).
//
// Contract (especificacion_propuesta.md §14.2):
//   Input:  AST (JSON) from src/parse.ts, plus the source text — required for
//           verbatim extraction (E3): every record content is a source slice.
//   Output: records by category (the assembler renders the instance text).
//
// Traversal rules (spec §1.1, §4.1):
//   - FULL traversal of the admitted tree with FUNCTION frontiers: every
//     nested FunctionDeclaration/FunctionExpression/ArrowFunctionExpression
//     delimits a frontier and is NOT traversed (§4.3-e). A later call to a
//     locally defined function is registered as a normal CALL.
//   - Operation sites (call / `new` / tagged template / `await`) generate
//     CALL/ASYNC records only at the TOP level of an expression (E7); sites
//     nested inside another site stay verbatim (§4.3-d, E4).
//   - Zero lexical heuristics (§4.1-4): no rule depends on identifier names.
//
// Determinism (§4.1-1): same function → same records. `order` is a
// monotonically increasing counter that follows emission order, which follows
// source order; the assembler sorts records within each category by it (E2).
//
// Interpretation decisions (flagged for advisor validation):
//   - A `throw` argument is NEVER decomposed into CALL records: the frozen
//     canonical instance of getUser (§3.3) registers no CALL for
//     `new Error("id is required")` under `COND !id -> THROW ...`.
//   - A `return` argument IS decomposed, guarded or not (E4: a call may appear
//     in CALL and RET at once; E7: all top-level calls). This keeps `CALL
//     NONE` truthful when the only call of a function is a guarded return.
//   - `ND external semantics` (§4.4) is DEFERRED to Phase 2: it requires
//     import binding resolution, which an isolated fragment cannot provide.

import {
  VISITOR_KEYS,
  type ArrowFunctionExpression,
  type AssignmentExpression,
  type AwaitExpression,
  type BreakStatement,
  type CallExpression,
  type CatchClause,
  type ClassMethod,
  type ClassPrivateMethod,
  type Comment,
  type ContinueStatement,
  type DoWhileStatement,
  type File,
  type ForInStatement,
  type ForOfStatement,
  type ForStatement,
  type FunctionDeclaration,
  type FunctionExpression,
  type IfStatement,
  type NewExpression,
  type Node,
  type ObjectMethod,
  type OptionalCallExpression,
  type ReturnStatement,
  type Statement,
  type SwitchStatement,
  type TaggedTemplateExpression,
  type ThrowStatement,
  type TryStatement,
  type UnaryExpression,
  type VariableDeclaration,
  type VariableDeclarator,
  type WhileStatement,
} from '@babel/types';

import { ABORT, isNode, walk } from '../ast/walk.ts';
import { detectUnit, type Unit } from '../ast/filter.ts';

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
type FunctionNode = FunctionDeclaration | FunctionExpression | ArrowFunctionExpression;

/** Operation sites that generate CALL/ASYNC records (§4.2, E7). */
type OperationNode =
  | AwaitExpression
  | CallExpression
  | NewExpression
  | OptionalCallExpression
  | TaggedTemplateExpression;

/** Direct effects that can carry a guard (§2.2, §4.2). */
type DirectEffectNode = BreakStatement | ContinueStatement | ReturnStatement | ThrowStatement;

/** Loop statements rendered as `COND LOOP <header>` (§4.2, E6). */
type LoopNode = DoWhileStatement | ForInStatement | ForOfStatement | ForStatement | WhileStatement;

/** Function-like nodes: traversal frontiers for binding analysis (I-F2.7-01). */
type FunctionLikeAll = FunctionNode | ObjectMethod | ClassMethod | ClassPrivateMethod;

function isFunctionNode(node: Node): node is FunctionNode {
  return (
    node.type === 'FunctionDeclaration' ||
    node.type === 'FunctionExpression' ||
    node.type === 'ArrowFunctionExpression'
  );
}

function isFunctionLikeNode(node: Node): node is FunctionLikeAll {
  return (
    isFunctionNode(node) ||
    node.type === 'ObjectMethod' ||
    node.type === 'ClassMethod' ||
    node.type === 'ClassPrivateMethod'
  );
}

function isOperationNode(node: Node): node is OperationNode {
  return (
    node.type === 'AwaitExpression' ||
    node.type === 'CallExpression' ||
    node.type === 'NewExpression' ||
    node.type === 'OptionalCallExpression' ||
    node.type === 'TaggedTemplateExpression'
  );
}

function isDirectEffect(node: Node): node is DirectEffectNode {
  return (
    node.type === 'BreakStatement' ||
    node.type === 'ContinueStatement' ||
    node.type === 'ReturnStatement' ||
    node.type === 'ThrowStatement'
  );
}

/** `typeof`/`delete` applied to a non-literal operand is a dynamic operation (§4.4). */
function isDynamicUnary(node: Node): node is UnaryExpression {
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
function isDestructuring(node: Node): boolean {
  return node.type === 'ArrayPattern' || node.type === 'ObjectPattern';
}

/** Maximum nesting of substitutions; a safety guard, not a semantic limit. */
const MAX_EXPANSION_DEPTH = 32;

/** A free-variable reference position used by expression expansion (I-F2.7-01). */
interface IdentifierPosition {
  name: string;
  start: number;
  end: number;
}

/**
 * Collects the names bound by a binding pattern (declarators, assignment
 * targets, catch and function parameters). Used only to COUNT binding events
 * by name, never to substitute (I-F2.7-01).
 *
 * @param pattern - Binding pattern node.
 * @param count - Receives each bound name.
 */
function collectPatternNames(pattern: Node, count: (name: string) => void): void {
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

/** Collapses runs of whitespace to one space and trims (E3). */
function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}

/**
 * Replaces every comment character with a space, preserving offsets so AST
 * slices stay valid. Newlines inside comments become spaces; they normalize
 * away like any other whitespace.
 */
function blankComments(source: string, comments: readonly Comment[]): string {
  if (comments.length === 0) return source;
  const chars = [...source];
  for (const comment of comments) {
    if (comment.start == null || comment.end == null) continue;
    for (let index = comment.start; index < comment.end; index++) chars[index] = ' ';
  }
  return chars.join('');
}

/**
 * Verbatim view of the source (E3): comments removed, whitespace runs
 * normalized to one space, no line breaks.
 *
 * Limitation (documented): a comment written with no surrounding whitespace
 * between two tokens leaves one space where there was none (the blanked
 * characters normalize like any other whitespace).
 */
class SourceView {
  private readonly clean: string;

  constructor(source: string, comments: readonly Comment[]) {
    this.clean = blankComments(source, comments);
  }

  /** Verbatim source text of `node`. */
  slice(node: Node): string {
    if (node.start == null || node.end == null) return '';
    return normalize(this.clean.slice(node.start, node.end));
  }

  /** Normalized source text between two character offsets. */
  span(start: number, end: number): string {
    return normalize(this.clean.slice(start, end));
  }

  /** Un-normalized text between two character offsets (comments blanked). */
  raw(start: number, end: number): string {
    return this.clean.slice(start, end);
  }
}

/** Extracts the records of one admitted unit. Single use. */
class Extractor {
  private readonly view: SourceView;
  private readonly records: Record[] = [];
  private counter = 0;
  private hasThrow = false;
  /** Binding-event counts by name across the COMPLETE function (I-F2.7-01). */
  private readonly bindingCounts = new Map<string, number>();
  /** Substitutable pure single assignments: name → right-hand side node. */
  private readonly pureBindings = new Map<string, Node>();

  constructor(source: string, comments: readonly Comment[]) {
    this.view = new SourceView(source, comments);
  }

  extract(unit: Unit): ExtractorResult {
    const params = unit.node.params.map((param) => this.renderParameter(param));
    for (const param of params) this.emit('INPUT', param);

    const body = unit.node.body;
    if (body.type === 'BlockStatement') {
      this.registerBindings(unit.node, body.body);
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

  // ---------------------------------------------------------------------------
  // Emission
  // ---------------------------------------------------------------------------

  private emit(category: Category, content: string): void {
    this.records.push({ category, content, order: this.counter++ });
  }

  /**
   * Verbatim source text; a nullish node (unreachable) yields an empty string.
   * A `new` expression renders WITHOUT the `new` keyword: the frozen canonical
   * instance of getUser (§3.3) renders `throw new Error(...)` as
   * `THROW Error("id is required")`.
   */
  private verbatim(node: Node | null | undefined): string {
    if (node == null) return '';
    if (node.type === 'NewExpression' && node.callee.start != null && node.end != null) {
      return this.view.span(node.callee.start, node.end);
    }
    return this.view.slice(node);
  }

  private destination(target: string | undefined): string {
    return target === undefined ? '' : ` -> ${target}`;
  }

  // ---------------------------------------------------------------------------
  // Statements
  // ---------------------------------------------------------------------------

  private extractStatements(statements: readonly Statement[]): void {
    for (const statement of statements) this.extractStatement(statement);
  }

  private extractStatement(statement: Node): void {
    switch (statement.type) {
      case 'BlockStatement':
        this.extractStatements(statement.body);
        return;
      case 'ExpressionStatement':
        this.extractExpressionStatement(statement.expression);
        return;
      case 'VariableDeclaration':
        this.extractVariableDeclaration(statement);
        return;
      case 'IfStatement':
        this.extractIf(statement);
        return;
      case 'SwitchStatement':
        this.extractSwitch(statement);
        return;
      case 'ForStatement':
      case 'ForInStatement':
      case 'ForOfStatement':
      case 'WhileStatement':
      case 'DoWhileStatement':
        this.extractLoop(statement);
        return;
      case 'ReturnStatement':
        this.extractReturn(statement);
        return;
      case 'ThrowStatement':
        this.extractThrow(statement);
        return;
      case 'BreakStatement':
      case 'ContinueStatement':
        return; // unguarded jumps: governed by COND LOOP (§4.3-c)
      case 'TryStatement':
        this.extractTry(statement);
        return;
      case 'LabeledStatement':
        this.extractStatement(statement.body);
        return;
      case 'FunctionDeclaration':
        return; // frontier (§1.1, §4.3-e)
      default:
        return; // EmptyStatement/DebuggerStatement; rejected nodes never arrive
    }
  }

  // ---------------------------------------------------------------------------
  // Expressions and destinations
  // ---------------------------------------------------------------------------

  /**
   * Extracts an expression that may itself be an operation site (with an
   * optional destination `-> <id>`) or contain nested top-level sites.
   */
  private extractValue(expression: Node | null | undefined, target?: string): void {
    if (expression == null) return;
    if (isOperationNode(expression)) {
      this.emitOperation(expression, target);
      return;
    }
    this.decompose(expression);
  }

  private extractExpressionStatement(expression: Node): void {
    if (expression.type === 'AssignmentExpression') {
      this.extractAssignment(expression);
      return;
    }
    this.extractValue(expression);
  }

  /**
   * `x = call()` produces the destination `-> x` (§4.2); a destructuring
   * target produces an ND record (§4.4); property assignment is outside the
   * v1.0 categories (§4.3-h); `x = 5` produces no record.
   */
  private extractAssignment(expression: AssignmentExpression): void {
    let target: string | undefined;
    if (expression.operator === '=') {
      if (expression.left.type === 'Identifier') {
        target = expression.left.name;
      } else if (isDestructuring(expression.left) && isOperationNode(expression.right)) {
        this.emit('ND', `assignment target: ${this.verbatim(expression.left)}`);
      }
    }
    this.extractValue(expression.right, target);
  }

  private extractVariableDeclaration(statement: VariableDeclaration): void {
    for (const declarator of statement.declarations) this.extractDeclarator(declarator);
  }

  private extractDeclarator(declarator: VariableDeclarator): void {
    const { id, init } = declarator;
    if (init == null) return; // `let x;` — nothing to extract
    if (id.type === 'Identifier') {
      this.extractValue(init, id.name);
      return;
    }
    if (isOperationNode(init)) {
      this.emit('ND', `assignment target: ${this.verbatim(id)}`);
    }
    this.extractValue(init);
  }

  /**
   * Decomposes nested top-level operation sites inside a non-operation
   * expression (E7). Sites nested inside another site stay verbatim (§4.3-d),
   * functions are frontiers (§4.3-e) and `typeof`/`delete` register ND (§4.4).
   */
  private decompose(expression: Node): void {
    walk(expression, (node) => {
      if (isFunctionNode(node)) return false;
      if (isOperationNode(node)) {
        this.emitOperation(node); // nested sites carry no destination (§4.2)
        return false;
      }
      if (isDynamicUnary(node)) {
        this.emit('ND', `dynamic operation: ${this.verbatim(node)}`);
        return false;
      }
      return undefined;
    });
  }

  private emitOperation(node: OperationNode, target?: string): void {
    if (node.type === 'AwaitExpression') {
      this.emit('ASYNC', `await ${this.verbatim(node.argument)}${this.destination(target)}`);
      // E4 duplication: the awaited call is also a call site.
      if (isOperationNode(node.argument)) this.emitOperation(node.argument, target);
      return;
    }
    this.emit('CALL', `${this.expanded(node)}${this.destination(target)}`);
    this.emitCalleeNonDeterminability(node);
  }

  /**
   * §4.4: a `this` receiver and a computed callee make the call target
   * non-determinable. Both facts are registered when they co-occur.
   */
  private emitCalleeNonDeterminability(
    node: CallExpression | NewExpression | OptionalCallExpression | TaggedTemplateExpression,
  ): void {
    const callee = node.type === 'TaggedTemplateExpression' ? node.tag : node.callee;
    if (callee.type !== 'MemberExpression' && callee.type !== 'OptionalMemberExpression') return;
    if (callee.object.type === 'ThisExpression') {
      this.emit('ND', 'receiver is calling-context dependent: this');
    }
    if (callee.computed) {
      this.emit('ND', `callee not statically resolvable: ${this.verbatim(callee)}`);
    }
  }

  // ---------------------------------------------------------------------------
  // Expression expansion (I-F2.7-01)
  // ---------------------------------------------------------------------------

  /**
   * Registers the substitutable pure bindings of the function body: names
   * bound exactly once in the COMPLETE function (counted across nested
   * functions for safety) whose single introduction is a top-level pure
   * assignment. Pure means no operation sites, function values, dynamic
   * operations, or mutations anywhere in the right-hand side (R1).
   */
  private registerBindings(functionNode: Node, statements: readonly Statement[]): void {
    this.countBindingEvents(functionNode);

    const candidates: Array<{ name: string; rhs: Node; index: number }> = [];
    statements.forEach((statement, index) => {
      if (statement.type === 'VariableDeclaration' && statement.declarations.length === 1) {
        const declarator = statement.declarations[0];
        if (
          declarator !== undefined &&
          declarator.id.type === 'Identifier' &&
          declarator.init != null &&
          this.isPureRhs(declarator.init)
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
        this.isPureRhs(statement.expression.right)
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
      this.collectReferencePositions(candidate.rhs, positions);
      return !positions.some(
        (position) => (indexByName.get(position.name) ?? -1) >= candidate.index,
      );
    });

    for (const { name, rhs } of accepted) {
      if (this.bindingCounts.get(name) === 1) this.pureBindings.set(name, rhs);
    }
  }

  /** Counts every binding event by name across the complete function subtree. */
  private countBindingEvents(functionNode: Node): void {
    const bump = (name: string): void => {
      this.bindingCounts.set(name, (this.bindingCounts.get(name) ?? 0) + 1);
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

  /**
   * A pure right-hand side (R1): no operation sites, function values, dynamic
   * operations, mutations, or nested assignments anywhere inside.
   */
  private isPureRhs(node: Node): boolean {
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
  private collectReferencePositions(node: Node, out: IdentifierPosition[]): void {
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
        this.collectReferencePositions(node.object, out);
        if (node.computed) this.collectReferencePositions(node.property, out);
        return;
      }
      case 'ObjectProperty': {
        if (node.computed) this.collectReferencePositions(node.key, out);
        if (!node.shorthand) this.collectReferencePositions(node.value, out);
        return;
      }
      case 'AssignmentExpression': {
        this.collectReferencePositions(node.right, out);
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
              if (isNode(entry)) this.collectReferencePositions(entry, out);
            }
          } else if (isNode(child)) {
            this.collectReferencePositions(child, out);
          }
        }
      }
    }
  }

  /**
   * Expanded rendering for RET/CALL/COND records (I-F2.7-01): like `verbatim`,
   * but each free reference to a registered pure binding is replaced by its
   * own expanded rendering wrapped in parentheses. Substitution recurses
   * until no registered variable remains (R2), with a depth guard.
   */
  private expanded(node: Node | null | undefined, depth = 0): string {
    if (node == null) return '';
    if (depth >= MAX_EXPANSION_DEPTH) return this.verbatim(node);

    if (node.type === 'Identifier' && this.pureBindings.has(node.name)) {
      return this.expanded(this.pureBindings.get(node.name), depth + 1);
    }

    let baseStart = node.start;
    const baseEnd = node.end;
    if (node.type === 'NewExpression' && node.callee.start != null && node.end != null) {
      baseStart = node.callee.start;
    }
    if (baseStart == null || baseEnd == null) return this.verbatim(node);

    const positions: IdentifierPosition[] = [];
    this.collectReferencePositions(node, positions);
    const occurrences = positions.filter(
      (position) =>
        position.start >= baseStart &&
        position.end <= baseEnd &&
        this.pureBindings.has(position.name),
    );
    if (occurrences.length === 0) return this.view.span(baseStart, baseEnd);

    occurrences.sort((left, right) => left.start - right.start);
    let text = '';
    let cursor = baseStart;
    for (const occurrence of occurrences) {
      if (occurrence.start < cursor) continue; // defensive: skip overlaps
      text += this.view.raw(cursor, occurrence.start);
      text += `(${this.expanded(this.pureBindings.get(occurrence.name), depth + 1)})`;
      cursor = occurrence.end;
    }
    text += this.view.raw(cursor, baseEnd);
    return normalize(text);
  }

  /**
   * Returned value with expression expansion (I-F2.7-01), for RET records and
   * the `-> RET` value inside COND records.
   */
  private expandedReturnedValue(statement: ReturnStatement): string {
    return statement.argument == null ? 'undefined' : this.expanded(statement.argument);
  }

  // ---------------------------------------------------------------------------
  // Conditionals (E5)
  // ---------------------------------------------------------------------------

  private extractIf(statement: IfStatement): void {
    const test = this.expanded(statement.test);
    this.extractValue(statement.test); // E7: top-level calls in the condition
    this.extractBranch(statement.consequent, test);
    const alternate = statement.alternate;
    if (alternate == null) return;
    if (alternate.type === 'IfStatement') {
      this.extractIf(alternate); // elif: nested if (§4.2)
      return;
    }
    this.extractBranch(alternate, `!(${test})`); // negated guard (§4.3-b)
  }

  /**
   * Applies `guard` to the branch's DIRECT effects; every other statement is
   * extracted without the guard (§4.2, §4.3-a).
   */
  private extractBranch(branch: Node, guard: string): void {
    if (branch.type === 'BlockStatement') {
      for (const inner of branch.body) {
        if (isDirectEffect(inner)) this.emitGuardedEffect(inner, guard);
        else this.extractStatement(inner);
      }
      return;
    }
    if (isDirectEffect(branch)) {
      this.emitGuardedEffect(branch, guard);
      return;
    }
    this.extractStatement(branch);
  }

  private emitGuardedEffect(effect: DirectEffectNode, guard: string): void {
    switch (effect.type) {
      case 'ReturnStatement': {
        this.emit('COND', `${guard} -> RET ${this.expandedReturnedValue(effect)}`);
        // E4/E7: a returned call is also a call site, guarded or not.
        if (effect.argument != null) this.extractValue(effect.argument);
        return;
      }
      case 'ThrowStatement':
        // The thrown expression stays verbatim-only: the frozen canonical
        // getUser instance (§3.3) registers no CALL for `new Error(...)`.
        this.hasThrow = true;
        this.emit('COND', `${guard} -> ${this.throwContent(effect.argument)}`);
        return;
      case 'BreakStatement':
        if (effect.label !== null) return; // labeled jumps: not registered (§1.2)
        this.emit('COND', `${guard} -> BREAK`);
        return;
      case 'ContinueStatement':
        if (effect.label !== null) return;
        this.emit('COND', `${guard} -> CONTINUE`);
        return;
    }
  }

  private extractSwitch(statement: SwitchStatement): void {
    this.emit('COND', `switch(${this.expanded(statement.discriminant)})`);
    this.extractValue(statement.discriminant);
    for (const caseClause of statement.cases) {
      const guard = caseClause.test == null ? 'default' : `case ${this.expanded(caseClause.test)}`;
      for (const inner of caseClause.consequent) {
        if (isDirectEffect(inner)) this.emitGuardedEffect(inner, guard);
        else this.extractStatement(inner);
      }
    }
  }

  // ---------------------------------------------------------------------------
  // Loops (E6)
  // ---------------------------------------------------------------------------

  private extractLoop(statement: LoopNode): void {
    this.emit('COND', `LOOP ${this.loopHeader(statement)}`);
    this.extractLoopOperands(statement);
    if (statement.body.type === 'BlockStatement') {
      this.extractStatements(statement.body.body);
    } else {
      this.extractStatement(statement.body);
    }
  }

  /** Decomposes top-level calls in the loop's own expressions (E7). */
  private extractLoopOperands(statement: LoopNode): void {
    switch (statement.type) {
      case 'ForStatement': {
        const { init, test, update } = statement;
        if (init != null) {
          if (init.type === 'VariableDeclaration') this.extractVariableDeclaration(init);
          else if (init.type === 'AssignmentExpression') this.extractAssignment(init);
          else this.extractValue(init);
        }
        if (test != null) this.extractValue(test);
        if (update != null) this.extractValue(update);
        return;
      }
      case 'ForInStatement':
      case 'ForOfStatement':
        this.extractValue(statement.right);
        return;
      case 'WhileStatement':
      case 'DoWhileStatement':
        this.extractValue(statement.test);
        return;
    }
  }

  /**
   * Verbatim loop header (E6): the fragment from the keyword to the closing
   * parenthesis. `do…while` renders as `do while (<test>)` because its header
   * spans two source fragments around the body.
   */
  private loopHeader(statement: LoopNode): string {
    if (statement.type === 'DoWhileStatement') {
      const { body, end } = statement;
      if (body.end == null || end == null) return 'do';
      return `do ${this.view.span(body.end, end).replace(/;$/, '')}`;
    }
    if (statement.start == null || statement.body.start == null) return '';
    return this.view.span(statement.start, statement.body.start);
  }

  // ---------------------------------------------------------------------------
  // Return, throw, try
  // ---------------------------------------------------------------------------

  private extractReturn(statement: ReturnStatement): void {
    this.emit('RET', this.expandedReturnedValue(statement));
    if (statement.argument != null) this.extractValue(statement.argument);
  }

  private extractThrow(statement: ThrowStatement): void {
    this.hasThrow = true;
    this.emit('ERR', this.throwContent(statement.argument));
    // Verbatim-only, like guarded throws (see emitGuardedEffect).
  }

  private extractTry(statement: TryStatement): void {
    this.extractStatements(statement.block.body);
    if (statement.handler != null) this.extractCatchClause(statement.handler);
    if (statement.finalizer != null) this.extractStatements(statement.finalizer.body);
  }

  /**
   * One handler record per catch clause (§4.2):
   * `ERR CATCH (<param>) -> <efectoCatch>`, `EMPTY` when the body is empty.
   * A single-statement handler whose statement is a plain effect is consumed
   * into the record (canonical `ERR CATCH (e) -> RET []`); any other body is
   * extracted normally and summarized as `EMPTY` (documented simplification).
   */
  private extractCatchClause(clause: CatchClause): void {
    const parameter = clause.param == null ? '' : this.catchParameter(clause.param);
    const body = clause.body.body;
    let consumed = false;
    let effect = 'EMPTY';
    if (body.length === 1) {
      const single = this.catchEffect(body[0]);
      if (single !== null) {
        effect = single;
        consumed = true;
      }
    }
    this.emit('ERR', `CATCH (${parameter}) -> ${effect}`);
    if (!consumed) this.extractStatements(body);
  }

  /**
   * Maps a handler statement to its `<efectoCatch>` (§3.2), or `null` when the
   * statement is not a plain effect (then it is extracted normally, so an
   * `await` inside a handler keeps its ASYNC record).
   */
  private catchEffect(statement: Node): string | null {
    if (statement.type === 'ReturnStatement') {
      return `RET ${this.returnedValue(statement)}`;
    }
    if (statement.type === 'ThrowStatement') {
      this.hasThrow = true;
      return this.throwContent(statement.argument);
    }
    if (statement.type === 'ExpressionStatement') {
      const expression = statement.expression;
      if (
        expression.type === 'CallExpression' ||
        expression.type === 'NewExpression' ||
        expression.type === 'OptionalCallExpression' ||
        expression.type === 'TaggedTemplateExpression'
      ) {
        return `CALL ${this.verbatim(expression)}`;
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

  private catchParameter(param: Node): string {
    return param.type === 'Identifier' ? param.name : this.verbatim(param);
  }

  // ---------------------------------------------------------------------------
  // Header
  // ---------------------------------------------------------------------------

  /** Renders one parameter for the header and its INPUT record (§3.2). */
  private renderParameter(param: Node): string {
    if (param.type === 'Identifier') return param.name;
    if (param.type === 'AssignmentPattern') {
      return `${this.renderParameter(param.left)} = ${this.verbatim(param.right)}`;
    }
    if (param.type === 'RestElement') return `...${this.renderParameter(param.argument)}`;
    // Outside the §3.2 grammar (destructuring, TS modifiers): verbatim fallback.
    return this.verbatim(param);
  }

  /** `THROW <expr>` content; a missing argument (unreachable) degrades to `THROW`. */
  private throwContent(expression: Node | null | undefined): string {
    return expression == null ? 'THROW' : `THROW ${this.verbatim(expression)}`;
  }

  /**
   * Returned value WITHOUT expansion. Used only for the consumed `RET` inside
   * `ERR CATCH` records: strict R3 of I-F2.7-01 keeps ERR content unexpanded.
   */
  private returnedValue(statement: ReturnStatement): string {
    return statement.argument == null ? 'undefined' : this.verbatim(statement.argument);
  }
}

/**
 * Extracts the JS-SemDocIR records of an admitted function unit.
 *
 * @param source - source text of the function (needed for verbatim slices, E3).
 * @param ast - AST returned by parseFunction; must be an admitted unit.
 * @returns header data and the records by category.
 * @throws {Error} if the AST is not a function unit (§1.1) — the filter
 *   (src/filter.ts) must run first.
 */
export function extractFunction(source: string, ast: File): ExtractorResult {
  const unit = detectUnit(ast.program.body);
  if (unit === null) {
    throw new Error('extractFunction: the AST is not a function unit (spec §1.1)');
  }
  return new Extractor(source, ast.comments ?? []).extract(unit);
}
