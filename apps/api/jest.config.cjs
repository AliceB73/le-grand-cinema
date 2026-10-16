module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  collectCoverageFrom: [
    '<rootDir>/src/app.ts',
    '<rootDir>/src/docs/openapi.ts',
    '<rootDir>/src/auth/**/*.ts',
    '<rootDir>/src/payments/**/*.ts',
    '<rootDir>/src/programme/**/*.ts',
    '<rootDir>/src/seats/**/*.ts',
    '<rootDir>/src/tickets/**/*.ts',
    '!<rootDir>/src/auth/**/*.test.ts',
    '!<rootDir>/src/payments/**/*.test.ts',
    '!<rootDir>/src/programme/**/*.test.ts',
    '!<rootDir>/src/seats/**/*.test.ts',
    '!<rootDir>/src/tickets/**/*.test.ts',
  ],
  transform: {
    '^.+\\.tsx?$': [
      'ts-jest',
      {
        tsconfig: {
          module: 'NodeNext',
          moduleResolution: 'NodeNext',
          isolatedModules: true,
        },
      },
    ],
  },
  moduleNameMapper: {
    '^(\\.{1,2}/.*)\\.js$': '$1',
  },
};
