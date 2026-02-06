// Global test setup
import { jest } from "@jest/globals";

// Mock environment variables for tests
process.env.DATABASE_URL = "postgresql://test:test@localhost:5432/test";
process.env.OPENAI_API_KEY = "sk-test-key";
process.env.NODE_ENV = "test";

// Increase timeout for async tests
jest.setTimeout(10000);
