import { useMemo, useRef, useState } from 'react';
import { previewBulk, type BulkChange, type BulkField, type BulkOperation } from '../../core/findReplace';
import { applyChanges, saveBackup, type ApplyResult } from '../../services/bulk';
import { KEYS, type TagList, type VideoMeta } from '../../shared/types';
import { getMyChannel, type VideoLibrary } from '../../yt/api';
import { ConnectGate, LibraryGate, QuotaWarning } from '../channel';
import { Diff, TagDiff } from '../Diff';
import { Button, Card, Field, Modal, Notice, Page, Pill, Table, errorMessage, useStore, useToast } from '../kit';
import { parseTagInput } from '../TagEditor';

type OpKind = BulkOperation['kind'];

interface OpForm {
  kind: OpKind;
  field: BulkField;
  find: string;
  replaceWith: string;
  regex: boolean;
  caseSensitive: boolean;
  text: string;
}

const BLANK_OP: OpForm = { kind: 'replace', field: 'description', find: '', replaceWith: '', regex: false, caseSensitive: false, text: '' };

function toOperation(form: OpForm): BulkOperation | null {
  switch (form.kind) {
    case 'replace':
      return form.find ? { kind: 'replace', field: form.field, find: form.find, replaceWith: form.replaceWith, regex: form.regex, caseSensitive: form.caseSensitive } : null;
    case 'append':
    case 'prepend':
      return form.text ? { kind: form.kind, field: form.field === 'tags' ? 'description' : form.field, text: form.text } : null;
    case 'addTags':
    case 'removeTags':
      return parseTagInput(form.text).length ? { kind: form.kind, tags: parseTagInput(form.text) } : null;
    default: {
      const exhaustive: never = form.kind;
      return exhaustive;
    }
  }
}

function describe(op: BulkOperation): string {
  switch (op.kind) {
    case 'replace':
      return `In ${op.field}: replace ${op.regex ? 'pattern ' : ''}"${op.find}" with "${op.replaceWith}"${op.caseSensitive ? ' (case-sensitive)' : ''}`;
    case 'append':
      return `Append to ${op.field}: "${op.text}"`;
    case 'prepend':
      return `Prepend to ${op.field}: "${op.text}"`;
    case 'addTags':
      return `Add tags: ${op.tags.join(', ')}`;
    case 'removeTags':
      return `Remove tags: ${op.tags.join(', ')}`;
    default: {
      const exhaustive: never = op;
      return exhaustive;
    }
  }
}

function BulkEditor({ library, refresh, refreshing }: { library: VideoLibrary; refresh: () => Promise<void>; refreshing: boolean }) {
  const [form, setForm] = useState<OpForm>(BLANK_OP);
  const [operations, setOperations] = useState<BulkOperation[]>([]);
  const [filter, setFilter] = useState('');
  const [privacy, setPrivacy] = useState('all');
  const [excluded, setExcluded] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [running, setRunning] = useState(false);
  const [results, setResults] = useState<ApplyResult[] | null>(null);
  const [done, setDone] = useState(0);
  const stop = useRef(false);
  const [lists] = useStore<TagList[]>(KEYS.tagLists, []);
  const toast = useToast();

  const scope = useMemo(
    () => library.items.filter((v: VideoMeta) => (privacy === 'all' || v.privacyStatus === privacy) && (!filter || `${v.title} ${v.description}`.toLowerCase().includes(filter.toLowerCase()))),
    [library, filter, privacy],
  );
  let regexError: string | null = null;
  let changes: BulkChange[] = [];
  try {
    changes = previewBulk(scope, operations);
  } catch (error) {
    regexError = errorMessage(error);
  }
  const selected = changes.filter((c) => !excluded.has(c.id) && !c.problems.length);
  const blocked = changes.filter((c) => c.problems.length);
  const titleOf = (id: string) => library.items.find((v) => v.id === id)?.title ?? id;

  const addOperation = () => {
    const op = toOperation(form);
    if (!op) return toast('Fill in the operation first.', 'warn');
    if (op.kind === 'replace' && op.regex) {
      try {
        new RegExp(op.find);
      } catch (error) {
        return toast(`That pattern is not valid: ${errorMessage(error)}`, 'bad');
      }
    }
    setOperations((all) => [...all, op]);
    setForm({ ...BLANK_OP, kind: form.kind, field: form.field });
    setResults(null);
  };

  const run = async () => {
    setConfirm(false);
    setRunning(true);
    setDone(0);
    stop.current = false;
    try {
      const channel = await getMyChannel();
      const ids = new Set(selected.map((c) => c.id));
      await saveBackup(`Before bulk edit of ${selected.length} videos`, channel.id, library.items.filter((v) => ids.has(v.id)));
      const out = await applyChanges(selected, (n) => setDone(n), () => stop.current);
      setResults(out);
      const failed = out.filter((r) => !r.ok).length;
      toast(`${out.length - failed} updated${failed ? `, ${failed} failed` : ''}. A backup was saved first.`, failed ? 'warn' : 'good');
      setOperations([]);
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="stack">
      <Card title="1 · Build the edit" hint="Add one or more operations. They run in order on each video.">
        <div className="grid c3">
          <Field label="Operation">
            <select value={form.kind} onChange={(e) => setForm({ ...form, kind: e.target.value as OpKind })} aria-label="Operation">
              <option value="replace">Find and replace</option>
              <option value="append">Append text</option>
              <option value="prepend">Prepend text</option>
              <option value="addTags">Add tags</option>
              <option value="removeTags">Remove tags</option>
            </select>
          </Field>
          {form.kind === 'replace' || form.kind === 'append' || form.kind === 'prepend' ? (
            <Field label="Field">
              <select value={form.field} onChange={(e) => setForm({ ...form, field: e.target.value as BulkField })} aria-label="Field">
                <option value="description">Description</option>
                <option value="title">Title</option>
                {form.kind === 'replace' ? <option value="tags">Tags</option> : null}
              </select>
            </Field>
          ) : null}
        </div>
        {form.kind === 'replace' ? (
          <>
            <div className="grid c2">
              <Field label="Find">
                <input value={form.find} onChange={(e) => setForm({ ...form, find: e.target.value })} aria-label="Find" />
              </Field>
              <Field label="Replace with" hint="leave empty to delete">
                <input value={form.replaceWith} onChange={(e) => setForm({ ...form, replaceWith: e.target.value })} aria-label="Replace with" />
              </Field>
            </div>
            <div className="row">
              <label className="check">
                <input type="checkbox" checked={form.caseSensitive} onChange={(e) => setForm({ ...form, caseSensitive: e.target.checked })} /> Match case
              </label>
              <label className="check">
                <input type="checkbox" checked={form.regex} onChange={(e) => setForm({ ...form, regex: e.target.checked })} /> Regular expression
              </label>
            </div>
          </>
        ) : (
          <>
            <Field label={form.kind === 'addTags' || form.kind === 'removeTags' ? 'Tags' : 'Text'} hint={form.kind === 'addTags' || form.kind === 'removeTags' ? 'comma separated' : form.field === 'description' ? 'added on its own line' : undefined}>
              <textarea value={form.text} onChange={(e) => setForm({ ...form, text: e.target.value })} rows={2} aria-label="Operation text" />
            </Field>
            {form.kind === 'addTags' && lists.length ? (
              <div className="chips">
                <span className="small muted">From a tag list:</span>
                {lists.map((l) => (
                  <span key={l.id} className="chip clickable" onClick={() => setForm({ ...form, text: l.tags.join(', ') })}>
                    {l.name}
                  </span>
                ))}
              </div>
            ) : null}
          </>
        )}
        <div className="row">
          <Button variant="primary" onClick={addOperation}>
            Add operation
          </Button>
        </div>
        {operations.map((op, i) => (
          <div key={i} className="row between notice">
            <span>
              {i + 1}. {describe(op)}
            </span>
            <Button variant="small" onClick={() => setOperations((all) => all.filter((_, j) => j !== i))}>
              Remove
            </Button>
          </div>
        ))}
      </Card>

      <Card
        title="2 · Choose videos"
        hint={`${scope.length} of ${library.items.length} videos in scope · list loaded ${new Date(library.fetchedAt).toLocaleString()}`}
        actions={
          <Button variant="small" busy={refreshing} onClick={() => void refresh()}>
            Reload videos
          </Button>
        }
      >
        <div className="row">
          <div className="grow">
            <input value={filter} onChange={(e) => setFilter(e.target.value)} placeholder="Only videos whose title or description contains…" aria-label="Video filter" />
          </div>
          <select value={privacy} onChange={(e) => setPrivacy(e.target.value)} style={{ width: 180 }} aria-label="Privacy filter">
            <option value="all">Any visibility</option>
            <option value="public">Public</option>
            <option value="unlisted">Unlisted</option>
            <option value="private">Private</option>
          </select>
        </div>
      </Card>

      <Card
        title="3 · Preview"
        hint={operations.length ? `${changes.length} video${changes.length === 1 ? '' : 's'} would change. Nothing is written until you apply.` : 'Add an operation to see what would change.'}
        actions={
          <Button variant="primary" disabled={!selected.length || running} onClick={() => setConfirm(true)}>
            Apply to {selected.length} video{selected.length === 1 ? '' : 's'}
          </Button>
        }
      >
        {regexError ? <Notice tone="bad">{regexError}</Notice> : null}
        {blocked.length ? (
          <Notice tone="warn">
            {blocked.length} video{blocked.length === 1 ? '' : 's'} would break a YouTube limit and will be skipped.
          </Notice>
        ) : null}
        <QuotaWarning cost={selected.length * 51} />
        {running ? (
          <Notice>
            Updating… {done} of {selected.length}.{' '}
            <Button variant="small" onClick={() => (stop.current = true)}>
              Stop
            </Button>
          </Notice>
        ) : null}
        <Table
          rows={changes.slice(0, 100)}
          rowKey={(c) => c.id}
          empty={operations.length ? 'No videos in scope match these operations.' : ' '}
          columns={[
            {
              key: 'p',
              label: '',
              render: (c) => (
                <input
                  type="checkbox"
                  aria-label={`Include ${c.before.title}`}
                  disabled={c.problems.length > 0}
                  checked={!excluded.has(c.id) && !c.problems.length}
                  onChange={() =>
                    setExcluded((set) => {
                      const next = new Set(set);
                      if (next.has(c.id)) next.delete(c.id);
                      else next.add(c.id);
                      return next;
                    })
                  }
                />
              ),
            },
            {
              key: 'v',
              label: 'Video',
              render: (c) => (
                <div style={{ maxWidth: 220 }}>
                  <a href={`https://studio.youtube.com/video/${c.id}/edit`} target="_blank" rel="noreferrer">
                    {c.before.title}
                  </a>
                  {c.problems.map((p) => (
                    <div key={p} className="small bad">
                      {p}
                    </div>
                  ))}
                </div>
              ),
            },
            {
              key: 'd',
              label: 'Change',
              render: (c) => (
                <div className="stack" style={{ gap: 4 }}>
                  {c.changedFields.includes('title') ? (
                    <div>
                      <Pill>title</Pill> <Diff before={c.before.title} after={c.after.title} />
                    </div>
                  ) : null}
                  {c.changedFields.includes('description') ? (
                    <div>
                      <Pill>description</Pill> <Diff before={c.before.description} after={c.after.description} />
                    </div>
                  ) : null}
                  {c.changedFields.includes('tags') ? (
                    <div>
                      <Pill>tags</Pill> <TagDiff before={c.before.tags} after={c.after.tags} />
                    </div>
                  ) : null}
                </div>
              ),
            },
          ]}
        />
        {changes.length > 100 ? <div className="small muted">Showing the first 100 of {changes.length} changes. All selected videos will be updated.</div> : null}
      </Card>

      {results ? (
        <Card title="Last run">
          <Table
            rows={results}
            rowKey={(r) => r.id}
            columns={[
              { key: 'v', label: 'Video', render: (r) => titleOf(r.id) },
              { key: 's', label: 'Result', render: (r) => (r.ok ? <Pill tone="good">updated</Pill> : <Pill tone="bad">failed</Pill>) },
              { key: 'e', label: '', render: (r) => <span className="small muted">{r.error ?? ''}</span> },
            ]}
          />
          <div className="small muted">
            To undo, open <a href="#/backup">Backup</a> and restore the automatic backup taken just before this run.
          </div>
        </Card>
      ) : null}

      {confirm ? (
        <Modal
          title={`Update ${selected.length} video${selected.length === 1 ? '' : 's'} on YouTube?`}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button onClick={() => setConfirm(false)}>Cancel</Button>
              <Button variant="primary" onClick={() => void run()}>
                Apply changes
              </Button>
            </>
          }
        >
          <ul style={{ margin: 0, paddingLeft: 18 }}>
            {operations.map((op, i) => (
              <li key={i}>{describe(op)}</li>
            ))}
          </ul>
          <p className="muted">The current title, description and tags of these videos are backed up first, so the run can be reversed from the Backup page. About {(selected.length * 51).toLocaleString()} quota units.</p>
        </Modal>
      ) : null}
    </div>
  );
}

export function BulkPage() {
  return (
    <Page title="Bulk Find, Replace and Append" subtitle="Change titles, descriptions and tags across many videos at once, with a preview before anything is written.">
      <ConnectGate>
        <LibraryGate>{(library, refresh, refreshing) => <BulkEditor library={library} refresh={refresh} refreshing={refreshing} />}</LibraryGate>
      </ConnectGate>
    </Page>
  );
}
