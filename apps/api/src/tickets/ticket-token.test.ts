import { describe, expect, it } from '@jest/globals';
import { createTicketToken, hashTicketToken } from './ticket-token.js';

describe('ticket token', () => {
  it('derives an opaque token per booking and stores only its hash', () => {
    const first = createTicketToken(
      'booking-1',
      'a-secret-with-at-least-32-characters',
    );
    const repeat = createTicketToken(
      'booking-1',
      'a-secret-with-at-least-32-characters',
    );
    const other = createTicketToken(
      'booking-2',
      'a-secret-with-at-least-32-characters',
    );

    expect(first).toMatch(/^lgc1_[A-Za-z0-9_-]{43}$/);
    expect(repeat).toBe(first);
    expect(other).not.toBe(first);
    expect(hashTicketToken(first)).not.toBe(first);
  });
});
