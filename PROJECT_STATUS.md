# Project Status

**Project:** Desktop Agent
**Phase 1 (Desktop Collector):** COMPLETED
**Phase 2 (Snapshot Engine):** COMPLETED
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

## Next phase

**Phase 3** — Google Sheets export, scheduling, Telegram notifications, and
AI-driven analysis remain future phases, to be scoped individually. The
per-account diff comparability fix described above (Known Limitation /
Phase 3 Backlog) is also tracked for this phase.
