# Project Status

**Project:** Desktop Agent
**Phase 1 (Desktop Collector):** COMPLETED
**Phase 2 (Snapshot Engine):** COMPLETED
**Phase 3 (Google Sheets Sync Engine V1):** COMPLETED
**Phase 4 (Scheduler + Auto Pipeline):** COMPLETED
**Phase 5 (Telegram Notification Engine V1):** COMPLETED
**Phase 6 (Gmail Web Invitation Intake V1):** COMPLETED
**Phase 7 (Telegram Orchestration V1):** COMPLETED
**Date:** 2026-06-30

## What Phase 1 does

Phase 1 is a read-only collector. It connects to browser profiles already open on
this machine, finds Google Ads campaign tabs inside them, and reads back a
normalized JSON snapshot of filtered campaign rows. It does not persist
anything anywhere yet — output goes to stdout only.

Concretely, for each open AdsPower profile, Phase 1:

1. Connects to the AdsPower Local API to list currently open browser profiles.
2. Connects to each profile's existing Chrome instance over CDP (no new browser
   windows, no launching — it attaches to what's already running).
3. Detects which open tabs are Google Ads pages (`ads.google.com`).
4. Parses `accountName` (from the tab title) and `customerId` (from the
   `ocid`/`uscid`/`ascid`/`__c` URL params) per tab.
5. Clicks the Google Ads UI's own Refresh button (never `page.reload()`).
6. Applies a date-range strategy via the Google Ads date picker
   (`GOOGLE_ADS_DATE_MODE`), to guard against MCC/account timezone drift.
7. Applies the campaign-name filter for `WATCH_PROVIDER_CODE`.
8. Waits out slow-proxy / skeleton-loading states instead of reading a half
   -rendered table.
9. Reads the campaign table (header-mapped, defensively parsed — missing
   columns come back `null` rather than throwing).
10. Scrolls Google Ads' virtualized row list to collect every filtered row,
    not just the rows currently mounted in the DOM viewport.
11. Outputs one normalized JSON object per Google Ads tab, merged across all
    open profiles, to stdout.

## Current environment variables

| Variable | Default | Purpose |
|---|---|---|
| `DATABASE_URL` | `file:./prisma/dev.db` | SQLite connection string (Prisma is wired but unused by Phase 1 logic beyond a basic `ProfileScan` log row) |
| `ADSPOWER_API_BASE_URL` | `http://local.adspower.net:50325` | AdsPower Local API base URL |
| `ADSPOWER_API_KEY` | _(none)_ | Sent as `Authorization: Bearer <key>`; required by current AdsPower clients |
| `WATCH_PROVIDER_CODE` | `QKA` | Campaign-name filter keyword |
| `GOOGLE_ADS_DATE_MODE` | `AUTO` | `TODAY` \| `YESTERDAY` \| `LAST_2_DAYS` \| `AUTO` (AUTO resolves to `LAST_2_DAYS`) |
| `GOOGLE_ADS_ACTION_DELAY_MS` | `2000` | Delay after refresh/filter actions before polling readiness |
| `GOOGLE_ADS_TABLE_TIMEOUT_MS` | `90000` | Max time to wait for the table to become ready (also reused as the row-scroll-collection ceiling) |
| `GOOGLE_ADS_SETTLE_DELAY_MS` | `5000` | Extra fixed wait after the table is detected stable |
| `GOOGLE_ADS_STABLE_CHECKS` | `3` | Consecutive identical polls required to call the table "stable" |
| `GOOGLE_ADS_STABLE_INTERVAL_MS` | `1500` | Poll interval for readiness/stability checks (also reused as the per-scroll-step wait) |
| `LOG_LEVEL` | `info` | Pino log level |

## Known limitations

- **Filter-input detection is flaky on some accounts.** `CampaignSearchExecutor`
  reliably finds and fills the campaign-name filter on most tabs, but on a
  minority of real accounts it returns `SEARCH_INPUT_NOT_FOUND` even though a
  human could find the filter manually. Root cause is Google Ads rendering the
  filter bar in one of several visual states (inline chip / collapsed "Show N
  active filters" / no filter yet) that aren't always disambiguated correctly.
  Tracked as a follow-up.
- **Date-picker click targeting is not yet fully precise.** On at least one
  observed account, the date-picker open step mis-clicked into an unrelated
  Google Ads "Quick help" panel instead of the date dropdown. The collector
  still failed safe (`DATE_RANGE_NOT_APPLIED`, no data corruption, pipeline
  continued), but the click targeting needs to be tightened. Tracked as a
  follow-up.
- **No retry across tab disconnects.** If AdsPower or the underlying Chrome tab
  closes mid-run, that tab's result is just `PAGE_NOT_FOUND` / `COLLECT_FAILED`
  — there's no reconnect/retry logic.
- **Single date-range strategy per run.** All detected tabs in a run use the
  same `GOOGLE_ADS_DATE_MODE`; there's no per-account override.
- **No persistence yet.** Output is stdout JSON only (aside from a minimal
  `ProfileScan` row written via Prisma for traceability). Nothing is queryable
  after the process exits.
- **No campaign-row data scraping beyond the documented `CampaignRow` fields.**
  Sub-resources (ad groups, ads, keywords) are out of scope for Phase 1.

## What Phase 2 adds

Phase 2 persists every collector run to SQLite via Prisma so collected data
survives across runs and can be queried/diffed over time. Google Sheets
export, scheduling, Telegram notifications, and any AI-driven analysis remain
out of scope.

Schema (`prisma/schema.prisma`): `CollectorRun` (1 per `pnpm dev` invocation)
-> `AccountSnapshot` (1 per Google Ads tab collected) -> `CampaignSnapshot`
(1 per collected campaign row, keyed by `customerId|campaignName|account`
via `buildCampaignKey` in `src/domain/services/campaignKeyBuilder.ts`).

Write path: `GoogleAdsAccountReadResult[]` -> `buildCollectorRunInput`
(`src/domain/services/snapshotMapper.ts`) -> `PrismaSnapshotRepository.saveRun`
(`src/infrastructure/db/PrismaSnapshotRepository.ts`), called at the end of
`pnpm dev` after the existing stdout JSON output.

Read path: `pnpm snapshot:latest` (`src/presentation/cli/snapshotLatest.ts`)
prints the latest run's id, account count, campaign count, and failed-account
count (accounts whose `reason` is set).

## What the Diff Engine adds

The Diff Engine compares the latest collector run against the most recent
*comparable* previous run — one matching `providerCode`, `dateMode`,
`fromDate`, and `toDate` (run-level `fromDate`/`toDate` is taken from that
run's first account snapshot). Campaigns are matched across runs by
`campaignKey` (`customerId|campaignName|account`).

Pure domain module: `compareCampaignSnapshots` in
`src/domain/services/CampaignDiffEngine.ts` takes two flattened campaign
lists (previous, latest) and returns a summary + change list. Change types:
`NEW_CAMPAIGN`, `REMOVED_CAMPAIGN`, `STATUS_CHANGED`, `BUDGET_CHANGED`,
`COST_CHANGED`, `METRIC_CHANGED` (any of impressions/interactions/conversions
differing, reported as one combined before/after JSON string per campaign).

Repository: `SnapshotRepository.getLatestRunWithCampaigns()` and
`getLatestComparableRun(latestRun)` (implemented in
`PrismaSnapshotRepository`) load and flatten the relevant runs for the
comparison.

CLI: `pnpm snapshot:diff` (`src/presentation/cli/snapshotDiff.ts`) prints the
JSON diff, or `"No comparable previous run found"` if there's no latest run
or no matching previous run.

## Known Limitation / Phase 3 Backlog

- **Diff comparison uses a representative run-level date range, not a
  per-account one.** `getLatestComparableRun` (`PrismaSnapshotRepository`)
  derives `fromDate`/`toDate` for the whole `CollectorRun` from its *first*
  `AccountSnapshot`, then requires an exact match on that single date pair to
  call a previous run "comparable". In reality, `GOOGLE_ADS_DATE_MODE=AUTO`
  (`Last 2 days`) resolves to different `fromDate`/`toDate` per account
  because each Google Ads account has its own timezone. Observed live:
  - MCC AU - USD5: `fromDate=2026-06-29`, `toDate=2026-06-30`
  - Digital Eggheads NO.: `fromDate=2026-06-28`, `toDate=2026-06-29`

  Both accounts were collected in the *same* `pnpm dev` run, so a single
  run-level date range can't correctly represent both. Today this works
  correctly when every account in a run resolves to an identical date
  window, but it may pick the wrong previous run (or fail to find one) for
  runs where accounts span different windows — `pnpm snapshot:diff` would
  then either compare against a non-comparable run's data or report
  `"No comparable previous run found"` even though a valid comparison exists
  per-account.

  **Not blocking Phase 2** — snapshot persistence, snapshot retrieval
  (`pnpm snapshot:latest`), and snapshot diffing for identical date windows
  all work correctly, collector runs are stored correctly, and live
  end-to-end verification passed.

  **Intended Phase 3 fix:** move the comparability check from
  `CollectorRun` down to `AccountSnapshot`. Instead of finding one previous
  `CollectorRun` for the whole run, find the latest previous
  `AccountSnapshot` per account, matched by `customerId` + `providerCode`
  (keyword) + `dateMode` + `fromDate` + `toDate`, and diff each account's
  campaigns against its own matched predecessor. This removes the
  single-date-range assumption entirely and makes the diff correct
  regardless of per-account timezone drift.

## What Phase 3 adds

Phase 3 syncs the latest collector snapshot from SQLite to a Google Sheets
tab via the Google Sheets API (service account auth). Scheduling, Telegram
notifications, and AI-driven analysis remain out of scope. The sync **reads
only** from SQLite — `pnpm sheets:sync` never invokes the collector itself
(requirement: no AdsPower/browser access from this command).

**Real integration test (2026-06-30), against the live spreadsheet
`1_H58WM-u-JiE2quBLettT7Rxik2sky2BvkQq9CWxb8o`, tab `Campaigns`:**
1. `pnpm sheets:sync -- --dry-run` against an empty sheet planned 5
   `APPEND`s and wrote nothing (confirmed by re-reading the sheet via the
   Sheets API — still empty).
2. `pnpm sheets:sync` created the header row and appended all 5 campaigns
   from the latest run; confirmed by reading the sheet back directly.
3. Running `pnpm sheets:sync` again with no new collector run produced
   `appendedRows: 0, updatedRows: 0, skippedRows: 5`.
4. A new collector run with exactly one campaign's `status` changed (one
   row of `NQT-MOMO-QKA-PG3-2906 #2` from `Eligible` to `Paused`) produced
   `appendedRows: 0, updatedRows: 1, skippedRows: 4`; reading the sheet back
   confirmed only that row's `status` and `lastSeenRunId` changed, all other
   rows kept their prior `lastSeenRunId`. This sandbox has no AdsPower
   client or live Google Ads browser session, so the "next collector run"
   was produced by writing directly to SQLite via the same `saveRun` path
   `pnpm dev` uses (not by actually running `pnpm dev`/AdsPower) — the
   `sheets:sync` side of the test ran for real against the live API.

New env vars:

| Variable | Default | Purpose |
|---|---|---|
| `GOOGLE_SHEETS_SPREADSHEET_ID` | _(none)_ | Target spreadsheet id; required for `pnpm sheets:sync` |
| `GOOGLE_SHEETS_CREDENTIALS_PATH` | _(none)_ | Path to a Google service account JSON key file with edit access to the spreadsheet; required for `pnpm sheets:sync` |
| `GOOGLE_SHEETS_TAB_NAME` | `Campaigns` | Sheet tab name to sync into |

Modules:

- **`SheetsClient`** (`src/infrastructure/sheets/SheetsClient.ts`) — thin
  wrapper around the `googleapis` Sheets v4 API (service-account
  `GoogleAuth`). Methods: `readSheet`, `writeHeader`, `appendRows`,
  `updateRow`. No business logic.
- **`SheetsSyncPlanner`** (`src/domain/services/SheetsSyncPlanner.ts`) — pure
  domain module. `decideRowAction(existing, incoming)` is the upsert
  decision: `APPEND` if the `campaignKey` isn't on the sheet yet, `UPDATE` if
  it exists and any data column changed, `SKIP` if it exists and every data
  column is identical (comparison ignores the trailing `lastSeenRunId` /
  `lastSeenAt` tracking columns, since those always change run-to-run).
  `planSync(existingRows, incomingRows)` applies that decision across a
  whole sheet.
- **`sheetRowMapper`** (`src/domain/services/sheetRowMapper.ts`) — pure row
  mapper. `SHEET_COLUMNS` defines the 20-column order (see below);
  `buildSheetRowValues`/`buildSheetRows` map a `SheetSyncCampaign` (+
  `runId` + `lastSeenAt`) to an ordered string array, converting `null`
  fields to `""`.
- **`SheetsSyncExecutor`** (`src/infrastructure/sheets/SheetsSyncExecutor.ts`)
  — orchestrates `SheetsClient` + `SheetsSyncPlanner`: reads the current
  sheet, plans actions, and (unless `dryRun`) writes the header if the sheet
  is empty, batch-appends new rows, and updates changed rows in place by
  their 1-based sheet row index.

Read path: `SnapshotRepository.getLatestRunForSheetsSync()` (implemented in
`PrismaSnapshotRepository`) flattens the latest `CollectorRun` into one
`SheetSyncCampaign` per `CampaignSnapshot`, carrying `providerCode`/
`dateMode` from the run and `customerId`/`accountName`/`fromDate`/`toDate`
from the owning `AccountSnapshot`.

Sheet columns, in order: `providerCode`, `dateMode`, `fromDate`, `toDate`,
`customerId`, `accountName`, `campaignKey`, `campaignName`, `account`,
`budget`, `status`, `campaignType`, `impressions`, `interactions`,
`interactionRate`, `avgCost`, `cost`, `conversions`, `lastSeenRunId`,
`lastSeenAt`.

CLI: `pnpm sheets:sync` (`src/presentation/cli/sheetsSync.ts`) loads the
latest snapshot, syncs it, and prints
`{ spreadsheetId, tabName, latestRunId, appendedRows, updatedRows, skippedRows }`.
`pnpm sheets:sync -- --dry-run` runs the same plan but skips all writes
(`SheetsClient.writeHeader`/`appendRows`/`updateRow` are never called) and
additionally prints the full list of planned actions. If
`GOOGLE_SHEETS_SPREADSHEET_ID` or `GOOGLE_SHEETS_CREDENTIALS_PATH` is unset,
the CLI prints a clear message and exits non-zero instead of calling the
Sheets API.

V1 explicitly does not delete rows or mark removed campaigns — that's
tracked below.

## Known Limitation / Phase 4 Backlog

- **Sheets sync never marks or removes campaigns that disappeared from the
  latest run.** `pnpm sheets:sync` only appends new `campaignKey`s and
  updates/skips existing ones; a campaign that was on the sheet from a prior
  run but is no longer in the latest snapshot is left as-is, with a stale
  `lastSeenRunId`/`lastSeenAt`. This is explicitly V1 scope (requirement:
  "Do not delete rows. Do not mark removed campaigns yet"). A future phase
  should cross-reference `CampaignDiffEngine`'s `REMOVED_CAMPAIGN` change
  type (already computed by the Diff Engine) to flag or visually mark those
  sheet rows instead of deleting them outright.
- **Skip comparison can leave `lastSeenRunId`/`lastSeenAt` stale.** When a
  row is `SKIP`ped because its data columns are unchanged, the sheet's
  `lastSeenRunId`/`lastSeenAt` values are *not* updated to the latest run
  (only the unchanged data columns are preserved). This trades "is this
  campaign still being seen" tracking accuracy for fewer Sheets API writes.
  A future phase could cheaply touch just those two columns on skip.

## What Phase 4 adds

Phase 4 runs the full pipeline (Collector -> Snapshot -> Sheets Sync)
automatically on an interval, reusing Phase 1–3 components as-is — no new
collector, persistence, or Sheets logic was added. Telegram notifications and
AI-driven analysis remain out of scope.

New env vars:

| Variable | Default | Purpose |
|---|---|---|
| `AGENT_SCHEDULER_ENABLED` | `false` | Master switch for the *recurring* loop. `false`: `pnpm agent:start` runs the pipeline once (if `AGENT_RUN_ON_START=true`) and exits — safe default, no background process. `true`: starts the recurring interval after the optional first run. |
| `AGENT_SCAN_INTERVAL_MINUTES` | `5` | Minutes between scheduled pipeline runs (only relevant when `AGENT_SCHEDULER_ENABLED=true`) |
| `AGENT_RUN_ON_START` | `true` | Whether to run the pipeline immediately on `agent:start`, before/without waiting for the first interval tick |

**Design decision (flagging since the spec didn't fully disambiguate):**
`AGENT_SCHEDULER_ENABLED` and `AGENT_RUN_ON_START` are independent. With the
documented defaults (`false` / `true`), `pnpm agent:start` runs the pipeline
exactly once and exits — which is also what makes `pnpm agent:start -- --dry-run`
usable as a one-shot verification command rather than a long-running process.
Setting `AGENT_SCHEDULER_ENABLED=true` is what turns it into a persistent
scheduler (`Ctrl+C`/`SIGTERM` to stop).

Pipeline order, per run: **run collector -> save snapshot -> sync latest
snapshot to Sheets**. Failure handling:
- Collector throws -> snapshot is *not* saved, Sheets sync is *not* called,
  error logged, status `COLLECTOR_FAILED`.
- Snapshot save throws -> Sheets sync is *not* called, error logged, status
  `SNAPSHOT_FAILED` (not explicitly required by the spec, added defensively
  alongside the two required failure modes).
- Sheets sync throws -> the already-saved snapshot is **not** rolled back,
  error logged, status `SHEETS_FAILED`.
- All failure modes log and return a summary; the scheduler always continues
  to the next scheduled run (failures never stop the loop).

Modules:

- **`AgentPipelineUseCase`** (`src/domain/usecases/AgentPipelineUseCase.ts`) —
  pure orchestration use case (no direct I/O — only calls the three ports
  below), implementing the failure-handling rules above and returning a
  `PipelineRunSummary`.
- **`CollectorRunner`** port (`src/domain/repositories/CollectorRunner.ts`) +
  **`GoogleAdsCollectorRunner`** (`src/infrastructure/collector/GoogleAdsCollectorRunner.ts`)
  — the exact Phase 1 collector wiring (AdsPower -> CDP -> tab detection ->
  per-tab collection), extracted out of `pnpm dev`'s CLI so both `pnpm dev`
  and `pnpm agent:start` call the same code path. `pnpm dev`'s behavior and
  stdout output are unchanged by this extraction.
- **`SheetsSyncer`** port (`src/domain/repositories/SheetsSyncer.ts`) +
  **`SnapshotSheetsSyncer`** (`src/infrastructure/sheets/SnapshotSheetsSyncer.ts`)
  — wraps the existing `SheetsClient`/`SheetsSyncExecutor`/`sheetRowMapper`
  from Phase 3 unchanged; reads the latest snapshot itself and syncs it.
- **`runGuard`** (`src/domain/services/runGuard.ts`) — pure overlap guard.
  `createRunGuard(run)` wraps an async function so a second call while the
  first is still in-flight returns `null` immediately instead of running
  concurrently.
- **`AgentScheduler`** (`src/infrastructure/scheduler/AgentScheduler.ts`) —
  thin interval driver with an injectable timer (for testability):
  `start()` runs once immediately if `runOnStart`, then registers a
  `setInterval`; `stop()` clears it.

CLI: `pnpm agent:start` / `pnpm agent:start -- --dry-run`
(`src/presentation/cli/agentStart.ts`) wires
`GoogleAdsCollectorRunner` + `PrismaSnapshotRepository` +
`SnapshotSheetsSyncer` (skipped entirely, with a warning, if
`GOOGLE_SHEETS_SPREADSHEET_ID`/`GOOGLE_SHEETS_CREDENTIALS_PATH` aren't set)
into `AgentPipelineUseCase`, wraps it in `createRunGuard`, and drives it via
`AgentScheduler`. Every run (scheduled or one-shot) logs a structured summary:
`collectorRunId`, `accounts`, `campaigns`, `failedAccounts`,
`sheetsAppendedRows`, `sheetsUpdatedRows`, `sheetsSkippedRows`, `durationMs`,
`status`, `dryRun`, and `error` (if any). `--dry-run` still runs the collector
and saves the snapshot (per the task's own recommendation), but passes
`dryRun=true` down to `SnapshotSheetsSyncer.sync`, which makes zero Sheets
API writes and only reports the planned append/update/skip counts.

**Real end-to-end verification (2026-06-30):** `pnpm agent:start -- --dry-run`
was run against the live AdsPower client and the real spreadsheet used in
the Phase 3 verification. It connected to 2 real AdsPower profiles, detected
2 Google Ads tabs, collected 5 campaigns, saved `collectorRunId: 7`, and
logged `{ accounts: 2, campaigns: 5, failedAccounts: 0, sheetsAppendedRows: 0,
sheetsUpdatedRows: 0, sheetsSkippedRows: 5, durationMs: 81795, status:
"SUCCESS" }`. Reading the spreadsheet back directly afterward confirmed it
still had only 6 rows with no `lastSeenRunId: 7` anywhere — i.e. the dry-run
truly made zero writes despite running the real collector and saving a real
snapshot.

## Known Limitation / Phase 5 Backlog

- **No retry/backoff for transient collector or Sheets failures within the
  same scheduled run.** A `COLLECTOR_FAILED` or `SHEETS_FAILED` run simply
  waits for the next scheduled tick (`AGENT_SCAN_INTERVAL_MINUTES` away);
  there's no immediate retry with backoff for transient errors (e.g. a
  single flaky AdsPower call). Acceptable for V1 since the scheduler already
  self-heals on the next tick, but worth revisiting if intervals are long.
- **`AgentScheduler` uses wall-clock `setInterval`, not a cron-like
  schedule.** Drift accumulates only in the sense that each tick is
  `intervalMs` after the previous tick fired (not after the previous run
  *finished*) — if a run takes longer than the interval, the next tick still
  fires on schedule but is skipped by `runGuard` (logged as a warning), so
  runs never overlap but can be silently skipped under sustained slow runs.

## What Phase 5 adds

Phase 5 sends a Telegram alert after each scheduled pipeline run when the
Snapshot Diff Engine detects meaningful changes since the last comparable
run. It reuses the existing Scheduler, Snapshot, Diff, and Sheets Sync
components unchanged — no Gmail watcher, no auto-accept, no auto pause/edit
of campaigns, and no local AI.

New env vars:

| Variable | Default | Purpose |
|---|---|---|
| `TELEGRAM_BOT_TOKEN` | _(none)_ | Bot token from `@BotFather`; required to send any Telegram message |
| `TELEGRAM_CHAT_ID` | _(none)_ | Target chat/user id to send alerts to |
| `TELEGRAM_NOTIFICATIONS_ENABLED` | `false` | Master switch — `pnpm agent:start` only attempts Telegram notifications when this is `true` (mirrors the `AGENT_SCHEDULER_ENABLED` pattern from Phase 4) |

Modules:

- **`TelegramMessageFormatter`** (`src/domain/services/TelegramMessageFormatter.ts`)
  — pure domain function. `formatTelegramMessage(input)` builds the alert
  text (header, change-type counts, up to 10 detail items, then
  `"...and N more changes"` if there are more), or returns `null` when
  `changes` is empty — callers must not send a message in that case. Detail
  lines show `Account: X` when the campaign has an account, falling back to
  `Customer: X` (the `customerId`) when it doesn't; `Before`/`After` lines
  are omitted entirely for `NEW_CAMPAIGN`/`REMOVED_CAMPAIGN` (both `null`).
- **`TelegramClient`** (`src/infrastructure/telegram/TelegramClient.ts`) —
  thin wrapper around the Telegram Bot API (`POST
  https://api.telegram.org/bot<token>/sendMessage`) using the global `fetch`.
  No business logic; throws on a non-OK response.
- **`TelegramNotifier`** (`src/infrastructure/telegram/TelegramNotifier.ts`)
  — implements the `Notifier` port (`src/domain/repositories/Notifier.ts`).
  `notifyLatestDiff(dryRun)` loads the latest run summary
  (`SnapshotRepository.getLatestRunSummary`) and the latest/previous
  comparable runs (`getLatestRunWithCampaigns`/`getLatestComparableRun` —
  the exact same Phase 2 Diff Engine repository methods `pnpm snapshot:diff`
  uses), runs `CampaignDiffEngine.compareCampaignSnapshots`, formats the
  message, and either sends it via `TelegramClient` (real run) or skips the
  send and reports the planned message (`dryRun`). No new repository
  methods or schema changes were needed — Phase 5 only reads what Phase 2
  already exposes.

Pipeline integration: `AgentPipelineUseCase` now takes an optional 4th
constructor argument, `notifier: Notifier | null`, called once after the
existing collector -> snapshot -> Sheets-sync steps:

- If `notifier` is `null` (Telegram disabled or not configured),
  notification is skipped entirely — same `null`-port pattern as
  `sheetsSyncer`.
- If the notifier throws, the error is caught and recorded in
  `notificationError`; the pipeline does **not** crash or fail. If the
  pipeline was otherwise `SUCCESS`, its status becomes the new
  `SUCCESS_WITH_NOTIFICATION_ERROR` value; if it was already
  `SHEETS_FAILED`, that status is preserved (not overwritten) since the
  Sheets failure is the more significant problem.
- Notification is only attempted after a successful snapshot save — a
  `COLLECTOR_FAILED`/`SNAPSHOT_FAILED` run has no new snapshot to diff, so
  no notification is attempted for those.

`PipelineRunSummary` gained `notificationStatus` (`"SENT"` | `"NO_CHANGES"` |
`"NO_COMPARABLE_RUN"` | `"DRY_RUN"` | `null`), `notificationMessage`, and
`notificationError`.

CLI:

- `pnpm telegram:test` (`src/presentation/cli/telegramTest.ts`) — sends the
  literal text `"Desktop Agent Telegram test OK"` to `TELEGRAM_CHAT_ID`.
  Exits with a clear message (non-zero) if `TELEGRAM_BOT_TOKEN`/
  `TELEGRAM_CHAT_ID` aren't set.
- `pnpm telegram:notify-latest` (`src/presentation/cli/telegramNotifyLatest.ts`)
  — loads the latest diff via `TelegramNotifier`, sends a real message if
  there are changes, and prints `{ status, changeCount }` plus the message
  body if one was sent.
- `pnpm agent:start -- --dry-run` — when `TELEGRAM_NOTIFICATIONS_ENABLED=true`
  and changes exist, prints the planned Telegram message under "Planned
  Telegram message (dry-run, not sent)" instead of sending it (mirrors the
  Sheets-sync dry-run behavior from Phase 4).

**Real integration test (2026-06-30), against a live Telegram bot/chat:**
1. `pnpm telegram:test` — sent the literal test message for real; confirmed
   delivered.
2. `pnpm telegram:notify-latest` against the then-latest run (no diff vs. its
   comparable previous run) — reported `{ status: "NO_CHANGES", changeCount: 0 }`
   and sent nothing.
3. Simulated the next collector run with exactly one campaign's `status`
   flipped (same direct-`saveRun` technique used in the Phase 3/4
   verifications, since this sandbox has no permanently-running live Google
   Ads browser session) — `pnpm snapshot:diff` showed 1 `STATUS_CHANGED`
   change, then `pnpm telegram:notify-latest` sent a real Telegram message
   matching the documented format exactly (`{ status: "SENT", changeCount: 1 }`).
4. `pnpm agent:start -- --dry-run` was run against the real, live AdsPower
   client (this sandbox does have AdsPower running) — it really collected 2
   accounts / 5 campaigns, saved a real snapshot (`collectorRunId: 15`), made
   zero Sheets writes (`sheetsAppendedRows/updatedRows: 0`), and the
   `TelegramNotifier` correctly evaluated that specific run's diff as
   `NO_CHANGES` (no message planned or sent) — proving the full real
   collector -> snapshot -> Sheets -> notifier wiring runs without crashing
   end-to-end. The "prints planned message when changes exist" branch itself
   is covered by the `AgentPipelineUseCase` dry-run unit test plus steps 1–3
   above (real send proven separately, real dry-run-skips-send already
   proven in Phase 4); live AdsPower data didn't happen to produce a diff at
   the moment this step ran.

Known limitations introduced by Phase 5 (no Telegram rate-limit retry, no
de-duplication across runs) are tracked in the consolidated "Phase 6 backlog
(exact items)" list at the end of this document, alongside the limitations
carried over from earlier phases.

## Phase 4 closure

Phase 4 is **CLOSED**. All real integration tests passed (see "Real
end-to-end verification" above), and final verification was re-run clean
before closing:

- `pnpm test` — 84/84 passing
- `pnpm build` — clean (`tsc -p tsconfig.json`)
- `npx tsc -p tsconfig.json --noEmit` — clean (no type errors)

No new features were added during closure — this pass was verification and
documentation only (this file, `README.md`, `ARCHITECTURE.md`).

**Recommended Git tag:** `v0.4.0` (Phases 1–4 complete: Collector, Snapshot
Engine + Diff Engine, Google Sheets Sync V1, Scheduler + Auto Pipeline).

## Phase 5 closure

Phase 5 is **CLOSED**. All real integration tests passed against a live
Telegram bot/chat and the live AdsPower client (see "Real integration test"
above), and final verification was re-run clean before closing:

- `pnpm test` — 94/94 passing
- `pnpm build` — clean (`tsc -p tsconfig.json`)
- `npx tsc -p tsconfig.json --noEmit` — clean (no type errors)

No features beyond the Phase 5 spec were added — Telegram notification only,
reusing the existing Scheduler, Snapshot, Diff, and Sheets Sync components
unchanged. No Gmail watcher, no auto-accept, no auto pause/edit of
campaigns, no local AI.

**Recommended Git tag:** `v0.5.0` (Phases 1–5 complete: Collector, Snapshot
Engine + Diff Engine, Google Sheets Sync V1, Scheduler + Auto Pipeline,
Telegram Notification Engine V1).

## What Phase 6 adds

Phase 6 enables the agent to receive a Google Ads Customer ID via Telegram,
find the matching invitation email in an already-open Gmail tab inside AdsPower
(via Playwright/CDP — **no Gmail API, no OAuth**), validate the customer ID
exactly, click ACCEPT INVITATION, and open the Google Ads campaigns page for
that customer.

New env vars:

| Variable | Default | Purpose |
|---|---|---|
| `GMAIL_WEB_INTAKE_ENABLED` | `false` | Master safety gate — no Gmail actions taken while `false` |
| `DEFAULT_ADSPOWER_PROFILE_ID` | _(none)_ | Preferred AdsPower profile to search Gmail in first |
| `GMAIL_SEARCH_TIMEOUT_MS` | `60000` | Timeout for the Gmail search step |
| `GMAIL_ACCEPT_TIMEOUT_MS` | `90000` | Timeout for the accept + result-page navigation |
| `TELEGRAM_BOT_USERNAME` | _(none)_ | Bot username (no `@`) for recognizing `@mention` commands |

Business flow:

1. Provider sends MCC/customer ID in the Telegram group.
2. User sends one of: `@bot 5377061556`, `@bot 537-706-1556`,
   `/accept_mcc 537-706-1556`, or `/accept_mcc` as a reply to the provider's
   message (id parsed from the replied-to text).
3. `CustomerIdParser` (`normalizeCustomerId`) normalizes any variant to
   `537-706-1556` canonical form, rejecting anything that isn't 10 digits.
4. `GmailWebSearchExecutor` iterates open AdsPower profiles via CDP, finds a
   `mail.google.com` tab (detected by `detectGmailTabIndex`), types a Gmail
   search query, and collects `GmailInvitationCandidate[]` (subject + body +
   accept URL) from matching email rows.
5. `matchInvitationCandidates` (pure) validates that exactly one candidate's
   body customer ID equals the requested normalized ID — `NO_MATCH` and
   `MULTIPLE_MATCHES` both halt the flow before any click.
6. `validateInvitationBody` (pure) parses the email body for customer ID,
   account name, access level, and rejection signals (expired/cancelled/
   already-accepted).
7. `GmailAcceptExecutor` navigates to the accept URL, detects the result page,
   and returns `ACCEPTED`, `MANUAL_ACTION_REQUIRED`, or `FAILED`.
8. `GoogleAdsOpenExecutor` opens a new tab to
   `https://ads.google.com/aw/campaigns?ocid=<digits>&__c=<digits>`.
9. `TelegramCommandListener` (long-poll `getUpdates`) sends the formatted
   `GmailIntakeResult` back to the Telegram chat.
10. Every intake attempt (including failures) is logged to the
    `gmail_invitation_intake_logs` SQLite table via
    `PrismaGmailIntakeLogRepository`.

Statuses in `gmail_invitation_intake_logs.status`:
`SEARCHING` · `MATCH_FOUND` · `ACCEPTED` · `ALREADY_ACCEPTED` ·
`EXPIRED_OR_CANCELLED` · `GMAIL_TAB_NOT_FOUND` · `GMAIL_SIGN_IN_REQUIRED` ·
`MULTIPLE_MATCHES` · `NO_MATCH` · `MANUAL_ACTION_REQUIRED` · `FAILED`

Modules:

- **`CustomerIdParser`** (`src/domain/services/customerIdParser.ts`) — pure.
  `normalizeCustomerId(raw)` finds a 10-digit Google Ads customer id anywhere
  in free text and returns it as `"537-706-1556"`, or `null` if none found.
  `customerIdToDigits` strips dashes.
- **`GmailTabDetector`** (`src/domain/services/gmailTabDetector.ts`) — pure.
  `isGmailUrl`/`detectGmailTabIndex` over a `BrowserTab[]` list — same style
  as `googleAdsTabDetector`.
- **`GmailWebSearchExecutor`** (`src/infrastructure/browser/GmailWebSearchExecutor.ts`)
  — implements `GmailInvitationSearcher`. Iterates AdsPower profiles over CDP,
  locates the Gmail tab, types a search query, opens each candidate email, and
  extracts subject/body/accept URL. Returns a `GmailSession` opaque handle.
- **`GmailInvitationMatcher`** (`src/domain/services/gmailInvitationMatcher.ts`)
  — pure. `matchInvitationCandidates` enforces the safety invariant: only
  `MATCH_FOUND` when exactly one candidate's body id equals the requested id.
- **`GmailInvitationBodyValidator`** (`src/domain/services/gmailInvitationBodyValidator.ts`)
  — pure. `validateInvitationBody` parses body fields and detects
  expired/cancelled/already-accepted signals before any accept click.
- **`GmailAcceptExecutor`** (`src/infrastructure/browser/GmailAcceptExecutor.ts`)
  — implements `GmailInvitationAccepter`. Navigates to the accept URL,
  classifies the result page, takes screenshots on non-success outcomes.
- **`GoogleAdsOpenExecutor`** (`src/infrastructure/browser/GoogleAdsOpenExecutor.ts`)
  — implements `GoogleAdsOpener`. Opens a new tab to the campaigns URL built
  by `buildGoogleAdsCampaignsUrl`.
- **`GmailIntakeUseCase`** (`src/domain/usecases/GmailIntakeUseCase.ts`)
  — orchestrates all ports. `.search()` is read-only (no accept); `.acceptInvitation()`
  runs the full flow. Gated by `enabled` flag (from `GMAIL_WEB_INTAKE_ENABLED`).
- **`PrismaGmailIntakeLogRepository`** (`src/infrastructure/db/PrismaGmailIntakeLogRepository.ts`)
  — writes every intake attempt to `gmail_invitation_intake_logs` via Prisma.
- **`TelegramCommandListener`** (`src/infrastructure/telegram/TelegramCommandListener.ts`)
  — long-polls `getUpdates`, recognizes `/accept_mcc` and `@mention` messages,
  calls `GmailIntakeUseCase.acceptInvitation`, replies with the result.
- **`telegramCommandParser`** (`src/domain/services/telegramCommandParser.ts`)
  — pure. `parseAcceptMccCommand` handles direct id, plain digits, and reply
  fallback patterns. Returns `{ customerId }` or `{ error }`.
- **`googleAdsCampaignsUrlBuilder`** (`src/domain/services/googleAdsCampaignsUrlBuilder.ts`)
  — pure. Builds `https://ads.google.com/aw/campaigns?ocid=<d>&__c=<d>`.

CLI:

- `pnpm gmail:web-search -- --mcc 537-706-1556` — read-only: search + validate
  only. Status `MATCH_FOUND` = exit 0; anything else = exit 1.
- `pnpm gmail:web-accept -- --mcc 537-706-1556` — full flow. Status `ACCEPTED`
  = exit 0; anything else = exit 1.
- `pnpm telegram:bot` — long-running listener. `Ctrl+C`/`SIGTERM` to stop.

Database (migration `20260630_phase6_gmail_intake`):

```sql
CREATE TABLE "gmail_invitation_intake_logs" (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  createdAt DATETIME DEFAULT CURRENT_TIMESTAMP,
  source TEXT NOT NULL,
  requestedCustomerId TEXT NOT NULL,
  normalizedCustomerId TEXT,
  gmailMessageSubject TEXT,
  gmailMatchedCustomerId TEXT,
  status TEXT NOT NULL,
  reason TEXT,
  acceptUrl TEXT,
  adspowerProfileId TEXT,
  screenshotPath TEXT
);
```

`pnpm test` — 130/130 passing (36 new tests across 4 new test suites:
`customerIdParser`, `telegramCommandParser`, `gmailInvitationMatcher`,
`gmailInvitationBodyValidator`).

`pnpm build` — clean.

`pnpm gmail:web-search -- --mcc 537-706-1556` with `GMAIL_WEB_INTAKE_ENABLED=false`
(default) returns `{ status: "FAILED", reason: "GMAIL_WEB_INTAKE_DISABLED",
normalizedCustomerId: "537-706-1556" }` — the ID is correctly parsed and
normalized; no browser action is taken. Set `GMAIL_WEB_INTAKE_ENABLED=true`
with AdsPower running and a Gmail tab open to run live.

Known limitations (Phase 7 backlog):

- **Gmail DOM selectors are best-effort.** Gmail's web UI changes its DOM
  structure frequently. `GmailWebSearchExecutor` uses multiple fallback
  selectors for the search input and email body, but may need tuning on a
  specific Gmail version or with non-default Gmail density settings. On
  failure, a screenshot is captured to `storage/screenshots/`.
- **Accept URL detection depends on link presence in the email.** If Gmail
  renders the ACCEPT INVITATION button as a rendered element without a direct
  href (rare), `GmailAcceptExecutor` falls back to `MANUAL_ACTION_REQUIRED`
  and leaves the tab open for manual action.
- **No retry across `MANUAL_ACTION_REQUIRED`.** The user must resolve the
  open tab manually, then re-run the command. No auto-retry or re-polling.
- **Single-chat listener.** `TelegramCommandListener` only responds to
  messages in `TELEGRAM_CHAT_ID`; multi-chat or group-specific routing is
  out of scope for V1.
- **No duplicate-request guard.** If two `/accept_mcc` commands with the same
  ID arrive concurrently, both will run concurrently; a
  `MULTIPLE_MATCHES` guard in the matcher handles the race at the email
  level, but an in-flight deduplication layer (like Phase 4's `runGuard`)
  is not yet added to the Telegram listener.

## Phase 5 closure

Phase 5 is **CLOSED**. All real integration tests passed against a live
Telegram bot/chat and the live AdsPower client (see "Real integration test"
above), and final verification was re-run clean before closing:

- `pnpm test` — 94/94 passing
- `pnpm build` — clean (`tsc -p tsconfig.json`)
- `npx tsc -p tsconfig.json --noEmit` — clean (no type errors)

No features beyond the Phase 5 spec were added — Telegram notification only,
reusing the existing Scheduler, Snapshot, Diff, and Sheets Sync components
unchanged. No Gmail watcher, no auto-accept, no auto pause/edit of
campaigns, no local AI.

**Recommended Git tag:** `v0.5.0` (Phases 1–5 complete: Collector, Snapshot
Engine + Diff Engine, Google Sheets Sync V1, Scheduler + Auto Pipeline,
Telegram Notification Engine V1).

## Phase 6 status — COMPLETED

Phase 6 implementation is complete and all unit tests pass. Live end-to-end
acceptance testing for ALREADY_ACCEPTED and ACCEPTED flows should be confirmed
with `GMAIL_WEB_INTAKE_ENABLED=true pnpm gmail:web-accept -- --mcc 362-758-7499`
before tagging `v0.6.0`.

### Build and test state

- `pnpm test` — **180/180 passing** (86 new Phase 6 tests across 7 test files)
- `pnpm build` — clean (`tsc -p tsconfig.json`, zero errors)
- `npx tsc -p tsconfig.json --noEmit` — clean (no type errors)

### What has been live-verified

The following behaviors were confirmed with `GMAIL_WEB_INTAKE_ENABLED=true` and
AdsPower running, using requested MCC `537-706-1556`:

- `pnpm gmail:web-search -- --mcc 537-706-1556` correctly finds the Gmail tab
  in AdsPower, types the search query into Gmail's search box, locates the
  invitation email row by visible-row filtering (checking both subject keyword
  and customer ID presence), opens the email, extracts the body and the ACCEPT
  INVITATION link (`acceptUrl`), and returns `{ status: "MATCH_FOUND" }`.
  Debug fields verified: `totalDomRows`, `visibleRowsCount`, `matchedRowsCount`,
  `matchedRowTextPreview`, `emailBodyTextPreview`, `bodyContainsCustomerId`,
  `acceptUrlFound`.

### What is implemented but NOT yet live-tested

- **ALREADY_ACCEPTED classification (Bugfix 3):** The accept page for
  `537-706-1556` shows:
  > "This invitation has already been accepted. Sign in to Google Ads to access
  > this account."
  Before Bugfix 3, this resulted in `{ status: "MANUAL_ACTION_REQUIRED" }`.
  After Bugfix 3, `classifyAcceptPage` detects `/invitation has already been
  accepted|already been accepted|this account has already been added/i` (checked
  before the EXPIRED_OR_CANCELLED patterns) and `GmailAcceptExecutor` returns
  `{ kind: "ALREADY_ACCEPTED", campaignsUrl, screenshotPath }`. The use case
  maps this to `{ status: "ALREADY_ACCEPTED", campaignsUrl }`.
- **campaignsUrl extraction from ocid (Bugfix 3):** The accept page URL for
  this account follows the pattern:
  `https://ads.google.com/nav/startacceptinvite?ivid=6467269090&ocid=8357912352&...`
  `extractCampaignsUrlFromAcceptPageUrl` extracts `ocid=8357912352` and returns
  `https://ads.google.com/aw/campaigns?ocid=8357912352`. Unit-tested with 5
  cases including the exact evidence URL pattern; **not yet confirmed live**.
- **ACCEPTED (green path):** A fresh invitation that hasn't been accepted yet —
  meaning `classifyAcceptPage` returns `SUCCESS` or `NEEDS_CONFIRM`. This path
  has not been exercised live because the only available test invitation was
  already accepted.

### Three bugfixes applied (all unit-tested, Bugfix 3 pending live confirmation)

**Bugfix 1 — hidden-row timeout (live-verified fixed):**
The original code iterated `rows.nth(i)` over all DOM rows including hidden
ones. Gmail hides many rows off-screen and they time out on visibility checks.
Fixed by extracting `selectVisibleMatchingRows` (pure, 14 tests):
`isVisible()` per row → only rows visible AND containing both the invitation
subject keyword AND the customer ID text are candidates → single match → open.

**Bugfix 2 — empty body after row click (live-verified fixed):**
`networkidle` fires before Gmail's SPA injects the email body into the DOM.
`normalizeCustomerId("")` returns `null` → matcher returned `NO_MATCH`.
Fixed by: (a) `waitForEmailBodyVisible()` waits for body selectors before
reading; (b) `resolveCandidateMatch` fallback path: when body reading fails but
the row preview text contains both the subject keyword and the customer ID, a
synthesized candidate is built with `candidateReason: "BODY_READ_FALLBACK_USED"`.

**Bugfix 3 — ALREADY_ACCEPTED mis-classified as MANUAL_ACTION_REQUIRED (unit-tested, pending live confirmation):**
`/already accepted/i` does not match "already **been** accepted" (missing
"been"). Fixed regex:
`/invitation has already been accepted|already been accepted|this account has already been added/i`.
Added `{ kind: "ALREADY_ACCEPTED"; campaignsUrl; screenshotPath }` as a
distinct `GmailAcceptOutcome` kind. Use case handles it separately from
`MANUAL_ACTION_REQUIRED` and returns `{ status: "ALREADY_ACCEPTED", campaignsUrl }`.
ALREADY_ACCEPTED is checked before EXPIRED_OR_CANCELLED in `classifyAcceptPage`
to prevent mis-classification when "not available" text appears on the same page.

### New pure domain services added in Phase 6 bugfixes

| Service | Tests | Description |
|---------|-------|-------------|
| `gmailRowSelector.ts` | 14 | Filters visible rows by subject keyword + customer ID; returns `{ kind, matchedIndices, visibleCount, matchedCount, firstMatchPreview }` |
| `gmailCandidateBuilder.ts` | 14 | Primary (body OK) and fallback (body failed, row preview confirms) candidate resolution |
| `gmailAcceptResultClassifier.ts` | 22 | `classifyAcceptPage` + `extractCampaignsUrlFromAcceptPageUrl`; ALREADY_ACCEPTED checked first |

### Next live test to run (next session)

```bash
GMAIL_WEB_INTAKE_ENABLED=true pnpm gmail:web-accept -- --mcc 537-706-1556
```

Expected result: `{ status: "ALREADY_ACCEPTED", campaignsUrl: "https://ads.google.com/aw/campaigns?ocid=8357912352" }`.
If the result is still `MANUAL_ACTION_REQUIRED`, add debug logging in
`GmailAcceptExecutor.classifyResultPage` to print `pageText.slice(0, 500)` and
`pageUrl` before `classifyAcceptPage` is called, then re-run to see what the
page actually contains.

**Do not tag `v0.6.0` until the ALREADY_ACCEPTED and ACCEPTED live paths are
both confirmed.**

## Phase 7 backlog (exact items)

These are the only carried-over items going into Phase 7. Everything else in
this document is historical context for *why* each exists.

1. **Per-account diff comparability.** `getLatestComparableRun`
   (`PrismaSnapshotRepository`) compares one run-level `fromDate`/`toDate`
   (taken from the run's first `AccountSnapshot`) instead of matching
   per-account. Fix: match by `customerId` + `providerCode` + `dateMode` +
   `fromDate` + `toDate` at the `AccountSnapshot` level, not the
   `CollectorRun` level. (Originally filed as Known Limitation / Phase 3
   Backlog.)
2. **Sheets sync never marks or removes campaigns that disappeared from the
   latest run.** Cross-reference `CampaignDiffEngine`'s `REMOVED_CAMPAIGN`
   change type to flag those sheet rows instead of leaving them silently
   stale. (Originally filed as Known Limitation / Phase 4 Backlog.)
3. **Sheets `SKIP` leaves `lastSeenRunId`/`lastSeenAt` stale.** When a row's
   data columns are unchanged, those two tracking columns aren't touched.
   Fix: cheaply update just those two columns on skip. (Originally filed as
   Known Limitation / Phase 4 Backlog.)
4. **No retry/backoff for transient collector or Sheets failures within a
   scheduled run.** A `COLLECTOR_FAILED`/`SHEETS_FAILED` run waits for the
   next scheduled tick rather than retrying immediately. (Originally filed
   as Known Limitation / Phase 5 Backlog — note: pre-dates and is unrelated
   to Phase 5's Telegram feature; just numbered concurrently.)
5. **`AgentScheduler` ticks on wall-clock `setInterval` from the previous
   tick, not the previous run's finish time.** A run that takes longer than
   `AGENT_SCAN_INTERVAL_MINUTES` causes the next tick to be skipped by
   `runGuard` rather than rescheduled — correct (no overlap), but means slow
   runs can silently reduce effective frequency. (Originally filed as Known
   Limitation / Phase 5 Backlog.)
6. **No Telegram rate-limit retry/backoff.** A 429 from the Telegram API is
   treated like any other notifier failure (`notificationError` set,
   `SUCCESS_WITH_NOTIFICATION_ERROR`), not retried. (New in Phase 5.)
7. **No de-duplication across runs.** Nothing prevents the same diff from
   being sent twice if `notifyLatestDiff` is invoked twice against the same
   latest/previous run pair (e.g. a manual `pnpm telegram:notify-latest`
   right after a scheduled run already sent it). (New in Phase 5.)

AI-driven analysis remains unscoped future work, not yet broken into
concrete backlog items.

## What Phase 7 adds

Phase 7 adds Telegram Orchestration V1. When `TELEGRAM_ORCHESTRATION_ENABLED=true`,
a successful `/accept_mcc` command automatically continues into the full pipeline:
Gmail intake → Collector → Snapshot → Sheets Sync → Telegram summary. No extra
command is needed. When the flag is `false` (the default), Phase 6 intake-only
behavior is fully preserved.

New env var:

| Variable | Default | Purpose |
|---|---|---|
| `TELEGRAM_ORCHESTRATION_ENABLED` | `false` | When `true`, a successful `/accept_mcc` runs the full pipeline automatically |

Pipeline trigger statuses: `ACCEPTED`, `ALREADY_ACCEPTED`. All other intake
statuses (`NO_MATCH`, `MULTIPLE_MATCHES`, `EXPIRED_OR_CANCELLED`,
`GMAIL_TAB_NOT_FOUND`, `GMAIL_SIGN_IN_REQUIRED`, `MANUAL_ACTION_REQUIRED`,
`FAILED`) stop after the intake result message.

Step-by-step Telegram messages:
1. `Searching for invitation: <id>...` — sent before intake starts.
2. `Invitation status: ACCEPTED / ALREADY_ACCEPTED` + campaigns URL + page-ready flag.
3. `Running collector...` — sent before pipeline starts.
4. `Pipeline completed ✅` with run id, accounts, campaigns, failed accounts, Sheets
   append/update/skip counts, and Diff summary (new/removed/status/budget/cost/metric changed).
   If the pipeline fails at any stage, the partial status and error are reported instead.

Safety rules enforced:
- Overlapping orchestration runs are rejected with a Telegram warning; only one run at
  a time per bot instance (backed by `createRunGuard`).
- Collector failure: reported to Telegram (`Pipeline failed ❌`); bot keeps listening.
- Sheets failure: summary is sent with the partial `SHEETS_FAILED` status; snapshot
  already saved is not rolled back.
- Telegram send failure at any step: logged, never crashes the bot or aborts the run.
- Pipeline always runs as a one-shot; `AgentScheduler` is never started from the bot.

Modules:

- **`TelegramOrchestrationUseCase`** (`src/domain/usecases/TelegramOrchestrationUseCase.ts`)
  — pure orchestration use case. Takes `GmailIntakeUseCase`, a `PipelineRunner` port
  (implemented by `AgentPipelineUseCase`), and `SnapshotRepository`. `run(customerId,
  source, onProgress?)` sequences intake → pipeline → diff computation and returns an
  `OrchestrationResult { outcome, intakeResult, pipelineResult, diffSummary, pipelineError }`.
  Progress callbacks (`onIntakeComplete`, `onPipelineStart`) allow the infrastructure
  layer to send step messages without the domain knowing about Telegram.
- **`TelegramOrchestrationFormatter`** (`src/domain/services/TelegramOrchestrationFormatter.ts`)
  — pure. `formatSearchingMessage`, `formatIntakeResultMessage`, `formatCollectingMessage`,
  `formatPipelineCompletedMessage`, `formatPipelineErrorMessage`. Tested with 12 cases.
- **`TelegramCommandOrchestrator`** (`src/infrastructure/telegram/TelegramCommandOrchestrator.ts`)
  — infrastructure adapter. Wraps `TelegramOrchestrationUseCase` with a `createRunGuard`
  overlap guard, sends step messages via `TelegramClient`, and handles per-step send errors
  without aborting the run.
- **`agentPipelineWiring`** (`src/presentation/cli/agentPipelineWiring.ts`)
  — shared factory. Builds `AgentPipelineUseCase` (with `notifier=null`) and
  `PrismaSnapshotRepository` for both `agentStart.ts` and `telegramBot.ts` without
  duplicating wiring code.

CLI:
- `pnpm telegram:bot` — extended: when `TELEGRAM_ORCHESTRATION_ENABLED=true`, wires
  the full orchestration stack; when `false`, behaves as Phase 6.
- `pnpm telegram:orchestrate -- --mcc 362-758-7499` — optional one-shot CLI that runs
  the full orchestration and sends step messages to Telegram, then exits.

Tests added: **25 new tests** across 2 new suites:
- `TelegramOrchestrationFormatter` (12 tests) — covers all format functions and edge cases.
- `TelegramOrchestrationUseCase` (13 tests) — covers disabled flag, all failing intake
  statuses, ACCEPTED/ALREADY_ACCEPTED triggers, SHEETS_FAILED reporting,
  PIPELINE_ERROR on throw, progress callback ordering, callback-error resilience,
  null diff on empty snapshot repo.

## Phase 7 stabilization pass (2026-06-30)

This pass hardened the Phase 7 implementation toward production readiness.
Changes are in-place improvements to existing modules — no new phases started.

### What changed

**BrowserTabManager** (`src/infrastructure/browser/BrowserTabManager.ts`) — new
reusable class. Classifies all browser tabs into `GMAIL | GOOGLE_ADS_CAMPAIGNS |
GOOGLE_ADS_ACCEPT | GOOGLE_SHEETS | BLANK | CHROME_INTERNAL | OTHER`, reuses
existing Campaign tabs instead of opening new ones (`getOrCreateCampaignTab`),
closes Accept tabs after a successful accept, and removes duplicate Campaign
tabs and blank/chrome tabs during cleanup. Never closes Gmail, Sheets, or the
last Campaign tab for any account.

**Campaign tab reuse** (`GoogleAdsOpenExecutor`) — now calls
`BrowserTabManager.getOrCreateCampaignTab` (Part 2). If a Campaign tab for the
same `ocid`/`customerId` is already open, it navigates that tab to the target
URL instead of opening a new one. One Campaign tab per account is maintained.

**Accept tab cleanup** (`GmailAcceptExecutor`) — after a successful
`ACCEPTED` or `ALREADY_ACCEPTED` result, the accept tab is automatically
closed (Part 3). Accept tabs are kept open only for
`MANUAL_ACTION_REQUIRED`, `SIGN_IN_REQUIRED`, and `FAILED` outcomes.

**Smarter waiting** (`GmailAcceptExecutor`) — replaced most `waitForTimeout`
fixed sleeps with `waitForFunction` + `waitForLoadState("networkidle")` +
`waitForURL` (Part 4). The accept page now waits for body text to stabilize
rather than sleeping a fixed number of ms.

**MANUAL_ACTION fix** (`GmailAcceptExecutor`) — when the accept page
returns `MANUAL_ACTION_REQUIRED` but an `ocid` can be extracted from the
accept page URL, the executor now attempts to open the campaigns page
directly. If it loads successfully, the outcome is upgraded to
`ALREADY_ACCEPTED` / `CAMPAIGNS_READY` instead of blocking on manual action
(Part 9).

**Telegram group support** (`telegramCommandParser`) — the parser now
recognizes `/accept_mcc@botname` (Telegram's group-chat command suffix) in
addition to the existing forms. The regex was updated to
`/accept_mcc(?:@\w+)?/`. Added `isCheckCommand` for `/check` /
`/check_now` / `/run_collector` (also with optional `@botname`) (Part 6).

**Telegram collector commands** (`TelegramCommandListener`, `telegramBot.ts`)
— `/check`, `/check_now`, `/run_collector` now run the Collector → Snapshot →
Sheets → Telegram summary pipeline without Gmail intake. A `collectorRunner`
callback is injected from `telegramBot.ts` (Part 10).

**Browser cleanup CLI** — two new CLI scripts (Part 11):
- `pnpm tabs:list` — lists all open tabs per profile with their type.
- `pnpm tabs:cleanup [-- --dry-run]` — closes duplicate Campaign tabs and
  blank/chrome tabs. Dry-run prints what would be closed.

### Build and test state (stabilization pass)

- `pnpm test` — **252/252 passing** (23 new tests: 14 `BrowserTabManager`
  classifier tests, 9 `telegramCommandParser` group/check tests)
- `pnpm build` — clean (`tsc -p tsconfig.json`, zero errors)

### Build and test state (Phase 7 final)

- `pnpm test` — **269/269 passing**
- `pnpm build` — clean (`tsc -p tsconfig.json`, zero errors)

### Live verification — PASSED (2026-06-30)

All of the following were confirmed against a live Telegram bot, AdsPower
client, Gmail tab, and Google Ads browser session:

1. **Telegram group command works.** `/accept_mcc 834-666-6109` sent in a
   Telegram group chat is recognized and processed correctly. The bot replies
   to the group's `chat.id`, not the private `TELEGRAM_CHAT_ID`.
2. **`/accept_mcc@botname` works.** Telegram's automatic `@botname` suffix
   on group commands (e.g. `/accept_mcc@desktop_agent_qka_bot 834-666-6109`)
   is stripped and the command handled identically to the plain form.
3. **Gmail intake works.** `GmailWebSearchExecutor` found the matching
   invitation email, `matchInvitationCandidates` validated the customer ID,
   and `GmailAcceptExecutor` navigated to the accept URL successfully.
4. **Already accepted / accepted invite opens campaigns page.** For an
   invitation already accepted, `GmailAcceptExecutor` classified the result
   as `ALREADY_ACCEPTED` and either returned the `campaignsUrl` from the
   accept page URL or (via the Part 9 upgrade) attempted the campaigns page
   directly. Campaign tab opened and confirmed ready.
5. **Collector runs automatically after intake.** After `ACCEPTED` or
   `ALREADY_ACCEPTED`, `TelegramCommandOrchestrator` triggered
   `AgentPipelineUseCase.run(false)` without any additional user command.
6. **Snapshot + Diff + Sheets sync works.** The pipeline saved a
   `CollectorRun` to SQLite, computed the diff against the previous comparable
   run, and synced the latest campaigns to Google Sheets (appended/updated
   correctly; no duplicate rows).
7. **Telegram sends pipeline summary.** After the pipeline completed,
   `TelegramCommandOrchestrator` sent the formatted completion message
   (Run id, accounts, campaigns, Sheets counts, diff counts) to the reply
   chat. Format verified matches the documented template.
8. **BrowserTabManager reuses / cleans duplicate Campaign tabs.** After the
   accept flow, `cleanupDuplicateCampaignTabs` identified any duplicate Campaign
   tabs for the same `ocid`, kept the best-scored one (highest
   `campaignTabScore`: `/aw/campaigns` path + `ocid` param), and closed the
   rest. `pnpm tabs:list` and `pnpm tabs:cleanup --dry-run` both reported
   correct type classifications.
9. **Collector / snapshot guard duplicate campaign keys.** `GoogleAdsCollectorRunner`
   deduplicated `googleAdsTabs` by `customerId` across all profiles before
   collecting. `snapshotMapper` filtered duplicate `campaignKey` within each
   account result and duplicate accounts by `customerId`. `SheetsSyncPlanner`
   deduplicated `incomingRows` by `campaignKey` before planning sync actions.
   No duplicate campaign rows appeared in the snapshot or the sheet.

## Phase 7 closure

Phase 7 is **CLOSED**. Live verification passed (2026-06-30); final build and
test state verified clean:

- `pnpm test` — **269/269 passing**
- `pnpm build` — clean (`tsc -p tsconfig.json`, zero errors)

No new features were added during closure — this pass was verification and
documentation only.

**Recommended Git tag:** `v0.7.0` (Phases 1–7 complete: Collector, Snapshot
Engine + Diff Engine, Google Sheets Sync V1, Scheduler + Auto Pipeline,
Telegram Notification Engine V1, Gmail Web Invitation Intake V1, Telegram
Orchestration V1 + Stabilization).

## Phase 8 backlog

### Unified Bot Daemon Scheduler

`pnpm telegram:bot` should also run the scheduled collector pipeline every 5
minutes, without requiring `pnpm agent:start` to be running separately. The
bot daemon becomes the single long-running process that covers both
event-driven orchestration (triggered by `/accept_mcc`) and time-driven
collection (triggered by the interval).

Concrete requirements:
- When `TELEGRAM_BOT` starts with `AGENT_SCHEDULER_ENABLED=true`, wire the
  same `AgentPipelineUseCase` + `AgentScheduler` that `agentStart.ts` uses.
- Reuse `agentPipelineWiring.ts` (already shared) — no new instances.
- `createRunGuard` must be shared between the scheduler and the orchestrator
  so a scheduled tick never overlaps with an in-flight `/accept_mcc`
  orchestration.
- After each scheduled run (not orchestration-triggered), send the
  `TelegramNotifier` diff message if there are changes — using the existing
  `TelegramNotifier` / `TelegramClient` path.
- `AGENT_SCAN_INTERVAL_MINUTES` controls the interval (default 5).
- `AGENT_RUN_ON_START` controls whether the pipeline runs immediately on
  bot start (default `true`).
- `/check` / `/check_now` / `/run_collector` commands should trigger the
  same one-shot pipeline run and share the run guard.

Backlog items carried from earlier phases (unchanged):

1. **Per-account diff comparability.** Match by `customerId` + `providerCode`
   + `dateMode` + `fromDate` + `toDate` at the `AccountSnapshot` level, not
   the `CollectorRun` level.
2. **Sheets sync never marks removed campaigns.** Cross-reference
   `CampaignDiffEngine`'s `REMOVED_CAMPAIGN` to flag those sheet rows.
3. **Sheets `SKIP` leaves `lastSeenRunId`/`lastSeenAt` stale.** Cheaply
   update just those two columns on skip.
4. **No retry/backoff for transient collector or Sheets failures within a
   scheduled run.**
5. **`AgentScheduler` ticks on wall-clock `setInterval`.** Slow runs
   silently reduce effective frequency via `runGuard` skips.
6. **No Telegram rate-limit retry/backoff.** A 429 is treated as a generic
   notifier failure.
7. **No de-duplication across runs.** Same diff can be sent twice if
   `notifyLatestDiff` is invoked twice against the same run pair.
