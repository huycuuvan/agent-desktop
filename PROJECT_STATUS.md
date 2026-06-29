# Project Status

**Project:** Desktop Agent
**Phase 1 (Desktop Collector):** COMPLETED
**Phase 2 (Snapshot Engine):** COMPLETED
**Phase 3 (Google Sheets Sync Engine V1):** COMPLETED
**Phase 4 (Scheduler + Auto Pipeline):** COMPLETED
**Phase 5 (Telegram Notification Engine V1):** COMPLETED
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

## Phase 6 backlog (exact items)

These are the only carried-over items going into Phase 6. Everything else in
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
