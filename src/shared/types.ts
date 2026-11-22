export type LlmProvider = 'openai' | 'anthropic' | 'xai' | 'openrouter' | 'gemini' | 'custom';

export interface DevOverrides {
  /** Test-only: replaces https://www.googleapis.com/youtube/v3 */
  dataBase?: string;
  uploadBase?: string;
  analyticsBase?: string;
  reportingBase?: string;
  /** Test-only: skips OAuth and uses this bearer token. */
  token?: string;
}

export interface Settings {
  oauthClientId: string;
  oauthClientSecret: string;
  region: string;
  language: string;
  rpmLow: number;
  rpmHigh: number;
  llmProvider: LlmProvider;
  llmBaseUrl: string;
  llmApiKey: string;
  llmModel: string;
  showLauncher: boolean;
  dev?: DevOverrides;
}

export const DEFAULT_SETTINGS: Settings = {
  oauthClientId: '',
  oauthClientSecret: '',
  region: 'US',
  language: 'en',
  rpmLow: 1.5,
  rpmHigh: 6,
  llmProvider: 'openai',
  llmBaseUrl: '',
  llmApiKey: '',
  llmModel: '',
  showLauncher: true,
};

export interface VideoMeta {
  id: string;
  title: string;
  description: string;
  tags: string[];
  categoryId: string;
  defaultLanguage?: string;
  privacyStatus: string;
  publishAt?: string;
  publishedAt: string;
  duration: string;
  thumbnail: string;
  viewCount: number;
  likeCount: number;
  commentCount: number;
  madeForKids?: boolean;
  hasCaptions?: boolean;
}

export interface ChannelInfo {
  id: string;
  title: string;
  handle?: string;
  thumbnail?: string;
  uploadsPlaylistId: string;
  subscriberCount: number;
  viewCount: number;
  videoCount: number;
}

export interface TagList {
  id: string;
  name: string;
  tags: string[];
  updatedAt: number;
}

export interface CannedResponse {
  id: string;
  name: string;
  text: string;
}

export interface TrackedChannel {
  id: string;
  title: string;
  handle?: string;
  thumbnail?: string;
  addedAt: number;
  isSelf?: boolean;
}

export interface ChannelSnapshot {
  date: string;
  subscribers: number | null;
  views: number | null;
  videos: number | null;
}

export interface Alert {
  id: string;
  kind: 'upload' | 'brand' | 'abtest' | 'schedule' | 'system';
  title: string;
  body: string;
  url?: string;
  at: number;
  read?: boolean;
}

export const KEYS = {
  settings: 'settings',
  auth: 'auth',
  channel: 'channel',
  videos: 'videos',
  quota: 'quota',
  tagLists: 'tagLists',
  canned: 'cannedResponses',
  tracked: 'trackedChannels',
  snapshots: 'channelSnapshots',
  seenUploads: 'seenUploads',
  alerts: 'alerts',
  brandTerms: 'brandTerms',
  backups: 'backups',
  abTests: 'abTests',
  reachData: 'reachData',
  reporting: 'reporting',
  schedules: 'schedules',
  profiles: 'uploadProfiles',
  rankTracks: 'rankTracks',
  seoDrafts: 'seoDrafts',
  jobState: 'jobState',
  keywordHistory: 'keywordHistory',
} as const;
