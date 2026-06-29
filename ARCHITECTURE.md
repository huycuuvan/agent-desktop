# Architecture

## Module structure

```
src/
  domain/                          # No framework dependencies. Pure TypeScript.
    entities/                      # Plain data shapes
      AdsPowerProfile.ts
      BrowserTab.ts
      GoogleAdsTab.ts
      GoogleAdsDateMode.ts
      CampaignRow.ts
      GoogleAdsAccountReadResult.ts
      ProfileWithTabs.ts
      CollectorRunSnapshot.ts      # CollectorRunInput / AccountSnapshotInput / CampaignSnapshotInput / CollectorRunSummary
      CampaignDiff.ts              # CampaignChange / CampaignDiffSummary / FlatCampaignSnapshot / RunWithCampaigns
      SheetSync.ts                 # SheetSyncCampaign / LatestRunForSheetsSync
      PipelineRunSummary.ts        # PipelineStatus / PipelineRunSummary
    repositories/                  # Ports (interfaces) implemented by infrastructure
      AdsPowerProfileRepository.ts
      BrowserTabReader.ts
      GoogleAdsCampaignCollector.ts
      SnapshotRepository.ts        # save/read CollectorRun + AccountSnapshot + CampaignSnapshot trees
      CollectorRunner.ts            # collect(): GoogleAdsAccountReadResult[]
      SheetsSyncer.ts               # sync(dryRun): SheetsSyncOutcome
      Notifier.ts                   # notifyLatestDiff(dryRun): NotificationResult
    services/                      # Pure functions — fully unit-testable, no I/O
      googleAdsUrlParser.ts        # isGoogleAdsUrl, parseGoogleAdsUrl, parseAccountNameFromTitle
      googleAdsTabDetector.ts      # detectGoogleAdsTabs
      campaignRowParser.ts         # buildHeaderIndexMap, parseCampaignRow, mergeCampaignRows, parsePaginationText
      googleAdsDateRangeResolver.ts# resolveGoogleAdsDateMode, parseGoogleAdsDateRangeLabel
      campaignKeyBuilder.ts        # buildCampaignKey (customerId|campaignName|account)
      snapshotMapper.ts            # mapAccountResultToSnapshotInput, buildCollectorRunInput
      CampaignDiffEngine.ts        # compareCampaignSnapshots
      sheetRowMapper.ts            # SHEET_COLUMNS, buildSheetRowValues, buildSheetRows
      SheetsSyncPlanner.ts         # decideRowAction (APPEND/UPDATE/SKIP), planSync
      runGuard.ts                  # createRunGuard — prevents overlapping async runs
      TelegramMessageFormatter.ts  # formatTelegramMessage — builds the alert text, or null if no changes
    usecases/                      # Orchestrate ports; still no I/O of their own
      ListOpenProfilesWithTabsUseCase.ts
      CollectGoogleAdsCampaignsUseCase.ts
      AgentPipelineUseCase.ts       # collector -> snapshot -> sheets sync -> notify, with failure handling

  infrastructure/                  # Concrete adapters — Playwright, HTTP, Prisma, Sheets API, Telegram API, Pino
    adspower/
      AdsPowerProfileRepositoryImpl.ts
      adsPowerApiSchema.ts
    browser/
      CdpBrowserTabReader.ts
      RefreshExecutor.ts
      GoogleAdsDateRangeExecutor.ts
      CampaignSearchExecutor.ts
      googleAdsTableReadiness.ts    # GoogleAdsTableReadinessWaiter
      CampaignTableReader.ts
      GoogleAdsCollector.ts         # orchestrates the above per tab
    collector/
      GoogleAdsCollectorRunner.ts   # CollectorRunner impl — wires AdsPower+CDP+collector, shared by `dev` and `agent:start`
    db/
      prismaClient.ts
      PrismaSnapshotRepository.ts   # SnapshotRepository impl (SQLite via Prisma)
    sheets/
      SheetsClient.ts               # thin Google Sheets v4 API wrapper (service-account auth)
      SheetsSyncExecutor.ts         # reads sheet, plans via SheetsSyncPlanner, applies writes (or not, if dryRun)
      SnapshotSheetsSyncer.ts       # SheetsSyncer impl — reads latest snapshot, syncs it via SheetsSyncExecutor
    telegram/
      TelegramClient.ts             # thin Telegram Bot API wrapper (sendMessage via global fetch)
      TelegramNotifier.ts           # Notifier impl — loads latest diff, formats, sends (or plans, if dryRun)
    scheduler/
      AgentScheduler.ts             # interval driver (injectable timer): run-on-start + setInterval + stop
    logger/
      logger.ts
    config/
      env.ts

  presentation/
    cli/
      index.ts                     # `pnpm dev` — collector -> stdout JSON -> save snapshot
      snapshotLatest.ts            # `pnpm snapshot:latest` — latest run summary
      snapshotDiff.ts              # `pnpm snapshot:diff` — diff latest run vs. comparable previous run
      sheetsSync.ts                # `pnpm sheets:sync` [-- --dry-run] — sync latest snapshot to Google Sheets
      telegramTest.ts              # `pnpm telegram:test` — sends a literal test message
      telegramNotifyLatest.ts      # `pnpm telegram:notify-latest` — sends a real alert for the latest diff, if any
      agentStart.ts                # `pnpm agent:start` [-- --dry-run] — scheduled collector -> snapshot -> sheets -> notify pipeline
```

## Data flow

### Collector (`pnpm dev`, and the first stage of `pnpm agent:start`)

```
AdsPower Local API  --(HTTP, profile list + CDP ws endpoint)-->
  AdsPowerProfileRepositoryImpl
       |
       v
CDP (chromium.connectOverCDP) --(attaches to already-open browser)-->
  CdpBrowserTabReader            -> BrowserTab[] (title, url) per open tab
       |
       v
googleAdsTabDetector            -> filters to GoogleAdsTab[] (accountName, customerId, query)
       |
       v
GoogleAdsCollector              -> per tab, in order:
       |                            RefreshExecutor        (click Refresh)
       |                            GoogleAdsTableReadinessWaiter (wait post-refresh)
       |                            GoogleAdsDateRangeExecutor   (apply date range)
       |                            GoogleAdsTableReadinessWaiter (wait post-date-change)
       |                            CampaignSearchExecutor       (apply WATCH_PROVIDER_CODE filter)
       |                            GoogleAdsTableReadinessWaiter (wait post-filter)
       |                            CampaignTableReader          (read + scroll-merge rows)
       |                              -> campaignRowParser (pure parsing/merging)
       v
GoogleAdsAccountReadResult[]
```

`GoogleAdsCollectorRunner` (infrastructure/collector) wraps this whole chain
behind the `CollectorRunner` port, so both `index.ts` (`pnpm dev`) and
`agentStart.ts` (`pnpm agent:start`) call the exact same collection code —
no duplicated browser-automation wiring.

Each tab's full pipeline (refresh → date range → filter → read) runs inside a
single CDP connection lifecycle owned by `GoogleAdsCollector`, opened and
closed once per tab. Closing a `connectOverCDP` browser handle only
disconnects Playwright — it does not close the user's actual browser tab.

### Snapshot persistence (Phase 2)

```
GoogleAdsAccountReadResult[]  -> buildCollectorRunInput (snapshotMapper.ts)
       -> CollectorRunInput { accounts: AccountSnapshotInput[] { campaigns: CampaignSnapshotInput[] } }
       -> PrismaSnapshotRepository.saveRun
       -> SQLite: CollectorRun -> AccountSnapshot -> CampaignSnapshot
```

`campaignKeyBuilder.buildCampaignKey` (`customerId|campaignName|account`) is
the stable key used to match a campaign across runs, both in `snapshotMapper`
(write path) and `CampaignDiffEngine`/`sheetRowMapper` (read paths).

### Diff (Phase 2)

```
SnapshotRepository.getLatestRunWithCampaigns() + getLatestComparableRun()
       -> two RunWithCampaigns (flattened FlatCampaignSnapshot[])
       -> CampaignDiffEngine.compareCampaignSnapshots(previous, latest)
       -> CampaignDiffResult { summary, changes: CampaignChange[] }
```

### Google Sheets sync (Phase 3)

```
SnapshotRepository.getLatestRunForSheetsSync() -> SheetSyncCampaign[]
       -> sheetRowMapper.buildSheetRows -> SheetRowValues[] (ordered per SHEET_COLUMNS)
       -> SheetsSyncExecutor.sync:
            SheetsClient.readSheet            (current sheet state)
            SheetsSyncPlanner.planSync        (pure: APPEND / UPDATE / SKIP per campaignKey)
            SheetsClient.writeHeader/appendRows/updateRow   (skipped entirely if dryRun)
```

`SnapshotSheetsSyncer` (infrastructure/sheets) implements the `SheetsSyncer`
port around this chain, so the scheduler doesn't need to know about
`SheetsClient`/`SheetsSyncExecutor`/`sheetRowMapper` directly.

### Telegram notification (Phase 5)

```
SnapshotRepository.getLatestRunSummary()                  -> { runId, accountsCount, campaignsCount }
SnapshotRepository.getLatestRunWithCampaigns()
  + getLatestComparableRun()                              -> two RunWithCampaigns (same Phase 2 Diff Engine methods)
       -> CampaignDiffEngine.compareCampaignSnapshots      -> { summary, changes }
       -> TelegramMessageFormatter.formatTelegramMessage   -> string | null (null = no changes, don't send)
       -> TelegramClient.sendMessage                       (skipped entirely if dryRun)
```

`TelegramNotifier` (infrastructure/telegram) implements the `Notifier` port
around this chain. It adds no new repository methods or schema — it reuses
the exact `SnapshotRepository` methods the Phase 2 Diff Engine already
exposes.

### Scheduled pipeline (Phase 4, extended in Phase 5)

```
AgentScheduler.start()  -- run-on-start? --> runGuard-wrapped run --> setInterval(run, intervalMs)
       |
       v
createRunGuard(run)     -- skips a tick if the previous run is still in-flight, never runs concurrently
       |
       v
AgentPipelineUseCase.run(dryRun):
       1. CollectorRunner.collect()              -> on throw: status COLLECTOR_FAILED, stop here
       2. SnapshotRepository.saveRun(...)        -> on throw: status SNAPSHOT_FAILED, stop here
       3. SheetsSyncer.sync(dryRun)               -> on throw: status SHEETS_FAILED (snapshot already saved, not rolled back)
       4. Notifier.notifyLatestDiff(dryRun)       -> on throw: notificationError set; status becomes
                                                      SUCCESS_WITH_NOTIFICATION_ERROR only if it was SUCCESS
                                                      (a prior SHEETS_FAILED is preserved, not overwritten)
       -> PipelineRunSummary { collectorRunId, accounts, campaigns, failedAccounts,
                                sheetsAppendedRows/updatedRows/skippedRows,
                                notificationStatus, notificationMessage, durationMs, status }
```

`agentStart.ts` wires `GoogleAdsCollectorRunner` + `PrismaSnapshotRepository`
+ `SnapshotSheetsSyncer` (or `null` if Sheets env vars are unset) +
`TelegramNotifier` (or `null` if `TELEGRAM_NOTIFICATIONS_ENABLED` is `false`
or its env vars are unset) into `AgentPipelineUseCase`, then drives it via
`createRunGuard` + `AgentScheduler`. No new collector, persistence, Sheets,
or diff logic exists in Phase 5 — it only adds notification on top of
Phase 1–4 components.

## Main modules

| Module | Responsibility |
|---|---|
| **AdsPower client** (`AdsPowerProfileRepositoryImpl`) | Calls the AdsPower Local API to list currently-open profiles and their CDP `ws.puppeteer` endpoints |
| **Browser tab reader** (`CdpBrowserTabReader`) | Connects over CDP, enumerates open tabs (title + URL) per profile |
| **Google Ads tab detector** (`googleAdsTabDetector` + `googleAdsUrlParser`) | Pure functions: identify `ads.google.com` tabs, extract `accountName`/`customerId` from title/URL |
| **RefreshExecutor** | Clicks the Google Ads UI's own Refresh icon/button. Never reloads the page. |
| **GoogleAdsDateRangeExecutor** | Opens the Google Ads date-range picker, selects a preset or types "N days up to today", reads back the applied label/from/to dates |
| **CampaignSearchExecutor** | Opens the campaign-name filter editor (existing chip, "Show N active filters", or "Add filter" flow) and applies `WATCH_PROVIDER_CODE` |
| **GoogleAdsTableReadiness** (`GoogleAdsTableReadinessWaiter`) | Polls for filter-chip/table visibility, absence of loading/skeleton indicators, and row-count/pagination stability before declaring the table ready; used after refresh, date-range, and filter actions |
| **CampaignTableReader** | Reads column headers + visible campaign rows; scrolls Google Ads' virtualized list (`scrollIntoViewIfNeeded`, never a click) and merges newly-revealed rows by a stable key until the full filtered count is collected, no new rows appear, or it times out |
| **CampaignRowParser** (`campaignRowParser.ts`) | Pure functions: maps header text to column index, extracts/cleans each `CampaignRow` field, builds the stable merge key, parses pagination text |
| **GoogleAdsCollector** | Orchestrates one tab's full pipeline (the modules above, in order) and assembles the final `GoogleAdsAccountReadResult` |
| **GoogleAdsCollectorRunner** | `CollectorRunner` port impl; wraps AdsPower listing + per-tab collection across all profiles, shared by `pnpm dev` and `pnpm agent:start` |
| **PrismaSnapshotRepository** | `SnapshotRepository` port impl; persists/reads `CollectorRun`/`AccountSnapshot`/`CampaignSnapshot` via Prisma/SQLite |
| **CampaignDiffEngine** | Pure: compares two flattened campaign snapshots by `campaignKey`, returns categorized changes |
| **SheetsClient** | Thin Google Sheets v4 API wrapper (service-account `GoogleAuth`): read/write-header/append/update, no business logic |
| **SheetsSyncPlanner** | Pure: decides APPEND/UPDATE/SKIP per `campaignKey`, ignoring the `lastSeenRunId`/`lastSeenAt` tracking columns |
| **SheetsSyncExecutor** | Orchestrates `SheetsClient` + `SheetsSyncPlanner`; no-op writes when `dryRun` |
| **SnapshotSheetsSyncer** | `SheetsSyncer` port impl; reads the latest snapshot itself and syncs it via `SheetsSyncExecutor` |
| **runGuard** | Pure: wraps an async function so overlapping invocations are skipped, never run concurrently |
| **AgentScheduler** | Drives a run function on an interval (injectable timer for tests); optional run-on-start |
| **TelegramMessageFormatter** | Pure: builds the alert text from a diff summary/changes, or returns `null` when there are no changes |
| **TelegramClient** | Thin Telegram Bot API wrapper (`sendMessage` via global `fetch`); no business logic |
| **TelegramNotifier** | `Notifier` port impl; loads the latest diff via existing `SnapshotRepository`/`CampaignDiffEngine` and sends (or plans, if `dryRun`) the formatted message |
| **AgentPipelineUseCase** | Orchestrates `CollectorRunner` -> `SnapshotRepository` -> `SheetsSyncer` -> `Notifier` with the failure-handling rules described above |

## Rules

These are load-bearing constraints for the browser-automation layer
(established in Phase 1, still in force):

- **No `page.reload()`.** Refresh always goes through Google Ads' own UI
  Refresh control (`RefreshExecutor`), never a hard page reload.
- **No campaign row clicks.** Rows are only scrolled into view
  (`scrollIntoViewIfNeeded`) and read; nothing inside a row is ever clicked.
- **No edits.** The only write-type interactions anywhere in the collector
  pipeline are: clicking Refresh, selecting a date-range preset/typing a day
  count, and typing into the campaign-name filter box. No campaign, ad group,
  ad, or account setting is ever changed.
- **Read-only collector.** The collector's job ends at producing
  `GoogleAdsAccountReadResult[]` in memory. It never writes to Google Ads,
  Google Sheets, or any external system itself — persistence (SQLite) and
  Sheets sync are separate stages downstream, never inside the
  browser-automation layer.

Constraints added by later phases:

- **Sheets sync is upsert-only (Phase 3 V1).** `SheetsSyncPlanner`/
  `SheetsSyncExecutor` only append or update rows by `campaignKey`; they
  never delete a row or mark a campaign as removed.
- **The scheduler never runs the pipeline concurrently with itself.**
  `AgentPipelineUseCase` runs are always wrapped in `createRunGuard`; a
  scheduled tick that fires while a run is still in-flight is skipped (with
  a warning), never executed in parallel.
- **A pipeline failure never stops the schedule.** `COLLECTOR_FAILED`,
  `SNAPSHOT_FAILED`, and `SHEETS_FAILED` are all logged and returned as a
  summary; `AgentScheduler` always proceeds to the next scheduled tick.
- **A Telegram failure never crashes the pipeline or rolls back work
  already done (Phase 5).** `TelegramNotifier` errors are caught by
  `AgentPipelineUseCase` and recorded as `notificationError`; the snapshot
  and any completed Sheets sync are unaffected.
- **No message is ever sent when there are no changes (Phase 5).**
  `TelegramMessageFormatter.formatTelegramMessage` returns `null` for an
  empty change set, and both `TelegramNotifier` and the CLIs treat `null` as
  "do not call `TelegramClient.sendMessage`".
