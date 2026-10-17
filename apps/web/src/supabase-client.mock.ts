export const supabase = {
  auth: {
    getSession: jest.fn(async () => ({
      data: { session: null },
      error: null,
    })),
    onAuthStateChange: jest.fn(() => ({
      data: { subscription: { unsubscribe: jest.fn() } },
    })),
    signUp: jest.fn(),
    signInWithPassword: jest.fn(),
    signOut: jest.fn(),
    resetPasswordForEmail: jest.fn(),
    updateUser: jest.fn(),
  },
};

export function createBrowserSupabaseClient() {
  return supabase;
}
