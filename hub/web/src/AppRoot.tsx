import { useEffect, useMemo } from 'react';
import type { Clients } from '@/api';
import { AuthProvider, useAuth } from '@/auth/AuthProvider';
import { HubProvider } from '@/state/HubProvider';
import { App, PublicApp } from './App';

/**
 * Signed out → only the login page exists (no data client, nothing fetched).
 * Signed in → a data client is created for this session and disposed on sign-out.
 */
export function AppRoot({ clients }: { clients: Clients }) {
  return (
    <AuthProvider client={clients.auth}>
      <SessionGate clients={clients} />
    </AuthProvider>
  );
}

function SessionGate({ clients }: { clients: Clients }) {
  const auth = useAuth();
  const token = auth.status === 'signed_in' ? auth.session.token : null;
  if (auth.status === 'loading') return null;
  if (!token) return <PublicApp />;
  return <SignedIn key={token} clients={clients} />;
}

function SignedIn({ clients }: { clients: Clients }) {
  const hub = useMemo(() => clients.createHub(), [clients]);
  useEffect(() => () => hub.dispose?.(), [hub]);
  return (
    <HubProvider client={hub}>
      <App />
    </HubProvider>
  );
}
