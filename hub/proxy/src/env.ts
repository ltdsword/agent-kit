export interface Env {
  DB: D1Database;
  RELAY: DurableObjectNamespace;
  ADMIN_KEY_HASH?: string;
  SIGNING_KEY?: string;
  ALLOWED_ORIGINS?: string;
  ZALO_BOT_TOKEN?: string;
  ZALO_WEBHOOK_SECRET?: string;
  ZALO_BOT_LINK?: string;
  HUB_WEB_URL?: string;
  ZALO_MONTHLY_LIMIT?: string;
  ZALO_WEBHOOK_URL?: string;
}
