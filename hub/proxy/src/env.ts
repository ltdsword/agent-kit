export interface Env {
  SPIKE_KEY?: string;
  RELAY_TIMEOUT_MS?: string;
  DB: D1Database;
  RELAY: DurableObjectNamespace;
}
