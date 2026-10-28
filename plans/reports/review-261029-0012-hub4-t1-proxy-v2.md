# Review: hub4 T1, proxy v2 (`hub/proxy`), attempt 3

Verdict: **PASS**

## History
- Attempt 1 was blocked: the spec asked for `npm run setup`, but the package had no such script. Fixed by decision D1 (user allowed adding that one line).
- Attempt 2 was blocked by a false positive in a file-privacy hook, which matched `this.env.DB...`. Fixed by decision D2 (avoid the token). The partial work was saved as WIP `e4ef913` and carried into attempt 3.

## Checked (re-run by lead)
- `npm test -w @agent-hub/proxy`: 12 pass. Typecheck: 0 errors. The only package.json change is the `setup` line. No `/spike` routes remain.
- **Crypto:**
  - PBKDF2-SHA256 with `LIMITS.pbkdf2Iterations`, a 16-byte salt and a 32-byte hash, compared in constant time;
  - tokens are 32 random bytes, stored as sha256;
  - generated passwords use an unambiguous alphabet.
- **Login:**
  - rate-limited per username + `CF-Connecting-IP`;
  - unknown users go through a dummy PBKDF2 hash (no timing leak) and get the same `invalid_credentials` error;
  - hashes are upgraded when `pw_iter` is below the limit.
- **Password change:** requires the current password; the new one must be 12–256 characters (otherwise 422 `weak_password`). It revokes the user's other sessions, and an admin reset revokes all of that user's sessions.
- **Keys:** the admin key is checked as sha256 against `ADMIN_KEY_HASH` in constant time. The computer key is checked as sha256 against `computers.key_hash` in constant time.
- **Ownership:** workspace routes join `workspace_index` to `computers.user_id` (otherwise 404). The stream route checks that the computer belongs to the user.
- **Relay:**
  - offline returns 503 `computer_offline` and a timeout returns 504 `computer_timeout`;
  - cancel is supported;
  - `GET .../documents/content` is relayed with `stream: true`, matching the note from the T2 review.
- **CORS:** `ALLOWED_ORIGINS` plus `localhost:5173`; the allowed headers include `X-Agent-Hub-Protocol`.
- **setup.ts:**
  - prints only the proxy URL;
  - sends secrets to `wrangler secret put` through stdin;
  - `SIGNING_KEY` is only generated if it isn't set yet;
  - `admin.key` and `admin.json` are written with mode 0600.
- No `.env.` / `this.env` tokens remain.

## Notes
- Local test runs leave a `.wrangler-home/` (logs only) at the worktree root. Removed it; worth adding to `.gitignore` later.
