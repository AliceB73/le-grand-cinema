import { describe, expect, it, jest } from '@jest/globals';
import { redirectToCheckout } from './navigation';

describe('redirectToCheckout', () => {
  it('navigates the browser to the hosted checkout URL', () => {
    const assign = jest.fn();

    redirectToCheckout('https://checkout.stripe.com/test', { assign });

    expect(assign).toHaveBeenCalledWith('https://checkout.stripe.com/test');
  });
});
