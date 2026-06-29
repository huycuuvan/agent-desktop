import type { AdsPowerProfileRepository } from "../repositories/AdsPowerProfileRepository.js";
import type { BrowserTabReader } from "../repositories/BrowserTabReader.js";
import type { ProfileWithTabs } from "../entities/ProfileWithTabs.js";

export class ListOpenProfilesWithTabsUseCase {
  constructor(
    private readonly profileRepository: AdsPowerProfileRepository,
    private readonly tabReader: BrowserTabReader,
  ) {}

  async execute(): Promise<ProfileWithTabs[]> {
    const profiles = await this.profileRepository.listOpenProfiles();

    const results: ProfileWithTabs[] = [];
    for (const profile of profiles) {
      const tabs = await this.tabReader.listOpenTabs(profile);
      results.push({ profile, tabs });
    }
    return results;
  }
}
