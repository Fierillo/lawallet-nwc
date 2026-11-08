import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    projects: [
      {
        extends: true,
        test: {
          name: 'unit',
          setupFiles: ['./tests/setup.ts'],
          include: [
            'tests/unit/**/*.test.ts',
            'tests/unit/**/*.test.tsx',
            'tests/*.test.ts',
            'tests/*.test.tsx'
          ]
        }
      },
      // These retain their explicit per-file Prisma/auth mocks: route contracts,
      // not proof of real SQL persistence. The database project is separate.
      {
        extends: true,
        test: {
          name: 'integration',
          setupFiles: ['./tests/setup.ts'],
          include: ['tests/integration/**/*.test.ts']
        }
      },
      {
        extends: true,
        test: {
          name: 'critical-flows',
          include: [
            'tests/critical-flows/**/*.test.ts',
            'tests/critical-flows/**/*.test.tsx'
          ],
          setupFiles: ['./tests/critical-setup.ts']
        }
      }
    ],
    globals: true,
    environment: 'happy-dom',
    exclude: ['node_modules', '.next', 'dist'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'text-summary', 'html', 'lcov'],
      reportsDirectory: './coverage',
      include: [
        'app/api/**/*.ts',
        'lib/**/*.ts',
        'hooks/**/*.ts',
        'hooks/**/*.tsx'
      ],
      exclude: [
        'node_modules',
        'tests',
        'mocks',
        '**/*.d.ts',
        '**/*.config.*',
        '**/*.test.ts',
        '**/*.test.tsx',
        '**/*.spec.ts',
        '**/*.spec.tsx',
        '**/types/**',
        'prisma/**',
        'lib/client/**'
      ],
      thresholds: {
        statements: 60,
        // Vitest 5's v8 provider counts implicit-else branches that Vitest 3
        // omitted. 70% is the new measured baseline after that remapping.
        branches: 70,
        functions: 70,
        lines: 60
      }
    }
  },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, '.')
    }
  }
})
