import { describe, it, expect, vi, beforeEach } from 'vitest';
import AppError from '../src/Utils/errors/AppError.js';

// Mock AppConfig before importing OpenAIService
const mockConfig = vi.hoisted(() => ({
  OPENAI_ENABLED: false,
  OPENAI_API_KEY: undefined,
  OPENAI_TIMEOUT_MS: 60000,
  OPENAI_MODEL_CHEAP: 'gpt-5.4-nano',
  OPENAI_MODEL_FLAGSHIP: 'gpt-5.6-terra',
  EMBEDDING_MODEL: 'text-embedding-3-small',
}));

vi.mock('../src/Config/AppConfig.js', () => ({ default: mockConfig }));

import OpenAIService from '../src/Services/openai.service.js';

describe('OpenAIService', () => {
  beforeEach(() => {
    mockConfig.OPENAI_ENABLED = false;
    mockConfig.OPENAI_API_KEY = undefined;
  });

  it('throws AppError when OPENAI_ENABLED is false', () => {
    // The constructor calls getSharedClient() if no client is provided,
    // so the error is thrown at construction time
    expect(() => new OpenAIService()).toThrow(AppError);
    expect(() => new OpenAIService()).toThrow('OpenAI is not configured');
  });
});