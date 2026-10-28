import { createContext, useContext, useEffect, useMemo, useState, useSyncExternalStore, type ReactNode } from 'react';
import type { HubClient, Simulator } from '@/api/client';
import type { HubSnapshot } from '@/api/types';

interface HubContextValue {
  client: HubClient & Partial<Simulator>;
}

const HubContext = createContext<HubContextValue | null>(null);

export function HubProvider({ client, children }: { client: HubClient & Partial<Simulator>; children: ReactNode }) {
  const value = useMemo(() => ({ client }), [client]);
  return <HubContext.Provider value={value}>{children}</HubContext.Provider>;
}

export function useClient(): HubClient & Partial<Simulator> {
  const ctx = useContext(HubContext);
  if (!ctx) throw new Error('useClient must be used inside <HubProvider>');
  return ctx.client;
}

/** The current snapshot; re-renders on every pushed update. */
export function useHub(): HubSnapshot {
  const client = useClient();
  return useSyncExternalStore(
    (cb) => client.subscribe(cb),
    () => client.getSnapshot(),
  );
}

/** A clock for "x min ago" labels. One timer per mounted user, ticks every `ms`. */
export function useNow(ms = 1000): number {
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), ms);
    return () => clearInterval(t);
  }, [ms]);
  return now;
}
