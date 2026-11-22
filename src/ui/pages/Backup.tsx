import { useState } from 'react';
import { toCsv } from '../../core/csv';
import { applyChanges, diffAgainstBackup, saveBackup, type ApplyResult, type Backup } from '../../services/bulk';
import { KEYS } from '../../shared/types';
import { getMyChannel, type VideoLibrary } from '../../yt/api';
import { ConnectGate, LibraryGate, QuotaWarning } from '../channel';
import { Diff, TagDiff } from '../Diff';
import { Button, Card, Modal, Notice, Page, Pill, Table, downloadFile, errorMessage, useStore, useToast } from '../kit';

function stamp(time: number): string {
  return new Date(time).toISOString().slice(0, 16).replace(/[:T]/g, '-');
}

function BackupManager({ library, refresh, refreshing }: { library: VideoLibrary; refresh: () => Promise<void>; refreshing: boolean }) {
  const [backups, setBackups] = useStore<Backup[]>(KEYS.backups, []);
  const [busy, setBusy] = useState(false);
  const [restoring, setRestoring] = useState<Backup | null>(null);
  const [progress, setProgress] = useState<{ done: number; results: ApplyResult[] } | null>(null);
  const toast = useToast();

  const create = async () => {
    setBusy(true);
    try {
      await refresh();
      const channel = await getMyChannel();
      const fresh = await import('../../yt/api').then((m) => m.getLibrary());
      const backup = await saveBackup('Manual backup', channel.id, fresh.items);
      toast(`Backed up ${backup.videos.length} videos.`, 'good');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const importFile = async (file: File) => {
    try {
      const parsed = JSON.parse(await file.text()) as Backup;
      if (!Array.isArray(parsed.videos) || !parsed.videos.every((v) => typeof v.id === 'string' && typeof v.title === 'string')) throw new Error('That file is not a CreatorDeck backup.');
      setBackups((all) => [{ ...parsed, id: `${parsed.id ?? 'import'}-${Date.now()}`, reason: `Imported: ${parsed.reason ?? file.name}` }, ...all].slice(0, 12));
      toast('Backup imported.', 'good');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    }
  };

  const changes = restoring ? diffAgainstBackup(library.items, restoring) : [];
  const restore = async () => {
    if (!restoring) return;
    setProgress({ done: 0, results: [] });
    try {
      const channel = await getMyChannel();
      const ids = new Set(changes.map((c) => c.id));
      await saveBackup('Before restore', channel.id, library.items.filter((v) => ids.has(v.id)));
      const results = await applyChanges(changes, (done, r) => setProgress({ done, results: [...r] }));
      const failed = results.filter((r) => !r.ok).length;
      toast(`${results.length - failed} videos restored${failed ? `, ${failed} failed` : ''}.`, failed ? 'warn' : 'good');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setProgress(null);
      setRestoring(null);
    }
  };

  return (
    <div className="stack">
      <Card
        title="Back up your channel's metadata"
        hint={`${library.items.length} videos loaded. A backup stores every title, description, tag list, category and visibility.`}
        actions={
          <>
            <Button variant="primary" busy={busy || refreshing} onClick={() => void create()}>
              Create backup now
            </Button>
            <Button onClick={() => downloadFile(`channel-export-${stamp(Date.now())}.csv`, toCsv(library.items as unknown as Record<string, unknown>[]), 'text/csv')}>Export CSV</Button>
            <label className="btn">
              Import backup
              <input type="file" accept="application/json,.json" hidden onChange={(e) => e.target.files?.[0] && void importFile(e.target.files[0])} />
            </label>
          </>
        }
      >
        <Notice>Backups live in this browser's extension storage (the newest 12 are kept). Download the JSON to keep a copy elsewhere. Video files, thumbnails and analytics are not included.</Notice>
      </Card>
      <Card title="Stored backups">
        <Table
          rows={backups}
          rowKey={(b) => b.id}
          empty="No backups yet. Bulk edits create one automatically before they run."
          columns={[
            { key: 'w', label: 'When', render: (b) => <span className="nowrap">{new Date(b.createdAt).toLocaleString()}</span> },
            { key: 'r', label: 'Reason', render: (b) => b.reason },
            { key: 'n', label: 'Videos', align: 'right', render: (b) => b.videos.length },
            {
              key: 'a',
              label: '',
              align: 'right',
              render: (b) => (
                <div className="row end">
                  <Button variant="small" onClick={() => downloadFile(`creatordeck-backup-${stamp(b.createdAt)}.json`, JSON.stringify(b, null, 2), 'application/json')}>
                    Download JSON
                  </Button>
                  <Button variant="small" onClick={() => setRestoring(b)}>
                    Restore…
                  </Button>
                  <Button variant="small" onClick={() => setBackups((all) => all.filter((x) => x.id !== b.id))}>
                    Delete
                  </Button>
                </div>
              ),
            },
          ]}
        />
      </Card>
      {restoring ? (
        <Modal
          title={`Restore backup from ${new Date(restoring.createdAt).toLocaleString()}`}
          onClose={() => !progress && setRestoring(null)}
          footer={
            <>
              <Button onClick={() => setRestoring(null)} disabled={!!progress}>
                Cancel
              </Button>
              <Button variant="primary" busy={!!progress} disabled={!changes.length} onClick={() => void restore()}>
                {progress ? `Restoring ${progress.done}/${changes.length}` : `Restore ${changes.length} video${changes.length === 1 ? '' : 's'}`}
              </Button>
            </>
          }
        >
          {changes.length ? (
            <>
              <p>These videos differ from the backup. Restoring writes the backed-up title, description and tags back to YouTube.</p>
              <QuotaWarning cost={changes.length * 51} />
              <Table
                rows={changes.slice(0, 50)}
                rowKey={(c) => c.id}
                columns={[
                  { key: 'v', label: 'Video', render: (c) => c.before.title },
                  {
                    key: 'd',
                    label: 'Will change',
                    render: (c) => (
                      <div className="stack" style={{ gap: 4 }}>
                        {c.before.title !== c.after.title ? (
                          <div>
                            <Pill>title</Pill> <Diff before={c.before.title} after={c.after.title} />
                          </div>
                        ) : null}
                        {c.before.description !== c.after.description ? (
                          <div>
                            <Pill>description</Pill> <Diff before={c.before.description} after={c.after.description} />
                          </div>
                        ) : null}
                        {c.before.tags.join('|') !== c.after.tags.join('|') ? (
                          <div>
                            <Pill>tags</Pill> <TagDiff before={c.before.tags} after={c.after.tags} />
                          </div>
                        ) : null}
                      </div>
                    ),
                  },
                ]}
              />
            </>
          ) : (
            <Notice tone="good">Every video in this backup already matches your channel. There is nothing to restore.</Notice>
          )}
        </Modal>
      ) : null}
    </div>
  );
}

export function BackupPage() {
  return (
    <Page title="Channel Backup" subtitle="Keep a copy of every video's metadata, export it, and roll back changes.">
      <ConnectGate>
        <LibraryGate>{(library, refresh, refreshing) => <BackupManager library={library} refresh={refresh} refreshing={refreshing} />}</LibraryGate>
      </ConnectGate>
    </Page>
  );
}
