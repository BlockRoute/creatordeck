import { useState } from 'react';
import { uid } from '../../core/text';
import { CONFIDENCE, MIN_IMPRESSIONS, activateVariant, applyWinner, deleteTest, evaluateAbTests, listTests, saveTest, type AbTest, type Variant, type VariantField } from '../../services/abtest';
import { syncReachReports } from '../../yt/analytics';
import { KEYS } from '../../shared/types';
import { ConnectGate, LibraryGate, QuotaWarning } from '../channel';
import { Button, Card, Empty, Field, Modal, Notice, Page, Pill, Table, errorMessage, useStore, useToast } from '../kit';

const FIELDS: { value: VariantField; label: string }[] = [
  { value: 'thumbnail', label: 'Thumbnail' },
  { value: 'title', label: 'Title' },
  { value: 'description', label: 'Description' },
  { value: 'tags', label: 'Tags' },
];

function readFile(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function blankVariant(index: number, field: VariantField, from?: { title: string; description: string; tags: string[] }): Variant {
  return {
    id: uid(),
    label: index === 0 ? 'Original' : `Variant ${String.fromCharCode(65 + index)}`,
    title: field === 'title' ? (from?.title ?? '') : undefined,
    description: field === 'description' ? (from?.description ?? '') : undefined,
    tags: field === 'tags' ? [...(from?.tags ?? [])] : undefined,
  };
}

export function AbPage() {
  return (
    <ConnectGate>
      <LibraryGate>{(library) => <AbEditor videos={library.items} />}</LibraryGate>
    </ConnectGate>
  );
}

function AbEditor({ videos }: { videos: { id: string; title: string; description: string; tags: string[] }[] }) {
  const [tests] = useStore<AbTest[]>(KEYS.abTests, []);
  const [videoId, setVideoId] = useState(videos[0]?.id ?? '');
  const [field, setField] = useState<VariantField>('title');
  const [variants, setVariants] = useState<Variant[]>(() => [blankVariant(0, 'title', videos[0]), blankVariant(1, 'title', videos[0])]);
  const [hours, setHours] = useState(24);
  const [busy, setBusy] = useState<string | null>(null);
  const [confirmId, setConfirmId] = useState<string | null>(null);
  const toast = useToast();
  const video = videos.find((v) => v.id === videoId);

  const retarget = (nextField: VariantField, nextVideo = video) => {
    setField(nextField);
    setVariants([blankVariant(0, nextField, nextVideo), blankVariant(1, nextField, nextVideo)]);
  };

  const create = async () => {
    if (!video) return toast('Pick a video from your library.', 'warn');
    const test: AbTest = {
      id: uid(),
      videoId: video.id,
      videoTitle: video.title,
      field,
      variants,
      activeIndex: 0,
      startedAt: Date.now(),
      status: 'paused',
      minImpressions: MIN_IMPRESSIONS,
      confidenceTarget: CONFIDENCE,
      rotationHours: Math.max(1, hours),
      lastRotationAt: null,
      exposures: [],
      winnerIndex: null,
    };
    setBusy('create');
    try {
      await saveTest(test);
      await activateVariant(test.id, 0);
      toast('Test started. The original is live, and the next variant goes on after the rotation window.', 'good');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(null);
    }
  };

  const refresh = async () => {
    setBusy('refresh');
    try {
      const reports = await syncReachReports();
      await evaluateAbTests();
      toast(reports ? `Read ${reports} new reach report${reports === 1 ? '' : 's'}.` : 'Results refreshed. A new reach report is not ready yet, so click-through still uses what was already downloaded.', 'good');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(null);
    }
  };

  return (
    <Page
      title="A/B tests"
      subtitle="Each variant stays live for the rotation window, then the next one replaces it. A winner is declared at 95% confidence after 500 impressions per contender. Until the Reporting API delivers click-through (often about two days), title and thumbnail tests show views only."
      actions={<Button onClick={() => void refresh()} busy={busy === 'refresh'}>Refresh results</Button>}
    >
      <Card title="New test">
        <div className="grid c2">
          <Field label="Video">
            <select
              value={videoId}
              onChange={(e) => {
                const next = videos.find((v) => v.id === e.target.value);
                setVideoId(e.target.value);
                retarget(field, next);
              }}
            >
              {videos.map((v) => (
                <option key={v.id} value={v.id}>{v.title}</option>
              ))}
            </select>
          </Field>
          <Field label="What changes">
            <select value={field} onChange={(e) => retarget(e.target.value as VariantField)}>
              {FIELDS.map((item) => (
                <option key={item.value} value={item.value}>{item.label}</option>
              ))}
            </select>
          </Field>
        </div>
        <Field label="Hours each variant stays live">
          <input type="number" min={1} value={hours} onChange={(e) => setHours(Number(e.target.value))} />
        </Field>
        {variants.map((variant, index) => (
          <VariantFields
            key={variant.id}
            variant={variant}
            field={field}
            onChange={(next) => setVariants((list) => list.map((item) => (item.id === variant.id ? next : item)))}
            onRemove={variants.length > 2 ? () => setVariants((list) => list.filter((item) => item.id !== variant.id)) : undefined}
            index={index}
          />
        ))}
        {variants.length < 4 ? (
          <Button variant="ghost" onClick={() => setVariants((list) => [...list, blankVariant(list.length, field, video)])}>Add a variant</Button>
        ) : null}
        <QuotaWarning cost={50} />
        <div className="row end">
          <Button variant="primary" busy={busy === 'create'} onClick={() => void create()}>Start test</Button>
        </div>
      </Card>
      {tests.length ? (
        tests.map((test) => (
          <TestCard
            key={test.id}
            test={test}
            busy={busy}
            onPause={async () => {
              const all = await listTests();
              const current = all.find((item) => item.id === test.id);
              if (!current) return;
              current.status = current.status === 'paused' ? 'running' : 'paused';
              await saveTest(current);
              toast(current.status === 'paused' ? 'Paused.' : 'Running again.', 'good');
            }}
            onApply={() => setConfirmId(test.id)}
            onDelete={async () => {
              await deleteTest(test.id);
              toast('Test removed. The video is left as it is.', 'good');
            }}
          />
        ))
      ) : (
        <Empty title="No tests yet" />
      )}
      {confirmId ? (
        <Modal
          title="Apply the winner"
          onClose={() => setConfirmId(null)}
          footer={
            <>
              <Button variant="ghost" onClick={() => setConfirmId(null)}>Cancel</Button>
              <Button
                variant="primary"
                busy={busy === 'winner'}
                onClick={() => {
                  setBusy('winner');
                  void applyWinner(confirmId)
                    .then(() => {
                      toast('Winner applied. The test is finished.', 'good');
                      setConfirmId(null);
                    })
                    .catch((error) => toast(errorMessage(error), 'bad'))
                    .finally(() => setBusy(null));
                }}
              >
                Apply winner
              </Button>
            </>
          }
        >
          <p>This writes the winning variant to the video and stops the rotation. The other variants stay in the history.</p>
        </Modal>
      ) : null}
    </Page>
  );
}

function VariantFields({ variant, field, onChange, onRemove, index }: { variant: Variant; field: VariantField; onChange: (next: Variant) => void; onRemove?: () => void; index: number }) {
  return (
    <Card title={variant.label} actions={onRemove ? <Button variant="ghost" onClick={onRemove}>Remove</Button> : <span className="muted small">Variant {index + 1}</span>}>
      <Field label="Label">
        <input value={variant.label} onChange={(e) => onChange({ ...variant, label: e.target.value })} />
      </Field>
      {field === 'title' ? (
        <Field label="Title">
          <input value={variant.title ?? ''} onChange={(e) => onChange({ ...variant, title: e.target.value })} />
        </Field>
      ) : null}
      {field === 'description' ? (
        <Field label="Description">
          <textarea rows={5} value={variant.description ?? ''} onChange={(e) => onChange({ ...variant, description: e.target.value })} />
        </Field>
      ) : null}
      {field === 'tags' ? (
        <Field label="Tags" hint="comma separated">
          <input value={(variant.tags ?? []).join(', ')} onChange={(e) => onChange({ ...variant, tags: e.target.value.split(',').map((t) => t.trim()).filter(Boolean) })} />
        </Field>
      ) : null}
      {field === 'thumbnail' ? (
        <Field label="Thumbnail image">
          <input
            type="file"
            accept="image/png,image/jpeg"
            onChange={(e) => {
              const file = e.target.files?.[0];
              if (!file) return;
              void readFile(file).then((thumbnailDataUrl) => onChange({ ...variant, thumbnailDataUrl }));
            }}
          />
          {variant.thumbnailDataUrl ? <img src={variant.thumbnailDataUrl} alt="" style={{ width: 240, borderRadius: 8 }} /> : null}
        </Field>
      ) : null}
    </Card>
  );
}

function TestCard({ test, busy, onPause, onApply, onDelete }: { test: AbTest; busy: string | null; onPause: () => Promise<void>; onApply: () => void; onDelete: () => Promise<void> }) {
  const comparison = test.latest?.comparison;
  const active = test.variants[test.activeIndex];
  return (
    <Card
      title={test.videoTitle}
      hint={`${test.field} · ${test.status}${active ? ` · live: ${active.label}` : ''}`}
      actions={
        <div className="row">
          {test.winnerIndex != null ? <Pill tone="good">Winner ready</Pill> : null}
          <Button variant="small" busy={busy === test.id} onClick={() => void onPause()}>{test.status === 'paused' ? 'Resume' : 'Pause'}</Button>
          {test.winnerIndex != null && test.status !== 'complete' ? <Button variant="small" onClick={onApply}>Apply winner</Button> : null}
          <Button variant="ghost" onClick={() => void onDelete()}>Delete</Button>
        </div>
      }
    >
      {comparison ? (
        <Notice tone={comparison.significant ? 'good' : 'info'}>
          {comparison.significant
            ? `${test.variants[comparison.bestIndex]?.label ?? 'A variant'} leads by ${comparison.lift == null ? 'a measured gap' : `${Math.round(comparison.lift * 100)}%`} at ${Math.round(comparison.confidence * 100)}% confidence.`
            : comparison.note || `Not enough evidence yet (${Math.round(comparison.confidence * 100)}% confidence).`}
        </Notice>
      ) : (
        <p className="muted small">Results appear after Refresh. Views come from the Analytics API; click-through comes from the Reporting API once its first report exists.</p>
      )}
      {test.latest ? (
        <Table
          rows={test.variants.map((variant, index) => ({ variant, stats: test.latest?.stats[index] }))}
          rowKey={(row) => row.variant.id}
          columns={[
            { key: 'label', label: 'Variant', render: (row) => row.variant.label },
            { key: 'impr', label: 'Impressions', render: (row) => Math.round(row.stats?.impressions ?? 0).toLocaleString() },
            { key: 'ctr', label: 'CTR', render: (row) => (row.stats && row.stats.impressions > 0 ? `${((row.stats.clicks / row.stats.impressions) * 100).toFixed(2)}%` : '—') },
            { key: 'views', label: 'Views', render: (row) => Math.round(row.stats?.views ?? 0).toLocaleString() },
          ]}
        />
      ) : null}
    </Card>
  );
}
