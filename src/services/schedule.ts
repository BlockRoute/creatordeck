import { getStore, setStore } from '../shared/storage';
import { KEYS, type Alert, type VideoMeta } from '../shared/types';
import { updateVideoSnippet, updateVideoStatus, type SnippetChange } from '../yt/api';
import { pushAlerts } from './channel';

export interface ScheduledJob {
  id: string;
  videoId: string;
  videoTitle: string;
  at: number;
  kind: 'metadata' | 'publish' | 'sunset';
  title?: string;
  description?: string;
  tags?: string[];
  privacyStatus?: 'public' | 'unlisted' | 'private';
  publishAt?: string;
  done: boolean;
  error?: string;
  ranAt?: number;
}

export interface UploadProfile {
  id: string;
  name: string;
  descriptionSuffix: string;
  tags: string[];
  categoryId: string;
}

function dedupeTags(tags: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const tag of tags) {
    const trimmed = tag.trim();
    const key = trimmed.toLowerCase();
    if (!trimmed || seen.has(key)) continue;
    seen.add(key);
    out.push(trimmed);
  }
  return out;
}

/** Description suffix and tags from a profile, without duplicating a suffix already present. */
export function profileChange(video: Pick<VideoMeta, 'description' | 'tags'>, profile: UploadProfile): SnippetChange {
  const suffix = profile.descriptionSuffix.trim();
  const description = suffix && !video.description.includes(suffix) ? (video.description ? `${video.description}\n\n${suffix}` : suffix) : video.description;
  return {
    description,
    tags: dedupeTags([...video.tags, ...profile.tags]),
    ...(profile.categoryId ? { categoryId: profile.categoryId } : {}),
  };
}

async function runJob(job: ScheduledJob, now: number): Promise<void> {
  switch (job.kind) {
    case 'metadata':
      await updateVideoSnippet(job.videoId, {
        ...(job.title != null ? { title: job.title } : {}),
        ...(job.description != null ? { description: job.description } : {}),
        ...(job.tags != null ? { tags: job.tags } : {}),
      });
      return;
    case 'publish': {
      const when = job.publishAt ?? new Date(job.at).toISOString();
      if (Date.parse(when) > now + 60_000) await updateVideoStatus(job.videoId, { privacyStatus: 'private', publishAt: when });
      else await updateVideoStatus(job.videoId, { privacyStatus: 'public', publishAt: null });
      return;
    }
    case 'sunset':
      await updateVideoStatus(job.videoId, { privacyStatus: job.privacyStatus ?? 'unlisted', publishAt: null });
      return;
    default: {
      const exhaustive: never = job.kind;
      throw new Error(exhaustive);
    }
  }
}

/** Applies every job whose time has passed. A failed job waits six hours before the next attempt. */
export async function runDueSchedules(now = Date.now()): Promise<number> {
  const jobs = await getStore<ScheduledJob[]>(KEYS.schedules, []);
  const alerts: Alert[] = [];
  let ran = 0;
  for (const job of jobs) {
    if (job.done || job.at > now) continue;
    if (job.error && job.ranAt && now - job.ranAt < 6 * 3_600_000) continue;
    try {
      await runJob(job, now);
      job.done = true;
      job.error = undefined;
      job.ranAt = now;
      alerts.push({ id: `sched-${job.id}`, kind: 'schedule', title: 'Scheduled change applied', body: job.videoTitle, at: now });
    } catch (error) {
      job.error = error instanceof Error ? error.message : String(error);
      job.ranAt = now;
    }
    ran += 1;
  }
  await setStore(KEYS.schedules, jobs);
  await pushAlerts(alerts);
  return ran;
}
