import eslint from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['dist/**', 'node_modules/**', 'packages/adapters/abis/**'] },
  eslint.configs.recommended,
  ...tseslint.configs.recommendedTypeChecked,
  {
    languageOptions: {
      parserOptions: { projectService: true, tsconfigRootDir: import.meta.dirname },
    },
    rules: {
      '@typescript-eslint/no-explicit-any': 'off',
      '@typescript-eslint/no-non-null-assertion': 'off',
      '@typescript-eslint/require-await': 'off',
    },
  },
  {
    files: ['**/*.mjs', '**/*.cjs', 'eslint.config.js'],
    extends: [tseslint.configs.disableTypeChecked],
    languageOptions: {
      globals: {
        console: 'readonly',
        process: 'readonly',
        URL: 'readonly',
        module: 'readonly',
        setTimeout: 'readonly',
        fetch: 'readonly',
      },
    },
  },
  {
    files: ['tests/**/*.ts'],
    rules: { '@typescript-eslint/no-floating-promises': 'off' },
  },
);
