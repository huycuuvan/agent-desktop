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
