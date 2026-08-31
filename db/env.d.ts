declare namespace Cloudflare {
  interface Env {
    DB: D1Database;
    WATCHFLOOR_AUTH_MODE?: string;
    WATCHFLOOR_ACCESS_TEAM_DOMAIN?: string;
    WATCHFLOOR_ACCESS_AUD?: string;
    WATCHFLOOR_ANALYST_EMAILS?: string;
  }
}
