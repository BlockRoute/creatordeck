import { useState } from 'react';
import { auditBestPractices, practiceSummary } from '../../core/bestPractices';
import { auditMonetization } from '../../core/demonetization';
import { analyzeLanguages } from '../../core/language';
import { inferKeyword, scoreSeo } from '../../core/seo';
import { formatClock, formatCompact } from '../../core/text';
import { findRank } from '../../services/research';
import { loadVideoInsight, type VideoInsight } from '../../services/video';
import { parseVideoId } from '../../yt/innertube';
import { Button, Card, CopyButton, Empty, Field, Gauge, Loading, Notice, Page, Pill, Stat, Table, Tabs, errorMessage, navigate, useAsync, useRoute, useToast } from '../kit';

export function VideoInput({ base, placeholder = 'Paste a YouTube video link or ID' }: { base: string; placeholder?: string }) {
  const [value, setValue] = useState('');
  const toast = useToast();
  return (
    <form
      className="row"
      onSubmit={(e) => {
        e.preventDefault();
        const id = parseVideoId(value);
        if (!id) toast('That does not look like a YouTube video link or ID.', 'bad');
        else navigate(`${base}/${id}`);
      }}
    >
      <div className="grow">
        <input value={value} onChange={(e) => setValue(e.target.value)} placeholder={placeholder} aria-label="Video link or ID" />
      </div>
      <Button variant="primary" type="submit">
        Analyse
      </Button>
    </form>
  );
}

function pct(value: number | null): string {
  return value === null ? '–' : `${(value * 100).toFixed(2)}%`;
}

export function SeoChecks({ checks }: { checks: { id: string; label: string; score: number; tip: string }[] }) {
  return (
    <div>
      {checks.map((c) => (
        <div key={c.id} className="check-row">
          <span className={`dot ${c.score >= 0.99 ? 'pass' : c.score > 0 ? 'part' : 'fail'}`} />
          <div>
            <div>{c.label}</div>
            {c.score < 0.99 ? <div className="small muted">{c.tip}</div> : null}
          </div>
        </div>
      ))}
    </div>
  );
}

function Overview({ v }: { v: VideoInsight }) {
  const keyword = inferKeyword(v.title, v.tags ?? []);
  const seo = scoreSeo({ title: v.title, description: v.description, tags: v.tags ?? [], keyword });
  const practices = auditBestPractices({
    title: v.title,
    description: v.description,
    tags: v.tags,
    durationSeconds: v.lengthSeconds,
    hasHdThumbnail: v.hasHdThumbnail,
    hasCaptions: v.hasCaptions,
    hasEndScreen: v.hasEndScreen,
    hasCards: v.hasCards,
  });
  const summary = practiceSummary(practices);
  const risk = auditMonetization({ title: v.title, description: v.description, tags: v.tags ?? [] });
  const languages = analyzeLanguages({ title: v.title, description: v.description, tags: v.tags ?? [] });
  return (
    <>
      <div className="grid c4">
        <Card>
          <Stat label="Views" value={formatCompact(v.viewCount)} hint={v.viewsPerDay !== null ? `${formatCompact(v.viewsPerDay)} a day` : undefined} />
        </Card>
        <Card>
          <Stat label="Likes" value={formatCompact(v.likeCount)} hint={v.likeCount !== null && v.viewCount ? `${pct(v.likeCount / v.viewCount)} of views` : undefined} />
        </Card>
        <Card>
          <Stat label="Comments" value={formatCompact(v.commentCount)} hint={`Engagement ${pct(v.engagementRate)}`} />
        </Card>
        <Card>
          <Stat
            label="Published"
            value={v.publishDate ? new Date(v.publishDate).toLocaleDateString() : '–'}
            hint={[v.lengthSeconds !== null ? formatClock(v.lengthSeconds) : null, v.category].filter(Boolean).join(' · ')}
          />
        </Card>
      </div>
      <div className="grid c2">
        <Card title="SEO score" hint={keyword ? `Scored against the inferred keyword "${keyword}"` : 'No keyword could be inferred, so only general checks apply'}>
          <div className="row" style={{ alignItems: 'flex-start', gap: 18 }}>
            <Gauge value={seo.score} label="out of 100" />
            <div className="grow">
              <SeoChecks checks={seo.checks} />
            </div>
          </div>
          <a href={`#/seo/${v.videoId}`}>Open in SEO Studio</a>
        </Card>
        <Card title="Best practices" hint={`${summary.passed} passed · ${summary.failed} to fix${summary.unknown ? ` · ${summary.unknown} could not be read` : ''}`}>
          <div>
            {practices.map((p) => (
              <div key={p.id} className="check-row">
                <span className={`dot ${p.status === 'pass' ? 'pass' : p.status === 'fail' ? 'fail' : ''}`} />
                <div>
                  <div>{p.label}</div>
                  <div className="small muted">{p.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </Card>
      </div>
      <div className="grid c2">
        <Card
          title="Advertiser-friendliness check"
          hint="Flags words in the title, description and tags that often limit ads. A guide, not YouTube's verdict."
          actions={<Pill tone={risk.rating === 'green' ? 'good' : risk.rating === 'yellow' ? 'warn' : 'bad'}>{risk.rating === 'green' ? 'Nothing flagged' : risk.rating === 'yellow' ? 'Review' : 'High risk'}</Pill>}
        >
          {risk.hits.length ? (
            <Table
              rows={risk.hits}
              rowKey={(h) => `${h.field}-${h.term}`}
              columns={[
                { key: 't', label: 'Term', render: (h) => h.term },
                { key: 'c', label: 'Category', render: (h) => h.category },
                { key: 'f', label: 'Found in', render: (h) => h.field },
                { key: 'l', label: 'Risk', render: (h) => <Pill tone={h.level === 'high' ? 'bad' : 'warn'}>{h.level}</Pill> },
              ]}
            />
          ) : (
            <div className="muted small">No flagged terms found.</div>
          )}
        </Card>
        <Card title="Language" hint="Detected from the text. Mixed languages can confuse who YouTube shows the video to.">
          <div className="row">
            <Pill>Title: {languages.title.language}</Pill>
            <Pill>Description: {languages.description.language}</Pill>
            <Pill>Tags: {languages.tags.language}</Pill>
            <Pill tone={languages.consistent ? 'good' : 'warn'}>{languages.consistent ? 'Consistent' : 'Mixed'}</Pill>
          </div>
        </Card>
      </div>
    </>
  );
}

interface RankRow {
  tag: string;
  position: number | null;
  checked: number;
}

function TagsTab({ v }: { v: VideoInsight }) {
  const [ranks, setRanks] = useState<RankRow[]>([]);
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  if (v.tags === null) {
    return (
      <Notice tone="warn">
        YouTube did not expose this video's tags to CreatorDeck just now. Tags are only present in the watch page's player data, which YouTube withholds when it suspects automation. Open the video in a
        normal tab and try again, or connect your channel in Settings so the official API can supply them.
      </Notice>
    );
  }
  const run = async () => {
    setBusy(true);
    setRanks([]);
    try {
      for (const tag of (v.tags ?? []).slice(0, 25)) {
        const rank = await findRank(tag, { videoId: v.videoId }, 20);
        setRanks((list) => [...list, { tag, position: rank.position, checked: rank.checked }]);
      }
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };
  const rankOf = (tag: string) => ranks.find((r) => r.tag === tag);
  return (
    <Card
      title={`${v.tags.length} tags`}
      hint={`Read from the ${v.tagsSource}.`}
      actions={
        <>
          <CopyButton text={v.tags.join(', ')} label="Copy all tags" />
          <Button variant="small" busy={busy} onClick={() => void run()} disabled={!v.tags.length}>
            Check search rank per tag
          </Button>
        </>
      }
    >
      {v.tags.length ? (
        <div className="chips">
          {v.tags.map((tag) => {
            const rank = rankOf(tag);
            return (
              <span key={tag} className="chip">
                {tag}
                {rank ? <Pill tone={rank.position ? 'good' : undefined}>{rank.position ? `#${rank.position}` : `>${rank.checked}`}</Pill> : null}
                <a href={`#/keywords?q=${encodeURIComponent(tag)}`} title="Explore keyword">
                  ↗
                </a>
              </span>
            );
          })}
        </div>
      ) : (
        <div className="muted small">This video has no tags.</div>
      )}
      {ranks.length ? <div className="small muted">Rank = where this video appears in the first 20 signed-out search results for that tag.</div> : null}
    </Card>
  );
}

function CompareTab({ v }: { v: VideoInsight }) {
  const [other, setOther] = useState<VideoInsight | null>(null);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();
  const load = async () => {
    const id = parseVideoId(input);
    if (!id) return toast('Paste a valid video link or ID.', 'bad');
    setBusy(true);
    try {
      setOther(await loadVideoInsight(id));
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };
  const rows: { label: string; a: string; b: string }[] = other
    ? [
        { label: 'Title', a: v.title, b: other.title },
        { label: 'Views', a: formatCompact(v.viewCount), b: formatCompact(other.viewCount) },
        { label: 'Views a day', a: formatCompact(v.viewsPerDay), b: formatCompact(other.viewsPerDay) },
        { label: 'Likes', a: formatCompact(v.likeCount), b: formatCompact(other.likeCount) },
        { label: 'Comments', a: formatCompact(v.commentCount), b: formatCompact(other.commentCount) },
        { label: 'Engagement', a: pct(v.engagementRate), b: pct(other.engagementRate) },
        { label: 'Length', a: v.lengthSeconds !== null ? formatClock(v.lengthSeconds) : '–', b: other.lengthSeconds !== null ? formatClock(other.lengthSeconds) : '–' },
        { label: 'Tags', a: v.tags === null ? 'unavailable' : String(v.tags.length), b: other.tags === null ? 'unavailable' : String(other.tags.length) },
        { label: 'Description length', a: `${v.description.length} chars`, b: `${other.description.length} chars` },
      ]
    : [];
  return (
    <Card title="Compare with another video">
      <div className="row">
        <div className="grow">
          <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Paste the other video's link or ID" aria-label="Video to compare" />
        </div>
        <Button variant="primary" busy={busy} onClick={() => void load()}>
          Compare
        </Button>
      </div>
      {other ? (
        <Table
          rows={rows}
          rowKey={(r) => r.label}
          columns={[
            { key: 'l', label: '', render: (r) => <span className="muted">{r.label}</span> },
            { key: 'a', label: 'This video', render: (r) => r.a },
            { key: 'b', label: 'Other video', render: (r) => r.b },
          ]}
        />
      ) : null}
    </Card>
  );
}

function EmbedTab({ videoId }: { videoId: string }) {
  const [o, setO] = useState({ start: '', end: '', autoplay: false, loop: false, controls: true, privacy: true, responsive: true, mute: false });
  const params = new URLSearchParams();
  if (o.start) params.set('start', o.start);
  if (o.end) params.set('end', o.end);
  if (o.autoplay) params.set('autoplay', '1');
  if (o.mute) params.set('mute', '1');
  if (o.loop) {
    params.set('loop', '1');
    params.set('playlist', videoId);
  }
  if (!o.controls) params.set('controls', '0');
  const src = `https://www.${o.privacy ? 'youtube-nocookie' : 'youtube'}.com/embed/${videoId}${params.toString() ? `?${params}` : ''}`;
  const iframe = `<iframe src="${src}" title="YouTube video player" frameborder="0" allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture; web-share" allowfullscreen${
    o.responsive ? ' style="position:absolute;inset:0;width:100%;height:100%"' : ' width="560" height="315"'
  }></iframe>`;
  const code = o.responsive ? `<div style="position:relative;padding-bottom:56.25%;height:0;overflow:hidden">${iframe}</div>` : iframe;
  const toggle = (key: 'autoplay' | 'loop' | 'controls' | 'privacy' | 'responsive' | 'mute', label: string) => (
    <label className="check">
      <input type="checkbox" checked={o[key]} onChange={(e) => setO({ ...o, [key]: e.target.checked })} /> {label}
    </label>
  );
  return (
    <Card title="Advanced embed" actions={<CopyButton text={code} label="Copy embed code" />}>
      <div className="grid c2">
        <Field label="Start at" hint="seconds">
          <input value={o.start} onChange={(e) => setO({ ...o, start: e.target.value.replace(/\D/g, '') })} />
        </Field>
        <Field label="End at" hint="seconds">
          <input value={o.end} onChange={(e) => setO({ ...o, end: e.target.value.replace(/\D/g, '') })} />
        </Field>
      </div>
      <div className="row">
        {toggle('responsive', 'Responsive 16:9')}
        {toggle('privacy', 'Privacy-enhanced (no cookies until play)')}
        {toggle('controls', 'Show controls')}
        {toggle('autoplay', 'Autoplay')}
        {toggle('mute', 'Start muted')}
        {toggle('loop', 'Loop')}
      </div>
      <pre className="pre mono notice">{code}</pre>
    </Card>
  );
}

export function VideoPage() {
  const route = useRoute();
  const videoId = route.parts[1] ?? '';
  const [tab, setTab] = useState<'overview' | 'tags' | 'compare' | 'embed'>('overview');
  const insight = useAsync(() => loadVideoInsight(videoId), [videoId], !!videoId);
  const v = insight.data;
  return (
    <Page title="Videolytics" subtitle="Statistics, SEO, tags and best-practice checks for any public video.">
      <Card>
        <VideoInput base="/video" />
      </Card>
      {!videoId ? <Empty title="Paste a video link to analyse it">Works for any public video, yours or a competitor's.</Empty> : null}
      {videoId && insight.loading ? <Loading label="Reading the video" /> : null}
      {insight.error ? <Notice tone="bad">{insight.error}</Notice> : null}
      {v ? (
        <>
          <Card>
            <div className="row" style={{ alignItems: 'flex-start', gap: 14 }}>
              <img src={`https://i.ytimg.com/vi/${v.videoId}/mqdefault.jpg`} alt="" width={200} style={{ borderRadius: 8 }} />
              <div className="grow stack" style={{ gap: 6 }}>
                <h2 style={{ fontSize: 17 }}>{v.title}</h2>
                <div className="muted">
                  <a href={`#/channel/${v.channelId}`}>{v.channelName}</a>
                  {v.subscriberCount !== null ? ` · ${formatCompact(v.subscriberCount)} subscribers` : ''}
                </div>
                <div className="row">
                  <a href={`https://www.youtube.com/watch?v=${v.videoId}`} target="_blank" rel="noreferrer">
                    Open on YouTube
                  </a>
                  <a href={`https://i.ytimg.com/vi/${v.videoId}/maxresdefault.jpg`} target="_blank" rel="noreferrer">
                    Full-size thumbnail
                  </a>
                  <a href={`#/thumbnails?analyze=${v.videoId}`}>Analyse thumbnail</a>
                </div>
              </div>
            </div>
          </Card>
          <Tabs
            value={tab}
            onChange={setTab}
            options={[
              { value: 'overview', label: 'Overview' },
              { value: 'tags', label: 'Tags' },
              { value: 'compare', label: 'Compare' },
              { value: 'embed', label: 'Embed' },
            ]}
          />
          {tab === 'overview' ? <Overview v={v} /> : tab === 'tags' ? <TagsTab v={v} /> : tab === 'compare' ? <CompareTab v={v} /> : <EmbedTab videoId={v.videoId} />}
        </>
      ) : null}
    </Page>
  );
}
