module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  clearMocks: true,
  testPathIgnorePatterns: ['/node_modules/', '/dist/']
};
