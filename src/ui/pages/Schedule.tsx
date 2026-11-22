import { useState } from 'react';
import { uid } from '../../core/text';
import { profileChange, type ScheduledJob, type UploadProfile } from '../../services/schedule';
import { saveBackup } from '../../services/bulk';
import { KEYS, type VideoMeta } from '../../shared/types';
import { getStore } from '../../shared/storage';
import { updateVideoSnippet } from '../../yt/api';
import type { AuthState } from '../../yt/oauth';
import { getSettings } from '../../shared/settings';
import { ConnectGate, LibraryGate, QuotaWarning, useConnection } from '../channel';
import { Button, Card, Empty, Field, Notice, Page, Table, downloadFile, errorMessage, useStore, useToast } from '../kit';

export function SchedulePage() {
  return (
    <ConnectGate>
      <LibraryGate>{(library) => <Scheduler videos={library.items} />}</LibraryGate>
    </ConnectGate>
  );
}

function localInput(epoch: number): string {
  const date = new Date(epoch);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
}

function Scheduler({ videos }: { videos: VideoMeta[] }) {
  const [jobs, setJobs] = useStore<ScheduledJob[]>(KEYS.schedules, []);
  const [profiles, setProfiles] = useStore<UploadProfile[]>(KEYS.profiles, []);
  const [videoId, setVideoId] = useState(videos[0]?.id ?? '');
  const [kind, setKind] = useState<ScheduledJob['kind']>('metadata');
  const [when, setWhen] = useState(localInput(Date.now() + 86_400_000));
  const [title, setTitle] = useState('');
  const [description, setDescription] = useState('');
  const [tags, setTags] = useState('');
  const [privacy, setPrivacy] = useState<'public' | 'unlisted' | 'private'>('unlisted');
  const [profile, setProfile] = useState<UploadProfile>({ id: '', name: '', descriptionSuffix: '', tags: [], categoryId: '' });
  const [picked, setPicked] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const { channel } = useConnection();
  const video = videos.find((v) => v.id === videoId);

  const add = () => {
    if (!video) return toast('Pick a video.', 'warn');
    const at = new Date(when).getTime();
    if (Number.isNaN(at)) return toast('Pick a date and time.', 'warn');
    const job: ScheduledJob = {
      id: uid(),
      videoId: video.id,
      videoTitle: video.title,
      at,
      kind,
      done: false,
      ...(kind === 'metadata' ? { title: title || undefined, description: description || undefined, tags: tags ? tags.split(',').map((t) => t.trim()).filter(Boolean) : undefined } : {}),
      ...(kind === 'publish' ? { publishAt: new Date(at).toISOString() } : {}),
      ...(kind === 'sunset' ? { privacyStatus: privacy } : {}),
    };
    setJobs((list) => [...list, job].sort((a, b) => a.at - b.at));
    toast('Scheduled. It runs while Chrome is open, and catches up the next time Chrome starts if that time already passed.', 'good');
  };

  const saveProfile = () => {
    if (!profile.name.trim()) return toast('Name the profile.', 'warn');
    const next = { ...profile, id: profile.id || uid(), tags: profile.tags.map((t) => t.trim()).filter(Boolean) };
    setProfiles((list) => [next, ...list.filter((p) => p.id !== next.id)]);
    setProfile({ id: '', name: '', descriptionSuffix: '', tags: [], categoryId: '' });
    toast('Profile saved.', 'good');
  };

  const applyProfile = async (item: UploadProfile) => {
    const chosen = videos.filter((v) => picked.includes(v.id));
    if (!chosen.length) return toast('Select at least one video.', 'warn');
    setBusy(true);
    try {
      await saveBackup(`Before profile ${item.name}`, channel?.id ?? '', chosen);
      let ok = 0;
      for (const current of chosen) {
        await updateVideoSnippet(current.id, profileChange(current, item));
        ok += 1;
      }
      toast(`Applied “${item.name}” to ${ok} video${ok === 1 ? '' : 's'}. A backup was saved first.`, 'good');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const exportScheduler = async () => {
    const [settings, auth] = await Promise.all([getSettings(), getStore<AuthState | null>(KEYS.auth, null)]);
    if (!settings.oauthClientId || !auth?.refreshToken) return toast('Connect with a client secret first, so the desktop scheduler has a refresh token.', 'warn');
    downloadFile(
      'creatordeck-scheduler.json',
      JSON.stringify(
        {
          clientId: settings.oauthClientId,
          clientSecret: settings.oauthClientSecret,
          refreshToken: auth.refreshToken,
          jobs: jobs.filter((job) => !job.done),
        },
        null,
        2,
      ),
      'application/json',
    );
    toast('Downloaded. That file contains a refresh token. Keep it private, and run node scripts/scheduler.mjs with it.', 'warn');
  };

  return (
    <Page title="Schedule" subtitle="Queue a metadata edit, a publish time, or a sunset. Chrome applies them with alarms. A desktop script can do the same when the browser is closed." actions={<Button onClick={() => void exportScheduler()}>Export desktop scheduler</Button>}>
      <Notice>Jobs run only while Chrome is open. If a time is missed, the next startup applies it. A publish time that has already passed makes the video public instead of scheduling it in the past.</Notice>
      <Card title="New job">
        <div className="grid c2">
          <Field label="Video">
            <select value={videoId} onChange={(e) => setVideoId(e.target.value)}>
              {videos.map((v) => <option key={v.id} value={v.id}>{v.title}</option>)}
            </select>
          </Field>
          <Field label="When">
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} />
          </Field>
        </div>
        <Field label="Action">
          <select value={kind} onChange={(e) => setKind(e.target.value as ScheduledJob['kind'])}>
            <option value="metadata">Update title, description or tags</option>
            <option value="publish">Publish at this time</option>
            <option value="sunset">Change visibility (sunset)</option>
          </select>
        </Field>
        {kind === 'metadata' ? (
          <>
            <Field label="New title" hint="leave blank to keep the current title"><input value={title} onChange={(e) => setTitle(e.target.value)} /></Field>
            <Field label="New description" hint="leave blank to keep the current description"><textarea rows={4} value={description} onChange={(e) => setDescription(e.target.value)} /></Field>
            <Field label="New tags" hint="comma separated; leave blank to keep current tags"><input value={tags} onChange={(e) => setTags(e.target.value)} /></Field>
          </>
        ) : null}
        {kind === 'sunset' ? (
          <Field label="New visibility">
            <select value={privacy} onChange={(e) => setPrivacy(e.target.value as typeof privacy)}>
              <option value="unlisted">Unlisted</option>
              <option value="private">Private</option>
              <option value="public">Public</option>
            </select>
          </Field>
        ) : null}
        <QuotaWarning cost={kind === 'metadata' ? 51 : 51} />
        <div className="row end"><Button variant="primary" onClick={add}>Schedule</Button></div>
      </Card>
      <Card title="Queue">
        {jobs.length ? (
          <Table
            rows={jobs}
            rowKey={(job) => job.id}
            columns={[
              { key: 'when', label: 'When', render: (job) => new Date(job.at).toLocaleString() },
              { key: 'video', label: 'Video', render: (job) => job.videoTitle },
              { key: 'kind', label: 'Action', render: (job) => job.kind },
              { key: 'state', label: 'State', render: (job) => (job.done ? 'Done' : job.error ? job.error : 'Waiting') },
              { key: 'x', label: '', render: (job) => <Button variant="ghost" onClick={() => setJobs((list) => list.filter((item) => item.id !== job.id))}>Remove</Button> },
            ]}
          />
        ) : (
          <Empty title="Nothing scheduled" />
        )}
      </Card>
      <Card title="Upload profiles" hint="A profile adds a description block and tags to videos you pick. It cannot intercept YouTube's upload dialog.">
        <Field label="Name"><input value={profile.name} onChange={(e) => setProfile({ ...profile, name: e.target.value })} /></Field>
        <Field label="Description to append"><textarea rows={3} value={profile.descriptionSuffix} onChange={(e) => setProfile({ ...profile, descriptionSuffix: e.target.value })} /></Field>
        <Field label="Tags to add" hint="comma separated"><input value={profile.tags.join(', ')} onChange={(e) => setProfile({ ...profile, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} /></Field>
        <Field label="Category ID" hint="optional, for example 22 for People & Blogs"><input value={profile.categoryId} onChange={(e) => setProfile({ ...profile, categoryId: e.target.value })} /></Field>
        <div className="row end"><Button onClick={saveProfile}>Save profile</Button></div>
        {profiles.map((item) => (
          <div key={item.id} className="row between">
            <div>
              <strong>{item.name}</strong>
              <div className="muted small">{item.tags.join(', ') || 'No extra tags'}</div>
            </div>
            <div className="row">
              <Button variant="small" onClick={() => setProfile(item)}>Edit</Button>
              <Button variant="small" busy={busy} onClick={() => void applyProfile(item)}>Apply to selected</Button>
              <Button variant="ghost" onClick={() => setProfiles((list) => list.filter((p) => p.id !== item.id))}>Delete</Button>
            </div>
          </div>
        ))}
        <Field label="Videos" hint="used by Apply">
          <div className="stack" style={{ maxHeight: 220, overflow: 'auto' }}>
            {videos.slice(0, 80).map((v) => (
              <label key={v.id} className="row">
                <input type="checkbox" checked={picked.includes(v.id)} onChange={() => setPicked((list) => (list.includes(v.id) ? list.filter((id) => id !== v.id) : [...list, v.id]))} />
                {v.title}
              </label>
            ))}
          </div>
        </Field>
      </Card>
    </Page>
  );
}
