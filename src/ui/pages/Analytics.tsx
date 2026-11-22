import { useState } from 'react';
import { bestPublishBuckets, weekdayName } from '../../core/timing';
import { formatCompact } from '../../core/text';
import { parseVideoId } from '../../yt/innertube';
import { analyticsQuery, daysAgo } from '../../yt/analytics';
import { KEYS } from '../../shared/types';
import type { VideoMeta } from '../../shared/types';
import { ConnectGate, useLibrary } from '../channel';
import { Button, Card, Empty, Field, LineChart, Loading, Notice, Page, Stat, Table, errorMessage, useAsync, useStore } from '../kit';

export function AnalyticsPage({ section }: { section: string }) {
  if (section === 'retention') return <Retention />;
  if (section === 'timing') return <Timing />;
  return <Health />;
}

function Health() {
  const start = daysAgo(28);
  const end = daysAgo(1);
  const report = useAsync(async () => {
    const totals = await analyticsQuery({ startDate: start, endDate: end, metrics: 'views,estimatedMinutesWatched,averageViewDuration,likes,comments,subscribersGained' });
    const top = await analyticsQuery({ startDate: start, endDate: end, dimensions: 'video', metrics: 'views,estimatedMinutesWatched', sort: '-views', maxResults: 10 });
    return { totals: totals[0] ?? {}, top };
  }, [start, end]);
  return (
    <ConnectGate>
      <Page title="Health report" subtitle={`Channel totals for ${start} to ${end}, from the YouTube Analytics API. The last day is omitted because it is usually incomplete.`}>
        {report.loading ? <Loading /> : null}
        {report.error ? <Notice tone="bad">{report.error}</Notice> : null}
        {report.data ? (
          <>
            <div className="grid c3">
              <Stat label="Views" value={formatCompact(Number(report.data.totals.views ?? 0))} />
              <Stat label="Watch time" value={`${formatCompact(Number(report.data.totals.estimatedMinutesWatched ?? 0))} min`} />
              <Stat label="Avg view duration" value={`${Math.round(Number(report.data.totals.averageViewDuration ?? 0))}s`} />
              <Stat label="Likes" value={formatCompact(Number(report.data.totals.likes ?? 0))} />
              <Stat label="Comments" value={formatCompact(Number(report.data.totals.comments ?? 0))} />
              <Stat label="Subscribers gained" value={formatCompact(Number(report.data.totals.subscribersGained ?? 0))} />
            </div>
            <Card title="Top videos">
              <Table
                rows={report.data.top}
                rowKey={(row) => String(row.video)}
                empty="No video rows in this window."
                columns={[
                  { key: 'video', label: 'Video', render: (row) => <a href={`#/video/${String(row.video)}`}>{String(row.video)}</a> },
                  { key: 'views', label: 'Views', render: (row) => formatCompact(Number(row.views)) },
                  { key: 'min', label: 'Minutes', render: (row) => formatCompact(Number(row.estimatedMinutesWatched)) },
                ]}
              />
            </Card>
          </>
        ) : null}
      </Page>
    </ConnectGate>
  );
}

function Retention() {
  const [input, setInput] = useState('');
  const [videoId, setVideoId] = useState('');
  const report = useAsync(
    () =>
      analyticsQuery({
        startDate: daysAgo(90),
        endDate: daysAgo(1),
        dimensions: 'elapsedVideoTimeRatio',
        metrics: 'audienceWatchRatio,relativeRetentionPerformance',
        filters: `video==${videoId}`,
      }),
    [videoId],
    !!videoId,
  );
  return (
    <ConnectGate>
      <Page title="Retention" subtitle="Audience watch ratio along the video, for the last 90 days. Relative retention compares the video with others of a similar length.">
        <Card>
          <form
            className="row"
            onSubmit={(e) => {
              e.preventDefault();
              const id = parseVideoId(input) ?? input.trim();
              setVideoId(id);
            }}
          >
            <Field label="Video">
              <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="link or ID" />
            </Field>
            <Button variant="primary" type="submit">Load</Button>
          </form>
        </Card>
        {report.loading ? <Loading /> : null}
        {report.error ? <Notice tone="bad">{report.error}</Notice> : null}
        {report.data ? (
          <Card title="Watch ratio">
            {report.data.length ? (
              <LineChart
                series={[
                  { label: 'Still watching', points: report.data.map((row) => ({ x: `${Math.round(Number(row.elapsedVideoTimeRatio) * 100)}%`, y: Number(row.audienceWatchRatio) })) },
                  { label: 'Vs similar videos', points: report.data.map((row) => ({ x: `${Math.round(Number(row.elapsedVideoTimeRatio) * 100)}%`, y: Number(row.relativeRetentionPerformance) })) },
                ]}
                yLabel={(v) => v.toFixed(2)}
              />
            ) : (
              <Empty title="No retention rows">The video may be too new, or too short, for this report.</Empty>
            )}
          </Card>
        ) : null}
      </Page>
    </ConnectGate>
  );
}

function Timing() {
  const { library, refresh, refreshing } = useLibrary();
  const [videos] = useStore<VideoMeta[] | null>(KEYS.videos, null);
  const items = library?.items ?? videos ?? [];
  const buckets = bestPublishBuckets(items);
  const reliable = buckets.filter((bucket) => bucket.samples >= 2);
  const best = reliable[0] ?? buckets[0];
  return (
    <Page
      title="Best time to publish"
      subtitle="Ranked from your own uploads: weekday and hour (UTC) with the highest median views per day. The Analytics API does not report an hour-of-day audience curve, so this uses publish time instead."
      actions={<Button busy={refreshing} onClick={() => void refresh().catch((error) => alert(errorMessage(error)))}>Refresh library</Button>}
    >
      {!items.length ? <Empty title="No videos loaded">Connect the channel and refresh the library. The ranking needs publish dates and view counts.</Empty> : null}
      {best ? (
        <Notice tone="good">
          Strongest bucket so far: {weekdayName(best.weekday)} at {String(best.hour).padStart(2, '0')}:00 UTC, median {formatCompact(best.medianViewsPerDay)} views per day across {best.samples} video{best.samples === 1 ? '' : 's'}.
          {best.samples < 2 ? ' That bucket has a single video, so treat it as a hint.' : ''}
        </Notice>
      ) : null}
      {buckets.length ? (
        <Card>
          <Table
            rows={buckets.slice(0, 20)}
            rowKey={(row) => `${row.weekday}-${row.hour}`}
            columns={[
              { key: 'when', label: 'Published (UTC)', render: (row) => `${weekdayName(row.weekday)} ${String(row.hour).padStart(2, '0')}:00` },
              { key: 'n', label: 'Videos', render: (row) => row.samples },
              { key: 'rate', label: 'Median views / day', render: (row) => formatCompact(row.medianViewsPerDay) },
            ]}
          />
        </Card>
      ) : null}
    </Page>
  );
}
