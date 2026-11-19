import js from '@eslint/js';
import tseslint from 'typescript-eslint';

export default tseslint.config(
  { ignores: ['node_modules/', 'dist/', 'etl-out/', 'scripts/out/', 'frontend/dist/'] },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    rules: {
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
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
