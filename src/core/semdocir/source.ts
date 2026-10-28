// src/core/semdocir/source.ts — verbatim source view (E3).
//
// Every record content is a slice of the original source: comments are
// blanked, whitespace runs collapse to one space, no line breaks survive.

import type { Comment, Node } from '@babel/types';

/** Collapses runs of whitespace to one space and trims (E3). */
export function normalize(text: string): string {
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
export class SourceView {
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

/**
 * Verbatim rendering of a node.
 *
 * A `new` expression renders WITHOUT the `new` keyword: the frozen canonical
 * instance of getUser (§3.3) renders `throw new Error(...)` as
 * `THROW Error("id is required")`.
 */
export function verbatim(view: SourceView, node: Node | null | undefined): string {
  if (node == null) return '';
  if (node.type === 'NewExpression' && node.callee.start != null && node.end != null) {
    return view.span(node.callee.start, node.end);
  }
  return view.slice(node);
}
