// eslint.config.js — flat configuration for ESLint 10 + typescript-eslint + Prettier.
//
// Rules: ESLint core recommended + typescript-eslint recommended, with
// eslint-config-prettier last to disable any stylistic rules that conflict
// with Prettier formatting.

import js from '@eslint/js';
import tseslint from 'typescript-eslint';
import eslintConfigPrettier from 'eslint-config-prettier';

export default tseslint.config(
  {
    ignores: ['node_modules/**', 'dist/**'],
  },
  js.configs.recommended,
  tseslint.configs.recommended,
  eslintConfigPrettier,
);
