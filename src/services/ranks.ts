import { getStore, setStore } from '../shared/storage';
import { KEYS } from '../shared/types';
import { isoDay } from '../yt/analytics';
import { findRank } from './research';

export interface RankPoint {
  date: string;
  position: number | null;
}

export interface RankTrack {
  id: string;
  query: string;
  videoId: string;
  label: string;
  history: RankPoint[];
}

/** Records today's position for tracks that do not already have a point today. Stops after `limit` lookups. */
export async function checkRanks(limit = 15, depth = 20): Promise<number> {
  const tracks = await getStore<RankTrack[]>(KEYS.rankTracks, []);
  const today = isoDay(new Date());
  let checked = 0;
  for (const track of tracks) {
    if (checked >= limit) break;
    if (track.history.some((point) => point.date === today)) continue;
    const result = await findRank(track.query, { videoId: track.videoId }, depth);
    track.history = [...track.history, { date: today, position: result.position }].slice(-120);
    checked += 1;
  }
  await setStore(KEYS.rankTracks, tracks);
  return checked;
}
