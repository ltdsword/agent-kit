export interface Env {
  DB: D1Database;
  RELAY: DurableObjectNamespace;
  ADMIN_KEY_HASH?: string;
  SIGNING_KEY?: string;
  ALLOWED_ORIGINS?: string;
}
