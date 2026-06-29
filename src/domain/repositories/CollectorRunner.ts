import type { GoogleAdsAccountReadResult } from "../entities/GoogleAdsAccountReadResult.js";

export interface CollectorRunner {
  collect(): Promise<GoogleAdsAccountReadResult[]>;
}
