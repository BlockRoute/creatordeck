import { useState } from 'react';
import { findRank } from '../../services/research';
import { type RankTrack } from '../../services/ranks';
import { uid } from '../../core/text';
import { KEYS } from '../../shared/types';
import { isoDay } from '../../yt/analytics';
import { parseVideoId } from '../../yt/innertube';
import { Button, Card, Empty, Field, LineChart, Notice, Page, errorMessage, useStore, useToast } from '../kit';

export function RankPage() {
  const [tracks, setTracks] = useStore<RankTrack[]>(KEYS.rankTracks, []);
  const [query, setQuery] = useState('');
  const [video, setVideo] = useState('');
  const [label, setLabel] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const toast = useToast();

  const add = () => {
    const videoId = parseVideoId(video) ?? (video.trim().length === 11 ? video.trim() : null);
    if (!query.trim() || !videoId) return toast('Enter a search and a video link or ID.', 'warn');
    setTracks((list) => [{ id: uid(), query: query.trim(), videoId, label: label.trim() || query.trim(), history: [] }, ...list]);
    setQuery('');
    setVideo('');
    setLabel('');
  };

  const check = async (track: RankTrack) => {
    setBusy(track.id);
    try {
      const result = await findRank(track.query, { videoId: track.videoId }, 20);
      const today = isoDay(new Date());
      setTracks((list) =>
        list.map((item) =>
          item.id === track.id ? { ...item, history: [...item.history.filter((point) => point.date !== today), { date: today, position: result.position }].slice(-120) } : item,
        ),
      );
      toast(result.position ? `Position ${result.position} of the first ${result.checked}.` : `Not in the first ${result.checked} results.`, result.position ? 'good' : 'warn');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page title="Search ranks" subtitle="Checks where one of your videos sits in the first 20 public results for a search. A daily check also runs while Chrome is open. Positions are what a signed-out viewer sees, and they move.">
      <Notice>YouTube asked some tools to stop showing search positions. This check reads the public results page directly, twenty videos deep, and stores the history on this computer.</Notice>
      <Card>
        <div className="grid c3">
          <Field label="Search"><input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="sourdough starter" /></Field>
          <Field label="Video"><input value={video} onChange={(e) => setVideo(e.target.value)} placeholder="link or ID" /></Field>
          <Field label="Label"><input value={label} onChange={(e) => setLabel(e.target.value)} placeholder="optional" /></Field>
        </div>
        <div className="row end"><Button variant="primary" onClick={add}>Track</Button></div>
      </Card>
      {tracks.length ? (
        tracks.map((track) => {
          const latest = track.history[track.history.length - 1];
          return (
            <Card
              key={track.id}
              title={track.label}
              hint={track.query}
              actions={
                <div className="row">
                  <Button variant="small" busy={busy === track.id} onClick={() => void check(track)}>Check now</Button>
                  <Button variant="ghost" onClick={() => setTracks((list) => list.filter((item) => item.id !== track.id))}>Remove</Button>
                </div>
              }
            >
              <p>{latest ? (latest.position ? `Latest: #${latest.position} on ${latest.date}` : `Not in the first 20 on ${latest.date}`) : 'Not checked yet.'}</p>
              {track.history.length > 1 ? (
                <LineChart
                  series={[{ label: 'Position', points: track.history.map((point) => ({ x: point.date, y: point.position ?? 21 })) }]}
                  height={140}
                  yLabel={(v) => (v > 20 ? '—' : `#${v}`)}
                />
              ) : null}
            </Card>
          );
        })
      ) : (
        <Empty title="No searches tracked" />
      )}
    </Page>
  );
}
