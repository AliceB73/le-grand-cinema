module.exports = {
  preset: 'ts-jest',
  testEnvironment: 'node',
  testMatch: ['<rootDir>/src/**/*.test.ts'],
  collectCoverageFrom: [
    '<rootDir>/src/app.ts',
    '<rootDir>/src/docs/openapi.ts',
    '<rootDir>/src/programme/**/*.ts',
    '!<rootDir>/src/programme/**/*.test.ts',
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
