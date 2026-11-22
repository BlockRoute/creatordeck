export const DAILY_QUOTA = 10000;

/** Unit cost per YouTube Data API method, from Google's published quota table. */
const COSTS: Record<string, number> = {
  'GET channels': 1,
  'GET videos': 1,
  'GET playlists': 1,
  'GET playlistItems': 1,
  'GET commentThreads': 1,
  'GET comments': 1,
  'GET captions': 50,
  'GET videoCategories': 1,
  'GET search': 100,
  'PUT videos': 50,
  'POST playlistItems': 50,
  'PUT playlistItems': 50,
  'DELETE playlistItems': 50,
  'POST playlists': 50,
  'POST comments': 50,
  'POST commentThreads': 50,
  'DELETE comments': 50,
  'POST comments/setModerationStatus': 50,
  'POST thumbnails/set': 50,
};

export function quotaCost(method: string, resource: string): number {
  return COSTS[`${method.toUpperCase()} ${resource}`] ?? (method.toUpperCase() === 'GET' ? 1 : 50);
}

export interface QuotaState {
  /** Pacific-time date the counter belongs to; the quota resets at midnight Pacific. */
  day: string;
  used: number;
}

export function pacificDay(now: Date = new Date()): string {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Los_Angeles', year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  return parts;
}

export function addQuota(state: QuotaState | null, cost: number, now: Date = new Date()): QuotaState {
  const day = pacificDay(now);
  return state && state.day === day ? { day, used: state.used + cost } : { day, used: cost };
}

export function quotaRemaining(state: QuotaState | null, now: Date = new Date(), limit = DAILY_QUOTA): number {
  if (!state || state.day !== pacificDay(now)) return limit;
  return Math.max(0, limit - state.used);
}
