import type { Decision, HistoryEntry, HubDocument, Prompt, Workspace } from '../types';

const MIN = 60_000;

/** Today at hh:mm, local time. */
function at(hhmm: string, daysAgo = 0): number {
  const [h, m] = hhmm.split(':').map(Number);
  const d = new Date();
  d.setDate(d.getDate() - daysAgo);
  d.setHours(h ?? 0, m ?? 0, 0, 0);
  return d.getTime();
}

const REPORT_R3 = `# Run r3: final report

**Request:** "Paginate GET /users with a cursor; keep the old offset params working for one release."

## Summary

3 of 3 tasks merged into \`agent/integration-r3\`. The gate passed. One fix round was needed on T2 (cursor encoding).

## Tasks

| Task | Title | Worker | Status | Fix rounds |
|---|---|---|---|---|
| \`T1\` | Add page params to UserHandler | worker-1 | MERGED | 0 |
| \`T2\` | Cursor helper in UserRepository | worker-2 | MERGED | 1 |
| \`T3\` | Update API docs | worker-1 | MERGED | 0 |

## Gate

- [x] \`./gradlew test\`: 198 passed
- [x] \`./gradlew spotlessCheck\`
- [ ] End-to-end suite: not configured

## Commits

\`\`\`
4f1c2e9 T1: accept page and size on GET /users
9b07d3a T2: opaque cursor in UserRepository
e21a8c0 T2: fix round 1, url-safe base64 cursor
71d5b44 T3: document cursor pagination
\`\`\`

## Diff stat

\`\`\`
 src/main/java/org/example/user/server/UserHandler.java | 50 +++++++---
 src/main/java/org/example/user/UserRepository.java     | 56 ++++++++++-
 docs/api/users.md                                       | 27 ++++--
 3 files changed, 133 insertions(+), 22 deletions(-)
\`\`\`

## Risks and known issues

- Offset params are deprecated but still accepted; remove them in the next release.
- The cursor is not signed. A client can craft one, but it only selects users it could already list.
`;

export const REPORT_R4 = `# Run r4: final report

**Request:** "Add input validation to registerUser: max name length 64, valid email format, update the API docs."

## Summary

4 of 4 tasks merged into \`agent/integration-r4\`. The gate passed.

## Tasks

| Task | Title | Status | Fix rounds |
|---|---|---|---|
| \`T1\` | Limit name length | MERGED | 0 |
| \`T2\` | Validate email format | MERGED | 2 |
| \`T4\` | Request schema with zod | MERGED | 0 |
| \`T3\` | Update user API docs | MERGED | 0 |

## Gate

- [x] \`./gradlew test\`: 214 passed
- [ ] Known issue: IDN emails are accepted unchecked

## Diff stat

\`\`\`
 11 files changed, 342 insertions(+), 58 deletions(-)
\`\`\`
`;

const DIFF_R3 = `diff --git a/src/main/java/org/example/user/server/UserHandler.java b/src/main/java/org/example/user/server/UserHandler.java
--- a/src/main/java/org/example/user/server/UserHandler.java
+++ b/src/main/java/org/example/user/server/UserHandler.java
@@ -38,9 +38,17 @@ public final class UserHandler
   public Response registerUser(RegisterUserRequest req) {
-    if (req.name() == null || req.name().isBlank()) {
+    String name = req.name() == null ? "" : req.name().strip();
+    if (name.isEmpty() || name.length() > MAX_NAME_LENGTH) {
       return Response.badRequest("invalid name");
     }
+    if (!EmailValidator.isValid(req.email())) {
+      return Response.badRequest("invalid email");
+    }
diff --git a/src/main/java/org/example/user/UserRepository.java b/src/main/java/org/example/user/UserRepository.java
--- a/src/main/java/org/example/user/UserRepository.java
+++ b/src/main/java/org/example/user/UserRepository.java
@@ -12,6 +12,22 @@ public class UserRepository
+  public Page<User> listAfter(String cursor, int size) {
+    long after = Cursor.decode(cursor);
+    return db.query(SELECT_AFTER, after, size + 1);
+  }
diff --git a/docs/api/users.md b/docs/api/users.md
--- a/docs/api/users.md
+++ b/docs/api/users.md
@@ -20,8 +20,14 @@ ## GET /users
-\`page\` and \`size\` select a page of users.
+Pass \`cursor\` from the previous response to get the next page.
+\`page\` is deprecated and will be removed in the next release.
`;

const PLAN_T2 = `# Task plan: T2 Validate email format

Written by Opus for worker-2. Fix round 1 and the review are appended at the end.

## Goal

\`registerUser\` rejects malformed email addresses with a 400 and a clear message.

## Owned paths

- \`src/main/java/org/example/user/server/\`
- \`src/test/java/org/example/user/\`

## Acceptance

- [x] invalid email gives an error response
- [ ] plus-addressing (\`a+b@x.io\`) is accepted
- [ ] unit tests cover both

## Fix round 1 (Opus)

The regex rejected plus-addressing. Use \`EmailValidator.isValid\` instead of the pattern.
`;

const DECISION_D2 = `# D2 · question · T4

**Question:** T4 touches the client SDK as well as the API. Narrow it?

| Key | Option |
|---|---|
| A | Keep T4 as planned |
| B | Narrow T4 to the API layer (recommended) |
| C | Split T4 into two tasks |

## Answer

**B**, chosen on the hub from your phone at 11:58. Channel: \`hub\`.
`;

const RESEARCH_R4_2 = `# Research dossier · r4 round 2

## Questions

1. Does the API doc generator read Javadoc?
2. Is zod already a dependency?

## Findings

- \`docs/api\` is hand-written Markdown; there is no generator.
- zod is not in \`package.json\`; the client uses io-ts.

## Readiness

READY: contracts and tests are clear.
`;

const REVIEW_T2 = `# Review · T2 round 1

**Verdict:** MAJOR_FIX

- \`UserHandlerTest.rejectsPlusAddress\` fails on \`a+b@x.io\`
- \`UserHandler.java:57\` uses a hand-written regex
`;

export function seedWorkspaces(now: number): Workspace[] {
  return [
    {
      id: 'ws_k3m9q2', name: 'thrift-demo', path: '~/work/thrift-demo.workspace', status: 'RUNNING',
      lastSeenAt: now, kitVersion: '0.9.4', archived: false,
      uploads: { documents: true, diffs: true, agentScreens: true },
      orchestrator: {
        program: 'Claude Code', model: 'Claude Opus 5.5', effort: 'high', state: 'idle', lastActivityAt: now - 2 * MIN,
        screen: [
          '⏺ decision ask --run r4 --kind repair --task T2',
          '  D3 PENDING · hub: online',
          '⏺ D3 · T2: merge conflict in UserHandler.java',
          "  A: Repair: rebase T2 on T1's version  (recommended)",
          "  B: Drop T2's name change, keep only the email part",
          "  C: Stop T2, I'll handle it",
          '  Answer on the hub or reply here (D3 A/B/C or your own words).',
          '> ',
        ].join('\n'),
      },
      run: {
        id: 'r4', status: 'RUNNING', integrationBranch: 'agent/integration-r4', gate: 'NOT_RUN',
        tasks: [
          { id: 'T1', title: 'Limit name length', status: 'RUNNING', worker: 'worker-1', dependsOn: [] },
          { id: 'T2', title: 'Validate email format', status: 'FIX_REQUIRED', worker: 'worker-2', fixRound: '1/2', dependsOn: [] },
          { id: 'T4', title: 'Request schema with zod', status: 'RUNNING', worker: 'worker-3', dependsOn: [] },
          { id: 'T3', title: 'Update user API docs', status: 'PENDING', dependsOn: ['T1', 'T2'] },
        ],
        problems: [
          { text: 'T1 no screen change for 9 min.', note: 'No decision opened.', severity: 'warn' },
          { text: 'T4 blocked 14 min', note: 'on an approval prompt.', severity: 'blocked', decisionId: 'D4' },
        ],
      },
      pastRuns: [
        { id: 'r3', status: 'MERGED', outcome: 'merged into main, pushed', date: '25 Oct' },
        { id: 'r2', status: 'DONE', outcome: 'not merged, your choice C', date: '22 Oct' },
        { id: 'r1', status: 'FAILED', outcome: 'closed after abandon D2', date: '20 Oct' },
      ],
      workers: [
        { slot: 'worker-1', status: 'BUSY', taskId: 'T1', live: 'working', sinceAt: now - 12 * MIN, model: 'gpt-6-luna xhigh',
          screen: '• Edited UserHandler.java (+14 -3)\n• Running ./gradlew test --tests UserHandlerTest\n  BUILD SUCCESSFUL in 41s' },
        { slot: 'worker-2', status: 'BUSY', taskId: 'T2', live: 'idle', sinceAt: now - 6 * MIN, model: 'gpt-6-luna xhigh',
          screen: '• Fix round 1 done, report written\n  reports/T2.json\n› waiting for review' },
        { slot: 'worker-3', status: 'BLOCKED', taskId: 'T4', live: 'blocked', sinceAt: now - 14 * MIN, model: 'gpt-6-luna xhigh',
          reason: 'approval prompt: npm install zod',
          screen: '  Would you like to run the following command?\n  $ npm install zod\n› 1. Yes, proceed\n  2. No, tell Codex what to do differently' },
      ],
      scout: {
        roundsUsed: 2, maxRounds: 3, ready: true,
        rounds: [
          { name: 'Round 1', questions: ['Where is user input validated today?', 'Which tests cover UserHandler?'], docId: 'doc_res2' },
          { name: 'Round 2', questions: ['Does the API doc generator read Javadoc?', 'Is zod already a dependency?'], docId: 'doc_res2' },
        ],
      },
    },
    {
      id: 'ws_q7l2a1', name: 'ledger-sync', path: '~/work/ledger-sync.workspace', status: 'OFFLINE',
      lastSeenAt: now - 4 * MIN, kitVersion: '0.9.4', archived: false,
      uploads: { documents: true, diffs: false, agentScreens: true },
      orchestrator: { program: 'Claude Code', model: 'Claude Opus 5.5', effort: 'high', state: 'unknown', lastActivityAt: now - 4 * MIN },
      run: {
        id: 'r7', status: 'RUNNING', integrationBranch: 'agent/integration-r7', gate: 'NOT_RUN',
        tasks: [
          { id: 'T1', title: 'Parse bank CSV export', status: 'MERGED', worker: 'worker-1', dependsOn: [] },
          { id: 'T2', title: 'Dedupe transactions', status: 'PASSED', worker: 'worker-2', dependsOn: ['T1'] },
          { id: 'T3', title: 'Run ledger migration', status: 'BLOCKED', worker: 'worker-1', dependsOn: ['T1'] },
        ],
        problems: [{ text: 'T3 blocked 22 min.', note: 'Needs a database the sandbox can’t reach.', severity: 'blocked', decisionId: 'D2' }],
      },
      pastRuns: [{ id: 'r6', status: 'MERGED', outcome: 'merged into main, pushed', date: '19 Oct' }],
      workers: [{ slot: 'worker-1', status: 'BLOCKED', taskId: 'T3', live: 'unknown', sinceAt: now - 22 * MIN, model: 'gpt-6-luna xhigh' }],
    },
    {
      id: 'ws_p8x1d0', name: 'billing-api', path: '~/work/billing-api.workspace', status: 'STOPPED',
      lastSeenAt: at('18:20', 1), kitVersion: '0.9.1', archived: false,
      uploads: { documents: true, diffs: true, agentScreens: false },
      orchestrator: { program: 'Claude Code', model: 'Claude Opus 5.5', effort: 'high', state: 'off', lastActivityAt: at('18:20', 1) },
      pastRuns: [
        { id: 'r2', status: 'MERGED', outcome: 'merged into main, pushed to origin/main', date: 'yesterday' },
        { id: 'r1', status: 'DONE', outcome: 'not merged, your choice C', date: '14 Oct' },
      ],
      workers: [],
    },
  ];
}

export function seedDecisions(now: number): Decision[] {
  return [
    {
      workspaceId: 'ws_k3m9q2', runId: 'r4', id: 'D3', kind: 'repair', agent: 'worker-2', taskId: 'T2',
      title: 'T2: merge conflict in UserHandler.java',
      question: 'Cherry-pick of T2’s commit conflicted with T1’s change. Both edit the name check. Post-merge tests were not run.',
      evidence: [
        { code: 'git cherry-pick a1b2c3', note: 'exit 1', bad: true },
        { code: 'UserHandler.java:42', note: 'conflict, both sides edit it' },
        { code: 'post-merge check', note: 'not run' },
      ],
      options: [
        { key: 'A', label: 'Repair: rebase T2 on T1’s version', consequence: 'worker-2 gets fix round 2 of 2 to redo its name check on top of T1.' },
        { key: 'B', label: 'Drop T2’s name change, keep only the email part', consequence: 'T2 merges without touching the name check. T1’s version stays.' },
        { key: 'C', label: 'Stop T2, I’ll handle it', consequence: 'T2 becomes BLOCKED, worker-2 is released, T3 waits for you.' },
      ],
      recommend: 'A', status: 'OPEN', openedAt: now - 4 * MIN, appliedNote: 'Used by repair --decision D3.',
    },
    {
      workspaceId: 'ws_k3m9q2', runId: 'r4', id: 'D4', kind: 'worker_approval', agent: 'worker-3', taskId: 'T4',
      title: 'worker-3 wants to run npm install zod', question: '', evidence: [],
      approval: {
        command: 'npm install zod', cwd: 'worktrees/worker-3',
        why: ['Downloads a package from the npm registry.', 'Writes to ~/.npm, outside the worktree.', 'T4’s task file doesn’t allow installs, so Opus can’t approve it as routine.'],
        screen: '• Added RegisterUserRequest schema draft\n  └ src/main/ts/validation/register.ts\n• zod is not in package.json yet\n\n  Would you like to run the following command?\n  $ npm install zod\n› 1. Yes, proceed\n  2. No, and tell Codex what to do differently',
      },
      opusNote: 'T4’s plan names zod, and D2 kept T4 to the API layer. One install; the lockfile change stays in the worktree.',
      options: [
        { key: 'A', label: 'Approve once', consequence: 'worker-3 runs this one command. The next install asks again.' },
        { key: 'B', label: 'Deny', consequence: 'worker-3 is told not to install. Opus re-plans T4 without zod.' },
      ],
      recommend: 'A', status: 'OPEN', openedAt: now - 14 * MIN, appliedNote: 'Opus pressed 1 in worker-3’s terminal. The install ran.',
    },
    {
      workspaceId: 'ws_q7l2a1', runId: 'r7', id: 'D2', kind: 'blocker', agent: 'worker-1', taskId: 'T3',
      title: 'T3 blocked: the migration needs a database the sandbox can’t reach',
      question: 'The migration test connects to Postgres on localhost:5432. The worker sandbox blocks it, so T3 can’t verify its change.',
      evidence: [
        { code: './gradlew migrateTest', note: 'exit 1', bad: true },
        { code: 'Connection refused: localhost:5432', note: 'sandbox network' },
      ],
      options: [
        { key: 'A', label: 'Unblock: use the Testcontainers profile', consequence: 'T3 restarts with an in-process database. No network needed.' },
        { key: 'B', label: 'Narrow T3 to code only', consequence: 'T3 merges without running the migration. You run it yourself.' },
        { key: 'C', label: 'Give up T3', consequence: 'T3 becomes FAILED. The rest of r7 continues.' },
      ],
      recommend: 'A', status: 'OPEN', openedAt: now - 22 * MIN, appliedNote: 'Used by task-unblock --decision D2.',
    },
  ];
}

export function seedPrompts(): Prompt[] {
  return [
    { id: 'p3', workspaceId: 'ws_k3m9q2', text: 'Also add a test for empty emails', status: 'DELIVERED', createdAt: at('11:40') },
    { id: 'p2', workspaceId: 'ws_k3m9q2', text: 'Check the scout’s second dossier before planning T4', status: 'EXPIRED', createdAt: at('09:02') },
    { id: 'p1', workspaceId: 'ws_k3m9q2', text: 'Add input validation to registerUser: max name length 64, valid email, update the API docs', status: 'DELIVERED', createdAt: at('09:12') },
  ];
}

export function seedHistory(): HistoryEntry[] {
  return [
    { id: 'h1', workspaceId: 'ws_k3m9q2', at: at('11:58'), type: 'answer', runId: 'r4', decisionId: 'D2', choice: 'B', label: 'Narrow T4 to the API layer', channel: 'hub', device: 'phone', docId: 'doc_d2' },
    { id: 'h2', workspaceId: 'ws_k3m9q2', at: at('11:40'), type: 'prompt', runId: 'r4', promptId: 'p3' },
    { id: 'h3', workspaceId: 'ws_k3m9q2', at: at('11:31'), type: 'routine', runId: 'r4', text: 'Opus approved ./gradlew test for worker-1', reason: 'build inside worktree' },
    { id: 'h4', workspaceId: 'ws_k3m9q2', at: at('10:20'), type: 'routine', runId: 'r4', text: 'Opus sent fix round 1/2 to worker-2 (T2)', reason: 'email regex rejects plus-addressing', docId: 'doc_rev_t2' },
    { id: 'h5', workspaceId: 'ws_k3m9q2', at: at('10:05'), type: 'answer', runId: 'r4', decisionId: 'D1', choice: 'A', label: 'Use the existing EmailValidator', channel: 'terminal', quote: 'A, go ahead' },
    { id: 'h6', workspaceId: 'ws_k3m9q2', at: at('09:12'), type: 'prompt', runId: 'r4', promptId: 'p1' },
    { id: 'h7', workspaceId: 'ws_k3m9q2', at: at('16:12', 3), type: 'answer', runId: 'r3', decisionId: 'D4', choice: 'A', label: 'Merge and push', extra: 'into main', channel: 'hub', device: 'laptop', docId: 'doc_r3_report' },
    { id: 'h8', workspaceId: 'ws_k3m9q2', at: at('14:03', 3), type: 'answer', runId: 'r3', decisionId: 'D2', choice: 'B', label: 'Cursor pagination', channel: 'hub_reply', device: 'laptop', quote: 'use cursor, not offset, clients scroll forever' },
    { id: 'h9', workspaceId: 'ws_k3m9q2', at: at('13:40', 3), type: 'routine', runId: 'r3', text: 'Opus fixed import order in T2 itself (MINOR_FIX)', reason: 'formatting only' },
    { id: 'h10', workspaceId: 'ws_q7l2a1', at: at('10:48'), type: 'answer', runId: 'r7', decisionId: 'D1', choice: 'A', label: 'Accept change outside T2’s files', channel: 'hub', device: 'phone' },
  ];
}

export function seedDocuments(): HubDocument[] {
  const doc = (d: Omit<HubDocument, 'bytes'>): HubDocument => ({ ...d, bytes: new TextEncoder().encode(d.content).length });
  return [
    doc({ id: 'doc_plan_t2', workspaceId: 'ws_k3m9q2', runId: 'r4', kind: 'task_file', name: 'email-validation-28-10-26.md', title: 'Task plan · T2', format: 'markdown', truncated: false, updatedAt: at('11:52'), content: PLAN_T2 }),
    doc({ id: 'doc_d2', workspaceId: 'ws_k3m9q2', runId: 'r4', kind: 'decision', name: 'D2.md', title: 'Decision record · D2', format: 'markdown', truncated: false, updatedAt: at('11:58'), content: DECISION_D2 }),
    doc({ id: 'doc_res2', workspaceId: 'ws_k3m9q2', runId: 'r4', kind: 'research', name: 'r4-research-2.md', title: 'Research dossier · round 2', format: 'markdown', truncated: false, updatedAt: at('09:40'), content: RESEARCH_R4_2 }),
    doc({ id: 'doc_rev_t2', workspaceId: 'ws_k3m9q2', runId: 'r4', kind: 'review', name: 'review-T2-round-1.md', title: 'Review report · T2 round 1', format: 'markdown', truncated: false, updatedAt: at('10:20'), content: REVIEW_T2 }),
    doc({ id: 'doc_r3_report', workspaceId: 'ws_k3m9q2', runId: 'r3', kind: 'final_report', name: 'final-report.md', title: 'Final report', format: 'markdown', truncated: false, updatedAt: at('16:00', 3), content: REPORT_R3 }),
    doc({ id: 'doc_r3_diff', workspaceId: 'ws_k3m9q2', runId: 'r3', kind: 'final_diff', name: 'final.diff', title: 'Total diff', format: 'diff', truncated: true, updatedAt: at('16:00', 3), content: DIFF_R3 }),
    doc({ id: 'doc_r6_report', workspaceId: 'ws_q7l2a1', runId: 'r6', kind: 'final_report', name: 'final-report.md', title: 'Final report', format: 'markdown', truncated: false, updatedAt: at('15:00', 9), content: REPORT_R3.replace(/r3/g, 'r6') }),
    doc({ id: 'doc_r2_report', workspaceId: 'ws_p8x1d0', runId: 'r2', kind: 'final_report', name: 'final-report.md', title: 'Final report', format: 'markdown', truncated: false, updatedAt: at('18:00', 1), content: REPORT_R3.replace(/r3/g, 'r2') }),
  ];
}

export const DIFF_R4 = DIFF_R3;
