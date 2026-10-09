import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    /**
     * Dummy values for tests that construct services depending on Mongo or OpenAI.
     * The key is fake on purpose: every test mocks the client directly.
     */
    env: {
      NODE_ENV: 'test',
      MONGO_URI: 'mongodb://127.0.0.1:27017/ditto-test',
      OPENAI_API_KEY: 'test-key-not-a-real-key',
    },
  },
});
