import type { EditableVideo } from '../core/findReplace';
import { uid } from '../core/text';
import { getStore, updateStore } from '../shared/storage';
import { KEYS, type VideoMeta } from '../shared/types';
import { ApiError, updateVideoSnippet } from '../yt/api';

export interface Backup {
  id: string;
  createdAt: number;
  reason: string;
  channelId: string;
  /** Full metadata for a manual backup; just the videos about to change for an automatic one. */
  videos: BackupVideo[];
}

export interface BackupVideo extends EditableVideo {
  categoryId: string;
  privacyStatus: string;
  publishedAt: string;
}

export function toBackupVideo(v: VideoMeta): BackupVideo {
  return { id: v.id, title: v.title, description: v.description, tags: v.tags, categoryId: v.categoryId, privacyStatus: v.privacyStatus, publishedAt: v.publishedAt };
}

const MAX_BACKUPS = 12;

export async function saveBackup(reason: string, channelId: string, videos: VideoMeta[]): Promise<Backup> {
  const backup: Backup = { id: uid(), createdAt: Date.now(), reason, channelId, videos: videos.map(toBackupVideo) };
  await updateStore<Backup[]>(KEYS.backups, [], (all) => [backup, ...all].slice(0, MAX_BACKUPS));
  return backup;
}

export async function listBackups(): Promise<Backup[]> {
  return getStore<Backup[]>(KEYS.backups, []);
}

export interface ApplyResult {
  id: string;
  ok: boolean;
  error?: string;
}

/**
 * Writes metadata changes one video at a time. Stops at the first quota error, since every
 * later call would fail the same way; other errors are recorded and the run continues.
 */
export async function applyChanges(
  changes: { id: string; after: EditableVideo }[],
  onProgress?: (done: number, results: ApplyResult[]) => void,
  shouldStop?: () => boolean,
): Promise<ApplyResult[]> {
  const results: ApplyResult[] = [];
  for (const change of changes) {
    if (shouldStop?.()) break;
    try {
      await updateVideoSnippet(change.id, { title: change.after.title, description: change.after.description, tags: change.after.tags });
      results.push({ id: change.id, ok: true });
    } catch (error) {
      results.push({ id: change.id, ok: false, error: error instanceof Error ? error.message : String(error) });
      if (error instanceof ApiError && error.reason === 'quotaExceeded') {
        onProgress?.(results.length, results);
        break;
      }
    }
    onProgress?.(results.length, results);
  }
  return results;
}

/** The videos whose current metadata differs from a backup, as changes that would restore it. */
export function diffAgainstBackup(current: VideoMeta[], backup: Backup): { id: string; before: EditableVideo; after: EditableVideo }[] {
  const byId = new Map(current.map((v) => [v.id, v]));
  const out: { id: string; before: EditableVideo; after: EditableVideo }[] = [];
  for (const saved of backup.videos) {
    const now = byId.get(saved.id);
    if (!now) continue;
    if (now.title === saved.title && now.description === saved.description && now.tags.join('\u0001') === saved.tags.join('\u0001')) continue;
    out.push({
      id: saved.id,
      before: { id: now.id, title: now.title, description: now.description, tags: now.tags },
      after: { id: saved.id, title: saved.title, description: saved.description, tags: saved.tags },
    });
  }
  return out;
}
