// src/parse.ts — wrapper around the syntax parser (spec §1.2, §14.2).
//
// Contract (especificacion_propuesta.md §14.2):
//   Input:  source text of a JavaScript function (isolated fragment).
//   Output: AST (JSON) in the ESTree family, produced by @babel/parser.
//
// The parser version is FROZEN in package.json (exact dependency, no caret)
// and mirrored in PARSER_VERSION for traceability. Any version change is a
// new entry in the decisions log.

import { parse as babelParse } from '@babel/parser';
import type { File } from '@babel/types';

/**
 * Frozen parser version. Must match the exact dependency in package.json.
 * Mirrored here so it can be recorded in reports without querying the package
 * manager.
 */
export const PARSER_VERSION = '8.0.7';

/**
 * Frozen parser configuration (spec §1.2: latest ECMAScript, WITHOUT JSX,
 * TypeScript or decorator plugins).
 *
 * - `sourceType: 'unambiguous'` lets Babel detect script vs module on the
 *   isolated fragment (CodeXGLUE functions may be plain declarations or
 *   `module.exports` assignments). Detection is rule-based and deterministic.
 * - `errorRecovery: false`: an invalid fragment is a syntax error, never a
 *   partially recovered tree.
 * - `plugins: []`: standard ECMAScript only; JSX/TS/decorator constructs are
 *   out of scope and their rejection is decided by the filter (SF1.2), not by
 *   the parser.
 */
export const PARSER_OPTIONS: Readonly<import('@babel/parser').ParserOptions> = Object.freeze({
  sourceType: 'unambiguous',
  errorRecovery: false,
  plugins: [],
});

/**
 * Parses the source text of a function and returns its AST.
 *
 * @param source - source code of the function (isolated fragment).
 * @returns the AST as a Babel `File` node (JSON-serializable); statements are
 *   in `ast.program.body`.
 * @throws {SyntaxError} if the fragment is not valid JavaScript under the
 *   frozen configuration (explicit error, never a silent failure).
 */
export function parseFunction(source: string): File {
  try {
    return babelParse(source, PARSER_OPTIONS);
  } catch (cause) {
    throw new SyntaxError(`Syntax analysis error: ${(cause as Error).message}`, { cause });
  }
}
