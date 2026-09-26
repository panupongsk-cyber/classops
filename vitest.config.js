import { defineConfig } from 'vitest/config'
import react from '@vitejs/plugin-react'

// Frontend unit and component tests (PS-TASK-20260926-838). jsdom stands in for the browser;
// tests use synthetic data only, because this tree is published.
export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    include: ['src/**/*.test.{js,jsx}'],
    restoreMocks: true,
  },
})
