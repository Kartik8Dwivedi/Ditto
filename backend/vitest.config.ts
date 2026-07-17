import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    /**
     * AppConfig validates env at import time and exits the process if anything
     * is missing, so the suite needs values for the required variables.
     *
     * The key is a dummy on purpose: every test mocks the OpenAI client, and
     * nothing here may ever reach the real API.
     */
    env: {
      NODE_ENV: 'test',
      MONGO_URI: 'mongodb://127.0.0.1:27017/ditto-test',
      OPENAI_API_KEY: 'test-key-not-a-real-key',
    },
  },
});
