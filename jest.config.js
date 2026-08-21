module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['**/tests/**/*.test.ts'],
  moduleFileExtensions: ['ts', 'js', 'json'],
  roots: ['<rootDir>/tests', '<rootDir>/src'],
  transform: {
    '^.+\\.ts$': ['ts-jest', { diagnostics: false }]
  },
  clearMocks: true,
  testPathIgnorePatterns: ['/node_modules/', '/dist/'],
  coverageThreshold: {
    global: {
      branches: 15,
      functions: 30,
      lines: 35,
      statements: 35
    }
  }
};
