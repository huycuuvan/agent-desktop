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
    repositories/                  # Ports (interfaces) implemented by infrastructure
      AdsPowerProfileRepository.ts
      BrowserTabReader.ts
      GoogleAdsCampaignCollector.ts
    services/                      # Pure functions — fully unit-testable, no I/O
      googleAdsUrlParser.ts        # isGoogleAdsUrl, parseGoogleAdsUrl, parseAccountNameFromTitle
      googleAdsTabDetector.ts      # detectGoogleAdsTabs
      campaignRowParser.ts         # buildHeaderIndexMap, parseCampaignRow, mergeCampaignRows, parsePaginationText
      googleAdsDateRangeResolver.ts# resolveGoogleAdsDateMode, parseGoogleAdsDateRangeLabel
    usecases/                      # Orchestrate ports; still no I/O of their own
      ListOpenProfilesWithTabsUseCase.ts
      CollectGoogleAdsCampaignsUseCase.ts

  infrastructure/                  # Concrete adapters — Playwright, HTTP, Prisma, Pino
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
    db/
      prismaClient.ts
    logger/
      logger.ts
    config/
      env.ts

  presentation/
    cli/
      index.ts                     # wires everything, prints JSON to stdout
```

## Data flow

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
GoogleAdsAccountReadResult[]     -> JSON.stringify -> stdout (CLI)
```

Each tab's full pipeline (refresh → date range → filter → read) runs inside a
single CDP connection lifecycle owned by `GoogleAdsCollector`, opened and
closed once per tab. Closing a `connectOverCDP` browser handle only
disconnects Playwright — it does not close the user's actual browser tab.

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

## Rules

These are load-bearing constraints for Phase 1 and should hold for any future
phase that touches the browser-automation layer:

- **No `page.reload()`.** Refresh always goes through Google Ads' own UI
  Refresh control (`RefreshExecutor`), never a hard page reload.
- **No campaign row clicks.** Rows are only scrolled into view
  (`scrollIntoViewIfNeeded`) and read; nothing inside a row is ever clicked.
- **No edits.** The only write-type interactions anywhere in the pipeline are:
  clicking Refresh, selecting a date-range preset/typing a day count, and
  typing into the campaign-name filter box. No campaign, ad group, ad, or
  account setting is ever changed.
- **Read-only collector.** Phase 1's job ends at producing JSON in memory /
  stdout. It does not write to SQLite (beyond a minimal traceability log row),
  Google Sheets, or any external system — that begins in Phase 2.
