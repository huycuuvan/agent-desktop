export interface GoogleAdsQueryParams {
  ocid?: string;
  uscid?: string;
  ascid?: string;
  __c?: string;
  __u?: string;
}

export interface GoogleAdsTab {
  profileId: string;
  tabIndex: number;
  title: string;
  url: string;
  accountName?: string;
  customerId?: string;
  query: GoogleAdsQueryParams;
}
