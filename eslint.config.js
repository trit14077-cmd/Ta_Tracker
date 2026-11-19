import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['**/node_modules/**', '**/dist/**', 'etl-out/', 'scripts/out/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    // Edge Function chạy trên Deno
    files: ['supabase/functions/**/*.ts'],
    languageOptions: { globals: { Deno: 'readonly' } },
  },
  {
    // script chạy bằng Node
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { console: 'readonly', process: 'readonly', URL: 'readonly' } },
  },
  {
    // shared/ là bản chép NGUYÊN VĂN từ OLD/src/shared (IMPLEMENTATION_TASKS quy tắc 3), không sửa để chiều lint.
    // Các quy tắc dưới chỉ là văn phong: regex lọc ký tự điều khiển (cố ý), escape thừa, 1 import type không dùng.
    files: ['shared/**/*.ts'],
    rules: {
      'no-control-regex': 'off',
      'no-useless-escape': 'off',
      '@typescript-eslint/no-unused-vars': 'off',
    },
  },
);
