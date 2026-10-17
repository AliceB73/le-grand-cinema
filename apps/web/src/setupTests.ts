import { jest } from '@jest/globals';
import '@testing-library/jest-dom';

const { TextDecoder, TextEncoder } = jest.requireActual<{
  TextDecoder: typeof globalThis.TextDecoder;
  TextEncoder: typeof globalThis.TextEncoder;
}>('node:util');

Object.assign(globalThis, { TextDecoder, TextEncoder });
