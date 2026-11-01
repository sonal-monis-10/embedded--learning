import js from '@eslint/js';
import globals from 'globals';
import prettier from 'eslint-config-prettier';

export default [
  { ignores: ['node_modules/', 'coverage/'] },
  js.configs.recommended,
  {
    languageOptions: {
      ecmaVersion: 'latest',
      sourceType: 'module',
      globals: globals.node,
    },
    rules: {
      // `_next`, `_req`: unused on purpose (Express decides by position).
      'no-unused-vars': ['error', { argsIgnorePattern: '^_' }],
    },
  },
  // Last: turns off rules that would fight with Prettier's formatting.
  prettier,
];
