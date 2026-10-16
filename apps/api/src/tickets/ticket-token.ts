import { createHash, createHmac } from 'node:crypto';

export function createTicketToken(bookingId: string, secret: string) {
  const token = createHmac('sha256', secret)
    .update(`le-grand-cinema:ticket:v1:${bookingId}`)
    .digest('base64url');
  return `lgc1_${token}`;
}

export function hashTicketToken(token: string) {
  return createHash('sha256').update(token).digest('hex');
}
