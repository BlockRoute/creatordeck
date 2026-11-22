import { useState } from 'react';
import { formatCompact } from '../../core/text';
import { parseVideoId } from '../../yt/innertube';
import { addToPlaylist, listMyPlaylists, listPlaylistVideoIds, movePlaylistItem, removePlaylistItem, type PlaylistInfo } from '../../yt/api';
import { ConnectGate, QuotaWarning } from '../channel';
import { Button, Card, Empty, Field, Loading, Page, Table, errorMessage, useAsync, useToast } from '../kit';

export function PlaylistsPage() {
  return (
    <ConnectGate>
      <PlaylistEditor />
    </ConnectGate>
  );
}

function PlaylistEditor() {
  const playlists = useAsync(() => listMyPlaylists(), []);
  const [selected, setSelected] = useState<string>('');
  const id = selected || playlists.data?.[0]?.id || '';
  const items = useAsync(() => (id ? listPlaylistVideoIds(id) : Promise.resolve([])), [id], !!id);
  const [addText, setAddText] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const run = async (fn: () => Promise<void>) => {
    setBusy(true);
    try {
      await fn();
      items.reload();
      playlists.reload();
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Playlists" subtitle="Add, remove and reorder videos on your playlists. Each change costs 50 quota units.">
      {playlists.loading ? <Loading label="Loading playlists" /> : null}
      {playlists.error ? <p>{playlists.error}</p> : null}
      {playlists.data && !playlists.data.length ? <Empty title="No playlists" /> : null}
      {playlists.data?.length ? (
        <Card>
          <Field label="Playlist">
            <select value={id} onChange={(e) => setSelected(e.target.value)}>
              {playlists.data.map((playlist: PlaylistInfo) => (
                <option key={playlist.id} value={playlist.id}>{playlist.title} ({playlist.itemCount})</option>
              ))}
            </select>
          </Field>
          <Field label="Add videos" hint="one link or ID per line">
            <textarea rows={3} value={addText} onChange={(e) => setAddText(e.target.value)} />
          </Field>
          <QuotaWarning cost={50} />
          <div className="row end">
            <Button
              variant="primary"
              busy={busy}
              onClick={() =>
                void run(async () => {
                  const ids = addText.split(/\s+/).map((line) => parseVideoId(line) ?? (line.length === 11 ? line : '')).filter(Boolean);
                  for (const videoId of ids) await addToPlaylist(id, videoId);
                  setAddText('');
                  toast(`Added ${ids.length}.`, 'good');
                })
              }
            >
              Add
            </Button>
          </div>
        </Card>
      ) : null}
      {items.loading ? <Loading label="Loading videos" /> : null}
      {items.data?.length ? (
        <Card title="Videos">
          <Table
            rows={items.data}
            rowKey={(row) => row.itemId}
            columns={[
              { key: 'pos', label: '#', render: (row) => row.position + 1 },
              { key: 'id', label: 'Video', render: (row) => <a href={`#/video/${row.videoId}`}>{row.videoId}</a> },
              {
                key: 'move',
                label: '',
                render: (row, index) => (
                  <div className="row">
                    <Button variant="small" disabled={index === 0 || busy} onClick={() => void run(() => movePlaylistItem(id, row.itemId, row.videoId, Math.max(0, row.position - 1)))}>Up</Button>
                    <Button variant="small" disabled={busy} onClick={() => void run(() => movePlaylistItem(id, row.itemId, row.videoId, row.position + 1))}>Down</Button>
                    <Button variant="danger" disabled={busy} onClick={() => void run(() => removePlaylistItem(row.itemId))}>Remove</Button>
                  </div>
                ),
              },
            ]}
          />
          <p className="muted small">{formatCompact(items.data.length)} videos. Reordering asks YouTube for the new position; a video already at the end stays there.</p>
        </Card>
      ) : null}
    </Page>
  );
}
