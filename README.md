# Desktop Agent

Node.js + TypeScript agent, organized by Clean Architecture, that connects to
browser profiles already open via AdsPower, finds Google Ads campaign tabs in
them over Chrome DevTools Protocol (CDP), and reads back a normalized JSON
snapshot of filtered campaign rows. Read-only — see [ARCHITECTURE.md](ARCHITECTURE.md)
for the hard rules (no reload, no clicks, no edits) and [PROJECT_STATUS.md](PROJECT_STATUS.md)
for what's done vs. what's next.

## Layers

- `src/domain` — entities, repository interfaces (ports), use cases, pure services. No framework dependencies.
- `src/infrastructure` — concrete adapters: AdsPower HTTP client, Playwright/CDP browser automation, Prisma client, Pino logger, env config.
- `src/presentation/cli` — CLI entry point that wires adapters into the use cases.

See [ARCHITECTURE.md](ARCHITECTURE.md) for the full module map and data flow.

## Setup

```bash
pnpm install
cp .env.example .env   # fill in ADSPOWER_API_KEY (AdsPower client -> Settings -> Advanced -> API)
pnpm prisma:migrate
```

## How to run

Requires the AdsPower desktop client running locally with profiles already
launched (so they have an active CDP `ws.puppeteer` endpoint) and at least one
open tab on a Google Ads campaigns page.

```bash
pnpm dev
```

To override the campaign-name filter keyword and date-range strategy for a
single run:

```bash
WATCH_PROVIDER_CODE=QKA GOOGLE_ADS_DATE_MODE=AUTO pnpm dev
```

Each run prints, per profile: the list of open tabs, the detected Google Ads
tabs, and finally a merged JSON array of `GoogleAdsAccountReadResult` objects
(one per Google Ads tab) under the `Google Ads campaign collection:` heading.
It also logs a minimal `ProfileScan` row (profile id/name, tab count,
timestamp) to the local SQLite database via Prisma, and writes one screenshot
per collected tab to `storage/screenshots/`.

Each run also persists a `CollectorRun` -> `AccountSnapshot` ->
`CampaignSnapshot` tree to SQLite via Prisma, so collected data survives
across runs and can be queried or diffed later. See
[PROJECT_STATUS.md](PROJECT_STATUS.md) for the schema and write-path details.

```bash
pnpm snapshot:latest   # prints the latest run's id, account/campaign counts, failed-account count
pnpm snapshot:diff     # diffs the latest run against the most recent comparable previous run
```

`pnpm snapshot:diff` compares the latest run against the most recent previous
run that matches `providerCode`, `dateMode`, `fromDate`, and `toDate`,
matching campaigns by `campaignKey` (`customerId|campaignName|account`). It
prints a JSON object with a `summary` (counts per change type) and a
`changes` array (`NEW_CAMPAIGN`, `REMOVED_CAMPAIGN`, `STATUS_CHANGED`,
`BUDGET_CHANGED`, `COST_CHANGED`, `METRIC_CHANGED`), or prints
`No comparable previous run found` if there's no matching previous run.

**Known limitation:** the comparable-run match currently uses one
`fromDate`/`toDate` per `CollectorRun` (taken from its first account), but
`GOOGLE_ADS_DATE_MODE=AUTO` can resolve to a different date window per
account depending on that account's timezone — so a single run can contain
accounts with different `fromDate`/`toDate` values. This works correctly
when all accounts in a run share the same window, but may mismatch or miss a
valid comparison otherwise. See "Known Limitation / Phase 3 Backlog" in
[PROJECT_STATUS.md](PROJECT_STATUS.md) for the intended fix (comparing
per-`AccountSnapshot` instead of per-`CollectorRun`).

## Google Sheets sync (Phase 3)

```bash
pnpm sheets:sync               # syncs the latest collector run to Google Sheets
pnpm sheets:sync -- --dry-run  # prints the planned changes only, writes nothing
```

`pnpm sheets:sync` reads only the latest snapshot already stored in SQLite —
it never invokes the collector itself. It upserts one row per
`campaignKey` into the configured Google Sheets tab: existing rows are
updated in place, new campaigns are appended, and rows whose data is
unchanged since the sheet's current values (ignoring `lastSeenRunId`/
`lastSeenAt`) are left untouched. Removed campaigns are never deleted from
the sheet in V1. Requires `GOOGLE_SHEETS_SPREADSHEET_ID` and
`GOOGLE_SHEETS_CREDENTIALS_PATH` (a Google service account JSON key file
with edit access to the target spreadsheet) to be set in `.env`; the CLI
exits with a clear message if either is missing. Prints a JSON summary:

```json
{
  "spreadsheetId": "...",
  "tabName": "Campaigns",
  "latestRunId": 4,
  "appendedRows": 0,
  "updatedRows": 0,
  "skippedRows": 0
}
```

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the sheet column layout and
module breakdown (`SheetsClient`, `SheetsSyncPlanner`, `SheetsSyncExecutor`).

## Scheduler / auto pipeline (Phase 4)

```bash
pnpm agent:start               # runs Collector -> Snapshot -> Sheets Sync once (or on an interval — see below)
pnpm agent:start -- --dry-run  # same pipeline, but Sheets sync only prints the plan and writes nothing
```

`pnpm agent:start` wires together the existing collector, snapshot
persistence, and Sheets sync into one pipeline and runs it under
`AGENT_SCHEDULER_ENABLED`/`AGENT_RUN_ON_START`/`AGENT_SCAN_INTERVAL_MINUTES`:

- With the defaults (`AGENT_SCHEDULER_ENABLED=false`, `AGENT_RUN_ON_START=true`),
  it runs the pipeline **once and exits** — useful for manual runs and for
  `--dry-run` verification.
- Set `AGENT_SCHEDULER_ENABLED=true` to keep it running and re-run the
  pipeline every `AGENT_SCAN_INTERVAL_MINUTES` minutes (`Ctrl+C`/`SIGTERM` to
  stop). Overlapping runs are prevented — if a scheduled tick fires while the
  previous run is still in progress, it's skipped with a warning, not run
  concurrently.

Every run logs a structured summary:

```json
{
  "collectorRunId": 7,
  "accounts": 2,
  "campaigns": 5,
  "failedAccounts": 0,
  "sheetsAppendedRows": 0,
  "sheetsUpdatedRows": 0,
  "sheetsSkippedRows": 5,
  "durationMs": 81795,
  "status": "SUCCESS"
}
```

Failure handling: if the collector throws, the snapshot is not saved and
Sheets sync is not called (`status: "COLLECTOR_FAILED"`); if Sheets sync
throws, the snapshot that was already saved is **not** rolled back
(`status: "SHEETS_FAILED"`). Either way the error is logged and the next
scheduled run proceeds normally. `--dry-run` still runs the collector and
saves the snapshot, but Sheets sync makes zero API writes and only reports
the planned append/update/skip counts. If `GOOGLE_SHEETS_SPREADSHEET_ID`/
`GOOGLE_SHEETS_CREDENTIALS_PATH` aren't set, the agent logs a warning and
runs collector + snapshot only, with all `sheets*Rows` reported as `0`.

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the module breakdown
(`AgentPipelineUseCase`, `CollectorRunner`/`GoogleAdsCollectorRunner`,
`SheetsSyncer`/`SnapshotSheetsSyncer`, `runGuard`, `AgentScheduler`).

## Telegram notifications (Phase 5)

```bash
pnpm telegram:test            # sends "Desktop Agent Telegram test OK" to TELEGRAM_CHAT_ID
pnpm telegram:notify-latest   # sends a real alert if the latest run's diff has changes, prints a summary either way
```

After each pipeline run, if `TELEGRAM_NOTIFICATIONS_ENABLED=true` (and
`TELEGRAM_BOT_TOKEN`/`TELEGRAM_CHAT_ID` are set), `pnpm agent:start` loads
the latest run's diff against its comparable previous run (the same Diff
Engine `pnpm snapshot:diff` uses) and sends one Telegram message
summarizing `NEW_CAMPAIGN`/`REMOVED_CAMPAIGN`/`STATUS_CHANGED`/
`BUDGET_CHANGED`/`COST_CHANGED`/`METRIC_CHANGED` changes — only if there are
any. No message is sent when there's nothing to report. The message lists
up to 10 detail items, with `"...and N more changes"` appended if there are
more:

```
🚨 Google Ads Update - QKA

Run: #12
Accounts: 2
Campaigns: 5

Changes:
- Status changed: 1
- Budget changed: 0
- Cost changed: 1
- Metric changed: 1
- New campaigns: 0
- Removed campaigns: 0

Details:
1. STATUS_CHANGED
Campaign: NQT-MOMO-QKA-PG3-2906 #2
Account: 727-700-2311
Before: Paused
After: Eligible

2. COST_CHANGED
Campaign: GG-ALEX-QKA-NGN-3006 HOTZ 1.1
Customer: 8357912352
Before: IDR0
After: IDR42,627
```

In `pnpm agent:start -- --dry-run`, the planned message is printed (under
"Planned Telegram message (dry-run, not sent)") instead of being sent. A
Telegram failure never crashes the pipeline or rolls back the snapshot/Sheets
sync that already happened — it's logged and the run's `status` becomes
`SUCCESS_WITH_NOTIFICATION_ERROR` (or stays whatever failure status it
already had, e.g. `SHEETS_FAILED`, if something else also failed in the same
run).

See [PROJECT_STATUS.md](PROJECT_STATUS.md) for the module breakdown
(`TelegramMessageFormatter`, `TelegramClient`, `TelegramNotifier`).

## Gmail Web Invitation Intake (Phase 6)

When a provider sends a Google Ads Customer ID in the Telegram group, tag the
bot or send a command and the agent will find the matching invitation email in
an already-open Gmail tab inside AdsPower, validate the customer ID, click
ACCEPT INVITATION, and open the Google Ads campaigns page.

```bash
pnpm gmail:web-search -- --mcc 537-706-1556   # find & validate, no accept
pnpm gmail:web-accept -- --mcc 537-706-1556   # full flow: search → accept → open campaigns
pnpm telegram:bot                              # long-poll listener for /accept_mcc commands
```

Accepted Telegram command forms (set `GMAIL_WEB_INTAKE_ENABLED=true` to enable):

```
/accept_mcc 537-706-1556          # direct command with id
/accept_mcc 5377061556            # plain 10-digit form
/accept_mcc@botname 537-706-1556  # group chat with @botname suffix
@bot 537-706-1556                 # @mention with id
/accept_mcc                       # reply to provider's message — id parsed from reply
@bot /accept_mcc 537-706-1556     # mention-then-command (Privacy Mode OFF group format)
```

> **Group chat note:** Telegram appends `@botname` to commands sent in group
> chats (e.g. `/accept_mcc@mybot`). The parser handles this automatically.
> For the bot to see group messages, **Privacy Mode must be OFF** in
> `@BotFather → Bot Settings → Group Privacy → Disable`.
> The bot always replies to the originating `chat.id` — responses appear in
> the same chat (group or private) that sent the command.

Collector commands (no Gmail intake — runs pipeline directly):

```
/check                            # run Collector → Snapshot → Sheets → Telegram summary
/check_now                        # same
/run_collector                    # same
```

Utility commands:

```
/whoami                           # returns the current chat.id and chat.type (useful for .env setup)
```

New env vars (all optional / safe defaults):

| Variable | Default | Purpose |
|---|---|---|
| `GMAIL_WEB_INTAKE_ENABLED` | `false` | Master safety gate — no Gmail actions taken while `false` |
| `DEFAULT_ADSPOWER_PROFILE_ID` | _(none)_ | Preferred AdsPower profile to search Gmail in first |
| `GMAIL_SEARCH_TIMEOUT_MS` | `60000` | Timeout for Gmail search operations |
| `GMAIL_ACCEPT_TIMEOUT_MS` | `90000` | Timeout for accept + result-page navigation |
| `TELEGRAM_BOT_USERNAME` | _(none)_ | Bot username (without `@`) so `@mention` commands are recognized |

`gmail:web-search` returns a JSON `GmailIntakeResult` — status `MATCH_FOUND`
on success, or one of `NO_MATCH`, `MULTIPLE_MATCHES`, `GMAIL_TAB_NOT_FOUND`,
`GMAIL_SIGN_IN_REQUIRED`, `EXPIRED_OR_CANCELLED`, `ALREADY_ACCEPTED`, or
`FAILED` with a `reason` field. The intake use case is gated:
`GMAIL_WEB_INTAKE_ENABLED=false` returns `FAILED / GMAIL_WEB_INTAKE_DISABLED`
immediately.

Safety rules enforced by the `GmailIntakeUseCase`:
- Never clicks ACCEPT INVITATION unless the email's body customer ID exactly
  matches the requested normalized ID.
- Never accepts when zero or multiple invitation emails match.
- Never accepts when the invitation body signals expired, cancelled, or
  already-accepted state.
- Never deletes or modifies emails.
- Leaves the Gmail tab open (never closes the user's browser) on
  `MANUAL_ACTION_REQUIRED` so the user can inspect it directly.
- Every intake attempt is logged to `gmail_invitation_intake_logs` (SQLite)
  with full status, reason, matched subject, and screenshot path on failure.

## Telegram Orchestration (Phase 7)

When `TELEGRAM_ORCHESTRATION_ENABLED=true`, a successful `/accept_mcc` command automatically continues into the full pipeline: Collector → Snapshot → Google Sheets Sync → Telegram summary. No extra command needed.

```bash
pnpm telegram:bot                                          # long-poll listener (Phase 6 + 7)
pnpm telegram:orchestrate -- --mcc 362-758-7499           # one-shot CLI run
```

### Browser tab management

```bash
pnpm tabs:list                    # list all open tabs per profile with type classification
pnpm tabs:cleanup -- --dry-run    # show what would be closed (duplicate campaigns + blank tabs)
pnpm tabs:cleanup                 # close duplicate campaign tabs + blank/chrome tabs safely
```

`pnpm tabs:cleanup` never closes: Gmail tabs, Google Sheets tabs, or the last remaining Campaign tab for any account. Only duplicate Campaign tabs (same `ocid`/`customerId`) and blank / `chrome://` tabs are closed.

Step-by-step Telegram output:

```
Searching for invitation: 362-758-7499...

Invitation status: ALREADY_ACCEPTED
Campaigns page ready: true
Campaigns: https://ads.google.com/aw/campaigns?ocid=...

Running collector...

Pipeline completed ✅

Run: #17
Accounts: 3
Campaigns: 5
Failed accounts: 0

Sheets:
- Appended: 0
- Updated: 1
- Skipped: 4

Diff:
- New: 0
- Removed: 0
- Status changed: 0
- Budget changed: 1
- Cost changed: 0
- Metric changed: 0
```

New env var:

| Variable | Default | Purpose |
|---|---|---|
| `TELEGRAM_ORCHESTRATION_ENABLED` | `false` | When `true`, a successful `/accept_mcc` runs the full pipeline automatically. When `false`, Phase 6 intake-only behavior is preserved. |

Safety rules:
- Only continues to the pipeline after `ACCEPTED` or `ALREADY_ACCEPTED` — all other statuses stop after Step 2.
- Overlapping orchestration runs are rejected with a Telegram warning.
- A collector failure is reported and stops the pipeline; the Telegram bot stays alive.
- A Sheets sync failure reports a partial-success summary; it does not crash the bot.
- A Telegram send failure during any step is logged but never aborts the run.
- The pipeline always runs as a one-shot (not via the `AgentScheduler`).

## Project status

Phases 1–7 are complete and live-verified. See [PROJECT_STATUS.md](PROJECT_STATUS.md)
for the full per-phase writeup, verified behaviors, known limitations, and the
Phase 8 backlog (Unified Bot Daemon Scheduler).

**Recommended tag:** `v0.7.0`

## How to run tests

```bash
pnpm test
```

Runs Node's built-in test runner (`node:test`) over every `*.test.ts` file.
All current tests are pure unit tests against domain `services/` functions
(URL/tab/date/row parsing) — no browser or network access required.

```bash
pnpm build   # type-check + compile to dist/
```

## Environment variables

See [PROJECT_STATUS.md](PROJECT_STATUS.md#current-environment-variables) for
the full table with defaults. Summary:

- `DATABASE_URL` — SQLite connection string for Prisma.
- `ADSPOWER_API_BASE_URL` / `ADSPOWER_API_KEY` — AdsPower Local API location and auth.
- `WATCH_PROVIDER_CODE` — campaign-name filter keyword (default `QKA`).
- `GOOGLE_ADS_DATE_MODE` — `TODAY` | `YESTERDAY` | `LAST_2_DAYS` | `AUTO` (default `AUTO`, resolves to `LAST_2_DAYS`).
- `GOOGLE_ADS_ACTION_DELAY_MS`, `GOOGLE_ADS_TABLE_TIMEOUT_MS`, `GOOGLE_ADS_SETTLE_DELAY_MS`, `GOOGLE_ADS_STABLE_CHECKS`, `GOOGLE_ADS_STABLE_INTERVAL_MS` — tuning knobs for how long/aggressively the collector waits for the Google Ads table to settle (matters most on slow proxies).
- `LOG_LEVEL` — Pino log level.
- `GOOGLE_SHEETS_SPREADSHEET_ID` / `GOOGLE_SHEETS_CREDENTIALS_PATH` — required only for `pnpm sheets:sync`; spreadsheet to sync into and the path to a Google service account JSON key file.
- `GOOGLE_SHEETS_TAB_NAME` — sheet tab name to sync into (default `Campaigns`).
- `AGENT_SCHEDULER_ENABLED` — `false` (default) runs `pnpm agent:start` once and exits; `true` keeps it running on an interval.
- `AGENT_SCAN_INTERVAL_MINUTES` — minutes between scheduled pipeline runs (default `5`).
- `AGENT_RUN_ON_START` — whether `pnpm agent:start` runs the pipeline immediately (default `true`).
- `TELEGRAM_BOT_TOKEN` / `TELEGRAM_CHAT_ID` — required only for `pnpm telegram:test`/`pnpm telegram:notify-latest` and for Telegram alerts from `pnpm agent:start`.
- `TELEGRAM_NOTIFICATIONS_ENABLED` — `false` (default) skips Telegram entirely from `pnpm agent:start`; `true` sends an alert after each run if the diff has changes.
- `GMAIL_WEB_INTAKE_ENABLED` — `false` (default); must be `true` for any Gmail intake action to be taken.
- `DEFAULT_ADSPOWER_PROFILE_ID` — optional; searched first when looking for an open Gmail tab.
- `GMAIL_SEARCH_TIMEOUT_MS` / `GMAIL_ACCEPT_TIMEOUT_MS` — timeouts for the Gmail search and accept steps (defaults: `60000` / `90000`).
- `TELEGRAM_BOT_USERNAME` — optional; bot username (no `@`) for recognizing `@mention` commands.
- `TELEGRAM_ORCHESTRATION_ENABLED` — `false` (default); when `true`, a successful `/accept_mcc` automatically continues into the full Collector → Snapshot → Sheets Sync → Telegram summary pipeline.

## Meaning of output fields

Each entry in the `Google Ads campaign collection:` JSON array is a
`GoogleAdsAccountReadResult`:

| Field | Meaning |
|---|---|
| `accountName` / `customerId` | Parsed from the tab's title and URL query params |
| `keyword` | The `WATCH_PROVIDER_CODE` value used for this run |
| `dateMode` | The configured `GOOGLE_ADS_DATE_MODE` (e.g. `AUTO`) |
| `googleAdsDateLabel` | Human-readable resolved label (e.g. `"Last 2 days"`) — `null` if the date range couldn't be applied |
| `fromDate` / `toDate` | ISO (`yyyy-mm-dd`) dates actually applied in the Google Ads UI |
| `refreshed` | Whether the Refresh button click was found and clicked |
| `filterChipFound` | Whether the campaign-name filter chip was confirmed applied |
| `paginationText` | Raw pagination text read from the UI (e.g. `"1 - 15 of 15"`) |
| `totalFilteredRows` | Total row count per Google Ads' own pagination text — the ground truth |
| `campaignsCollected` | Number of rows actually parsed and returned in `campaigns` |
| `campaignsMissing` | `totalFilteredRows - campaignsCollected` (should be `0` on a clean run) |
| `campaigns` | Array of `CampaignRow` — `campaignName`, `budget`, `status`, `optimizationScore`, `account`, `campaignType`, `impressions`, `interactions`, `interactionRate`, `avgCost`, `cost`, `conversions`. Any column not found is `null`, never thrown. |
| `screenshotPath` | Local path to the screenshot taken at the end of this tab's collection |
| `reason` | Set when something didn't go as planned (see Troubleshooting below); absent on a fully clean run |

## Troubleshooting

| `reason` | Meaning | What to check |
|---|---|---|
| `SEARCH_INPUT_NOT_FOUND` | Couldn't locate/open the campaign-name filter editor on this tab | Known flakiness across different Google Ads filter-bar UI states (chip / "Show N active filters" / "Add filter"). Re-running often succeeds. See `PROJECT_STATUS.md` known limitations. |
| `DATE_RANGE_NOT_APPLIED` | Couldn't open the date picker or select/confirm a date range | The collector continues safely with whatever date range was already active on the tab. Re-running often succeeds; if it persists on a specific tab, check whether that account's date-picker DOM differs (see known limitations). |
| `TABLE_NOT_READY_TIMEOUT` | The campaigns table never reported "ready" (stable row count/pagination, no loading indicators) within `GOOGLE_ADS_TABLE_TIMEOUT_MS` | Likely a genuinely slow proxy/connection — try raising `GOOGLE_ADS_TABLE_TIMEOUT_MS`, `GOOGLE_ADS_SETTLE_DELAY_MS`, or `GOOGLE_ADS_STABLE_CHECKS`. Also confirm the AdsPower profile's browser tab is actually responsive. |
| `PAGE_NOT_FOUND` | The tab that was open when profiles were listed is gone by the time the collector tried to use it | The user (or another process) closed the tab mid-run; not caused by this collector, which never closes tabs itself. |
| `COLLECT_FAILED` | An unexpected exception was thrown and caught while collecting this tab | Check the Pino warn-level log line for the underlying error; other tabs are unaffected. |

In all cases, one tab failing does not stop collection for the other detected
tabs — see `CollectGoogleAdsCampaignsUseCase`.
