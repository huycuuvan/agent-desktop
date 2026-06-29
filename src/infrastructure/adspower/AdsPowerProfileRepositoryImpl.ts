import type { AdsPowerProfileRepository } from "../../domain/repositories/AdsPowerProfileRepository.js";
import type { AdsPowerProfile } from "../../domain/entities/AdsPowerProfile.js";
import { adsPowerLocalActiveResponseSchema } from "./adsPowerApiSchema.js";
import { logger } from "../logger/logger.js";

export class AdsPowerProfileRepositoryImpl implements AdsPowerProfileRepository {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey?: string,
  ) {}

  async listOpenProfiles(): Promise<AdsPowerProfile[]> {
    const url = new URL("/api/v1/browser/local-active", this.baseUrl);
    url.searchParams.set("page_size", "100");

    const response = await fetch(url, {
      headers: this.apiKey ? { Authorization: `Bearer ${this.apiKey}` } : undefined,
    });
    if (!response.ok) {
      throw new Error(`AdsPower API request failed with status ${response.status}`);
    }

    const json = await response.json();
    const parsed = adsPowerLocalActiveResponseSchema.parse(json);

    if (parsed.code !== 0 || !parsed.data) {
      throw new Error(`AdsPower API returned error: ${parsed.msg ?? "unknown error"}`);
    }

    return parsed.data.list.map((item) => {
      logger.debug({ profileId: item.user_id }, "Discovered open AdsPower profile");
      return {
        profileId: item.user_id,
        profileName: item.name || item.user_id,
        wsEndpoint: item.ws.puppeteer,
        debugPort: item.debug_port,
      };
    });
  }
}
