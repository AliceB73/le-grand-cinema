import { describe, expect, it } from '@jest/globals';
import { render, screen } from '@testing-library/react';
import App from './App';

describe('App', () => {
  it('shows the project introduction and API documentation link', () => {
    render(<App />);

    expect(
      screen.getByRole('heading', {
        name: 'Votre prochaine séance commence ici.',
      }),
    ).toBeTruthy();
    expect(
      screen
        .getByRole('link', { name: 'Consulter la documentation API' })
        .getAttribute('href'),
    ).toBe('http://localhost:3000/api/docs');
  });
});
