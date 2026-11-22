import { useState } from 'react';
import { formatClock, formatCompact } from '../../core/text';
import { loadChannelInsight, nextMilestone, trackChannel, valuation, type ChannelInsight } from '../../services/channel';
import { KEYS, type TrackedChannel } from '../../shared/types';
import { useConnection, useSettings } from '../channel';
import { Button, Card, CopyButton, Empty, LineChart, Loading, Notice, Page, Stat, Table, Tabs, errorMessage, navigate, useAsync, useRoute, useStore, useToast } from '../kit';

function money(value: number): string {
  return `$${formatCompact(value)}`;
}

function monthlyViews(c: ChannelInsight): { value: number; exact: boolean } {
  return c.monthlyViewsFromSnapshots !== null ? { value: c.monthlyViewsFromSnapshots, exact: true } : { value: c.recentVideoViews, exact: false };
}

function Milestones({ c }: { c: ChannelInsight }) {
  const subs = c.exactSubscribers ?? c.channel.subscriberCount;
  const rows: { label: string; current: number | null; perDay: number | null }[] = [
    { label: 'Subscribers', current: subs, perDay: c.monthlySubscribersFromSnapshots !== null ? c.monthlySubscribersFromSnapshots / 30 : null },
    { label: 'Total views', current: c.totalViews, perDay: c.monthlyViewsFromSnapshots !== null ? c.monthlyViewsFromSnapshots / 30 : null },
    { label: 'Uploads', current: c.channel.videoCount, perDay: c.uploadCadenceDays ? 1 / c.uploadCadenceDays : null },
  ];
  return (
    <Card title="Milestones" hint="Projected from growth between the days CreatorDeck has looked at this channel.">
      <Table
        rows={rows.filter((r) => r.current !== null)}
        rowKey={(r) => r.label}
        columns={[
          { key: 'l', label: '', render: (r) => r.label },
          { key: 'c', label: 'Now', align: 'right', render: (r) => formatCompact(r.current) },
          { key: 'n', label: 'Next milestone', align: 'right', render: (r) => formatCompact(nextMilestone(r.current as number)) },
          {
            key: 'e',
            label: 'Estimated date',
            align: 'right',
            render: (r) => {
              if (!r.perDay || r.perDay <= 0) return <span className="muted">needs more history</span>;
              const days = (nextMilestone(r.current as number) - (r.current as number)) / r.perDay;
              return new Date(Date.now() + days * 86400_000).toLocaleDateString();
            },
          },
        ]}
      />
    </Card>
  );
}

function Summary({ c }: { c: ChannelInsight }) {
  const [settings] = useSettings();
  const monthly = monthlyViews(c);
  const worth = valuation(monthly.value, settings.rpmLow, settings.rpmHigh);
  const subs = c.exactSubscribers ?? c.channel.subscriberCount;
  return (
    <>
      <div className="grid c4">
        <Card>
          <Stat label="Subscribers" value={formatCompact(subs)} hint={c.exactSubscribers === null ? 'Rounded by YouTube' : undefined} />
        </Card>
        <Card>
          <Stat label="Videos" value={formatCompact(c.channel.videoCount)} hint={c.uploadCadenceDays ? `One every ${c.uploadCadenceDays.toFixed(1)} days lately` : undefined} />
        </Card>
        <Card>
          <Stat label="Lifetime views" value={formatCompact(c.totalViews)} hint={c.totalViews === null ? 'Connect your channel for exact totals' : undefined} />
        </Card>
        <Card>
          <Stat label="Median views, last 30 videos" value={formatCompact(c.medianViews)} hint={`Average ${formatCompact(c.averageViews)}`} />
        </Card>
        <Card>
          <Stat label="Uploads, last 30 days" value={c.uploadsLast30Days} hint="From the channel feed (latest 15 videos)" />
        </Card>
        <Card>
          <Stat
            label="Views, last 30 days"
            value={`${monthly.exact ? '' : '≥ '}${formatCompact(monthly.value)}`}
            hint={monthly.exact ? 'From daily snapshots' : 'Views on videos published in the last 30 days only'}
          />
        </Card>
        <Card>
          <Stat label="Estimated monthly ad revenue" value={`${money(worth.monthlyLow)} – ${money(worth.monthlyHigh)}`} hint={`At $${settings.rpmLow}–$${settings.rpmHigh} RPM (change in Settings)`} />
        </Card>
        <Card>
          <Stat label="Rough channel valuation" value={`${money(worth.valueLow)} – ${money(worth.valueHigh)}`} hint="24–36 months of estimated ad revenue" />
        </Card>
      </div>
      {!monthly.exact ? (
        <Notice>
          The 30-day view figure is a floor: YouTube does not publish channel-wide monthly views. CreatorDeck records a snapshot each day you track or open this channel, and switches to real
          30-day growth once it has a few days of history. Revenue and valuation follow from that figure and are rough.
        </Notice>
      ) : null}
    </>
  );
}

function Videos({ c }: { c: ChannelInsight }) {
  const [sort, setSort] = useState<'recent' | 'top'>('recent');
  const rows = sort === 'recent' ? c.videos : [...c.videos].sort((a, b) => (b.viewCount ?? 0) - (a.viewCount ?? 0));
  return (
    <Card
      title={`Videos (${c.videos.length} loaded)`}
      actions={
        <Tabs
          value={sort}
          onChange={setSort}
          options={[
            { value: 'recent', label: 'Most recent' },
            { value: 'top', label: 'Most viewed' },
          ]}
        />
      }
    >
      <Table
        rows={rows.slice(0, 40)}
        rowKey={(r) => r.videoId}
        columns={[
          { key: 'thumb', label: '', render: (r) => <img className="thumb" src={`https://i.ytimg.com/vi/${r.videoId}/mqdefault.jpg`} alt="" loading="lazy" /> },
          { key: 't', label: 'Title', render: (r) => <a href={`#/video/${r.videoId}`}>{r.title}</a> },
          { key: 'v', label: 'Views', align: 'right', render: (r) => formatCompact(r.viewCount) },
          { key: 'x', label: 'vs median', align: 'right', render: (r) => (r.viewCount !== null && c.medianViews ? `${(r.viewCount / c.medianViews).toFixed(1)}×` : '–') },
          { key: 'p', label: 'Published', render: (r) => <span className="nowrap">{r.publishedText}</span> },
          { key: 'd', label: 'Length', align: 'right', render: (r) => (r.lengthSeconds !== null ? formatClock(r.lengthSeconds) : '–') },
        ]}
      />
    </Card>
  );
}

function History({ c }: { c: ChannelInsight }) {
  const points = c.snapshots.filter((s) => s.subscribers !== null);
  if (points.length < 2) return null;
  return (
    <Card title="Subscriber history" hint="One point per day CreatorDeck checked this channel.">
      <LineChart series={[{ label: 'Subscribers', points: points.map((s) => ({ x: s.date, y: s.subscribers as number })) }]} yLabel={formatCompact} height={150} />
    </Card>
  );
}

export function ChannelPage() {
  const route = useRoute();
  const target = route.parts[1] ?? '';
  const [input, setInput] = useState('');
  const { channel: mine } = useConnection();
  const [tracked] = useStore<TrackedChannel[]>(KEYS.tracked, []);
  const toast = useToast();
  const insight = useAsync(() => loadChannelInsight(target), [target], !!target);
  const c = insight.data;
  const isTracked = !!c && tracked.some((t) => t.id === c.channel.id);
  return (
    <Page title="Channelytics" subtitle="Size, output and momentum for any channel, with milestones and a rough valuation.">
      <Card>
        <form
          className="row"
          onSubmit={(e) => {
            e.preventDefault();
            if (input.trim()) navigate(`/channel/${encodeURIComponent(input.trim())}`);
          }}
        >
          <div className="grow">
            <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Channel URL, @handle or UC… ID" aria-label="Channel" />
          </div>
          <Button variant="primary" type="submit">
            Analyse
          </Button>
          {mine ? <Button onClick={() => navigate(`/channel/${mine.id}`)}>My channel</Button> : null}
        </form>
      </Card>
      {!target ? <Empty title="Enter a channel to analyse">Works for any public channel.</Empty> : null}
      {target && insight.loading ? <Loading label="Reading the channel" /> : null}
      {insight.error ? <Notice tone="bad">{insight.error}</Notice> : null}
      {c ? (
        <>
          <Card>
            <div className="row" style={{ gap: 14 }}>
              {c.channel.avatar ? <img src={c.channel.avatar} alt="" width={64} height={64} style={{ borderRadius: '50%' }} /> : null}
              <div className="grow">
                <h2 style={{ fontSize: 18 }}>{c.channel.title}</h2>
                <div className="muted small">
                  {c.channel.handle ?? ''} · <span className="mono">{c.channel.id}</span>
                </div>
              </div>
              <CopyButton text={c.channel.id} label="Copy ID" />
              <a className="btn" href={`https://www.youtube.com/channel/${c.channel.id}`} target="_blank" rel="noreferrer">
                Open on YouTube
              </a>
              <Button
                variant="primary"
                disabled={isTracked}
                onClick={() => void trackChannel(c.channel.id).then(() => toast(`Tracking ${c.channel.title}. New uploads will raise alerts.`, 'good'), (e) => toast(errorMessage(e), 'bad'))}
              >
                {isTracked ? 'Tracked' : 'Track channel'}
              </Button>
            </div>
          </Card>
          <Summary c={c} />
          <div className="grid c2">
            <Milestones c={c} />
            <Card title="Channel keywords" actions={<CopyButton text={c.channel.keywords.join(', ')} label="Copy" />}>
              {c.channel.keywords.length ? (
                <div className="chips">
                  {c.channel.keywords.map((k) => (
                    <a key={k} className="chip clickable" href={`#/keywords?q=${encodeURIComponent(k)}`}>
                      {k}
                    </a>
                  ))}
                </div>
              ) : (
                <div className="muted small">This channel has not set any keywords.</div>
              )}
            </Card>
          </div>
          <History c={c} />
          <Videos c={c} />
        </>
      ) : null}
    </Page>
  );
}
