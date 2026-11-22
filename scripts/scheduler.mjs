import { readFile } from 'node:fs/promises';

const configPath = process.argv[2] ?? 'creatordeck-scheduler.json';
const config = JSON.parse(await readFile(configPath, 'utf8'));

const tokenResponse = await fetch('https://oauth2.googleapis.com/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    client_id: config.clientId,
    client_secret: config.clientSecret,
    refresh_token: config.refreshToken,
    grant_type: 'refresh_token',
  }),
});
const tokenJson = await tokenResponse.json();
if (!tokenResponse.ok) {
  console.error(tokenJson);
  process.exit(1);
}
const token = tokenJson.access_token;

async function api(path, options = {}) {
  const response = await fetch(`https://www.googleapis.com/youtube/v3/${path}`, {
    ...options,
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...(options.headers ?? {}) },
  });
  const json = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(json.error?.message ?? `YouTube returned ${response.status}`);
  return json;
}

const now = Date.now();
let ran = 0;
for (const job of config.jobs ?? []) {
  if (job.done || job.at > now) continue;
  const current = (await api(`videos?part=snippet,status&id=${encodeURIComponent(job.videoId)}`)).items?.[0];
  if (!current) {
    console.error(`Missing ${job.videoId}`);
    continue;
  }
  if (job.kind === 'metadata') {
    const snippet = {
      title: job.title ?? current.snippet.title,
      description: job.description ?? current.snippet.description ?? '',
      tags: job.tags ?? current.snippet.tags ?? [],
      categoryId: current.snippet.categoryId,
    };
    await api('videos?part=snippet', { method: 'PUT', body: JSON.stringify({ id: job.videoId, snippet }) });
  } else if (job.kind === 'publish') {
    const when = job.publishAt ?? new Date(job.at).toISOString();
    const status = { ...current.status, privacyStatus: Date.parse(when) > now + 60_000 ? 'private' : 'public' };
    if (status.privacyStatus === 'private') status.publishAt = when;
    else delete status.publishAt;
    await api('videos?part=status', { method: 'PUT', body: JSON.stringify({ id: job.videoId, status }) });
  } else if (job.kind === 'sunset') {
    const status = { ...current.status, privacyStatus: job.privacyStatus ?? 'unlisted' };
    delete status.publishAt;
    await api('videos?part=status', { method: 'PUT', body: JSON.stringify({ id: job.videoId, status }) });
  }
  console.log(`Applied ${job.kind} to ${job.videoTitle ?? job.videoId}`);
  ran += 1;
}
console.log(ran ? `Applied ${ran} job${ran === 1 ? '' : 's'}.` : 'Nothing was due.');
