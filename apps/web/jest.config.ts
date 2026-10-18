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
    '<rootDir>/src/password-policy.ts',
    '<rootDir>/src/auth-messages.ts',
    '<rootDir>/src/AuthSessionProvider.tsx',
    '<rootDir>/src/SiteHeader.tsx',
    '<rootDir>/src/SignUpPage.tsx',
    '<rootDir>/src/SignInPage.tsx',
    '<rootDir>/src/ForgotPasswordPage.tsx',
    '<rootDir>/src/ResetPasswordPage.tsx',
    '<rootDir>/src/AppLayout.tsx',
    '<rootDir>/src/PrivacyConsentBanner.tsx',
    '<rootDir>/src/AccountPage.tsx',
    '<rootDir>/src/my-bookings-api.ts',
    '<rootDir>/src/admin-api.ts',
    '<rootDir>/src/AdminLayout.tsx',
    '<rootDir>/src/AdminShowtimesPage.tsx',
    '<rootDir>/src/AdminMoviesPage.tsx',
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
    '^.+/supabase-client$': '<rootDir>/src/supabase-client.mock.ts',
  },
};

export default config;
