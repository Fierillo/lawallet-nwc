import { defineConfig } from 'vitest/config'
import path from 'node:path'
export default defineConfig({
  resolve: { alias: { '@': path.resolve(__dirname, '.') } },
  test: {
    name: 'database',
    environment: 'node',
    include: ['tests/database/**/*.test.ts', 'tests/database/**/*.test.tsx'],
    fileParallelism: false
  }
})
