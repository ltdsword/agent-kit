import { createContext, useContext, useSyncExternalStore, type ReactNode } from 'react';
import type { AuthClient, AuthState } from './types';

const AuthContext = createContext<AuthClient | null>(null);

export function AuthProvider({ client, children }: { client: AuthClient; children: ReactNode }) {
  return <AuthContext.Provider value={client}>{children}</AuthContext.Provider>;
}

export function useAuthClient(): AuthClient {
  const c = useContext(AuthContext);
  if (!c) throw new Error('useAuthClient must be used inside <AuthProvider>');
  return c;
}

export function useAuth(): AuthState {
  const c = useAuthClient();
  return useSyncExternalStore((cb) => c.subscribe(cb), () => c.getState());
}
