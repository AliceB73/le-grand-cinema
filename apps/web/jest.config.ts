import type { Config } from 'jest';

const config: Config = {
  preset: 'ts-jest',
  testEnvironment: 'jsdom',
  testMatch: ['<rootDir>/src/**/*.test.ts?(x)'],
  collectCoverageFrom: [
    '<rootDir>/src/App.tsx',
    '<rootDir>/src/programme-api.ts',
    '<rootDir>/src/SeatMap.tsx',
    '<rootDir>/src/seat-api.ts',
    '<rootDir>/src/payment-api.ts',
    '<rootDir>/src/navigation.ts',
  ],
  setupFilesAfterEnv: ['<rootDir>/src/setupTests.ts'],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          jsx: 'react-jsx',
          module: 'CommonJS',
          moduleResolution: 'Node',
        },
      },
    ],
  },
  moduleNameMapper: {
    '^\\./api-config$': '<rootDir>/src/api-config.mock.ts',
  },
};

export default config;
