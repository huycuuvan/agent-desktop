import type { AdsPowerProfile } from "../entities/AdsPowerProfile.js";

export interface AdsPowerProfileRepository {
  listOpenProfiles(): Promise<AdsPowerProfile[]>;
}
