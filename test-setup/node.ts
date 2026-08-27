import { jest } from "bun:test";

process.env.AWS_ACCESS_KEY_ID = "MOCK_AWS_ACCESS_KEY_ID";
process.env.AWS_SECRET_ACCESS_KEY = "MOCK_AWS_SECRET_ACCESS_KEY";

// Deterministic theme (packages/core/web-reporter-ui/src/theme/colors.ts picks a palette with Math.random)
Math.random = jest.fn(() => 0.5);
