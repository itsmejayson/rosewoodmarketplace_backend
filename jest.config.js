/** @type {import('jest').Config} */
module.exports = {
  testEnvironment: 'node',
  testMatch: ['**/src/__tests__/**/*.test.js'],
  collectCoverageFrom: ['src/**/*.js', '!src/prisma/**'],
  coverageDirectory: 'coverage',
  setupFilesAfterFramework: [],
  // Ensure each test file gets a fresh module registry so mocks don't bleed
  clearMocks: true,
  resetMocks: true,
};
