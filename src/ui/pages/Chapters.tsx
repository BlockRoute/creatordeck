import { useEffect, useState } from 'react';
import { applyChapters, formatChapters, parseChapters, validateChapters, type Chapter } from '../../core/chapters';
import { formatClock, parseClock } from '../../core/text';
import { loadVideoInsight } from '../../services/video';
import { updateVideoSnippet } from '../../yt/api';
import { useConnection } from '../channel';
import { Button, Card, CopyButton, Field, Loading, Notice, Page, errorMessage, useRoute, useToast } from '../kit';
import { VideoInput } from './Video';

interface Row {
  time: string;
  title: string;
}

function toRows(chapters: Chapter[]): Row[] {
  return chapters.map((c) => ({ time: formatClock(c.seconds), title: c.title }));
}

function toChapters(rows: Row[]): Chapter[] {
  return rows.filter((r) => parseClock(r.time) !== null).map((r) => ({ seconds: parseClock(r.time) as number, title: r.title }));
}

export function ChaptersPage() {
  const route = useRoute();
  const videoId = route.parts[1] ?? '';
  const { connected } = useConnection();
  const [description, setDescription] = useState('');
  const [duration, setDuration] = useState<number | null>(null);
  const [rows, setRows] = useState<Row[]>([
    { time: '0:00', title: 'Intro' },
    { time: '', title: '' },
    { time: '', title: '' },
  ]);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  useEffect(() => {
    if (!videoId) return;
    let live = true;
    setLoading(true);
    loadVideoInsight(videoId)
      .then((v) => {
        if (!live) return;
        setDescription(v.description);
        setDuration(v.lengthSeconds);
        const found = parseChapters(v.description);
        if (found.length) setRows(toRows(found));
      })
      .catch((error) => toast(errorMessage(error), 'bad'))
      .finally(() => live && setLoading(false));
    return () => {
      live = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [videoId]);

  const chapters = toChapters(rows);
  const badTimes = rows.filter((r) => r.time.trim() && parseClock(r.time) === null).length;
  const problems = [...(badTimes ? [`${badTimes} timestamp${badTimes === 1 ? ' is' : 's are'} not in m:ss or h:mm:ss form.`] : []), ...validateChapters(chapters, duration)];
  const block = formatChapters(chapters);
  const merged = applyChapters(description, chapters);
  const set = (i: number, patch: Partial<Row>) => setRows((all) => all.map((r, j) => (j === i ? { ...r, ...patch } : r)));

  return (
    <Page title="Chapter Editor" subtitle="Write chapter timestamps that meet YouTube's rules, then drop them into the description.">
      <Card title="Load a video" hint="Optional. Loads its description and any chapters already in it.">
        <VideoInput base="/chapters" />
      </Card>
      {loading ? <Loading label="Loading the description" /> : null}
      <div className="grid c2" style={{ alignItems: 'start' }}>
        <Card
          title="Chapters"
          hint={duration !== null ? `Video length ${formatClock(duration)}` : undefined}
          actions={
            <>
              <Button variant="small" onClick={() => setRows((all) => [...all, { time: '', title: '' }])}>
                Add chapter
              </Button>
              <Button variant="small" onClick={() => setRows(toRows([...chapters].sort((a, b) => a.seconds - b.seconds)))}>
                Sort by time
              </Button>
            </>
          }
        >
          {rows.map((row, i) => (
            <div key={i} className="row">
              <input style={{ width: 96 }} value={row.time} placeholder="0:00" aria-label={`Chapter ${i + 1} time`} onChange={(e) => set(i, { time: e.target.value })} />
              <div className="grow">
                <input value={row.title} placeholder="Chapter title" aria-label={`Chapter ${i + 1} title`} onChange={(e) => set(i, { title: e.target.value })} />
              </div>
              <Button variant="ghost" aria-label={`Remove chapter ${i + 1}`} onClick={() => setRows((all) => all.filter((_, j) => j !== i))}>
                ✕
              </Button>
            </div>
          ))}
          {problems.length ? (
            <Notice tone="warn">
              <ul style={{ margin: 0, paddingLeft: 18 }}>
                {problems.map((p) => (
                  <li key={p}>{p}</li>
                ))}
              </ul>
            </Notice>
          ) : (
            <Notice tone="good">These chapters meet YouTube's rules.</Notice>
          )}
        </Card>
        <div className="stack">
          <Card title="Chapter block" actions={<CopyButton text={block} label="Copy block" />}>
            <pre className="pre mono notice">{block || 'Add timestamps to see the block.'}</pre>
          </Card>
          <Card
            title="Description with chapters"
            hint="Existing chapter lines are replaced in place; otherwise the block is added at the end."
            actions={
              <>
                <CopyButton text={merged} label="Copy description" />
                {videoId && connected ? (
                  <Button
                    variant="primary"
                    busy={saving}
                    disabled={problems.length > 0}
                    onClick={() => {
                      setSaving(true);
                      updateVideoSnippet(videoId, { description: merged })
                        .then(() => {
                          setDescription(merged);
                          toast('Chapters saved to YouTube.', 'good');
                        })
                        .catch((error) => toast(errorMessage(error), 'bad'))
                        .finally(() => setSaving(false));
                    }}
                  >
                    Save to YouTube
                  </Button>
                ) : null}
              </>
            }
          >
            <Field label="Description">
              <textarea value={description} onChange={(e) => setDescription(e.target.value)} rows={6} aria-label="Description" />
            </Field>
            <pre className="pre mono notice" style={{ maxHeight: 260, overflow: 'auto' }}>
              {merged}
            </pre>
          </Card>
        </div>
      </div>
    </Page>
  );
}
