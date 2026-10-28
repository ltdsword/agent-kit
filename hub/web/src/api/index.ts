import type { HubClient, Simulator } from './client';
import { HttpHubClient } from './http/HttpHubClient';
import { MockHubClient } from './mock/MockHubClient';
import { HttpAuthClient } from '@/auth/HttpAuthClient';
import { MockAuthClient } from '@/auth/MockAuthClient';
import type { AuthClient } from '@/auth/types';

export * from './client';
export type * from './types';

export interface Clients {
  auth: AuthClient;
  /** Creates the data client after sign-in (it needs the session token). */
  createHub: () => HubClient & Partial<Simulator>;
}

/**
 * One switch: with VITE_HUB_URL set, talk to the real backend; otherwise use in-memory mocks
 * (any username, password "agenthub").
 */
export function createClients(): Clients {
  const url = (import.meta.env.VITE_HUB_URL as string | undefined)?.replace(/\/$/, '');
  if (url) {
    const auth = new HttpAuthClient(url);
    return { auth, createHub: () => new HttpHubClient(url, () => auth.token(), () => auth.signOut('expired')) };
  }
  return { auth: new MockAuthClient(), createHub: () => new MockHubClient() };
}
