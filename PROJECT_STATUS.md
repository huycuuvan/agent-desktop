# Project Status

**Project:** Desktop Agent
**Phase 1 (Desktop Collector):** COMPLETED
**Date:** 2026-06-29

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

## Next phase

**Phase 2: Storage Layer** — persist each `GoogleAdsAccountReadResult` /
`CampaignRow[]` snapshot durably (SQLite via the existing Prisma setup) so
collected data survives across runs and can be queried/diffed over time.
Google Sheets export, scheduling, Telegram notifications, and any AI-driven
analysis are explicitly out of scope until later phases.
