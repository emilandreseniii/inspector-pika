import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./src/test-utils/setup.ts'],
    globals: true,
    include: ['src/**/*.{test,spec}.{ts,js}'],
  },
  resolve: {
    alias: {
      '@inspector-pika/shared': path.resolve(__dirname, '../shared/src/index.ts'),
    },
  },
})
