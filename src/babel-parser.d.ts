// Ambient type declaration for `@babel/parser`.
//
// @babel/parser 8.0.7 ships no TypeScript declarations of its own, and
// `@types/babel__parser` targets Babel 7 (whose `Literal` node no longer
// exists in Babel 8). This minimal declaration types exactly the surface the
// project uses, backed by the correct Babel 8 node types from `@babel/types`.

declare module '@babel/parser' {
  import type { File } from '@babel/types';

  export interface ParserOptions {
    sourceType?: 'script' | 'module' | 'unambiguous';
    errorRecovery?: boolean;
    plugins?: string[];
  }

  export function parse(input: string, options?: ParserOptions): File;
}
