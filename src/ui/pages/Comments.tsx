import { useMemo, useState } from 'react';
import { toCsv } from '../../core/csv';
import { extractLinks, uid, wordFrequencies } from '../../core/text';
import { KEYS, type CannedResponse } from '../../shared/types';
import { getMyChannel, listChannelComments, rejectComments, replyToComment, type CommentRow } from '../../yt/api';
import { ConnectGate } from '../channel';
import { Button, Card, CopyButton, Empty, Field, Modal, Notice, Page, Table, Tabs, downloadFile, errorMessage, useStore, useToast } from '../kit';

const EMOJI = '😀 😂 🤣 😍 🥰 😎 🤔 😮 😢 😡 👍 👎 👏 🙏 🙌 💪 🔥 ✨ 🎉 ❤️ 💯 ✅ ❌ ⭐ 📌 📣 🎬 🎥 🔔 👀 👇 👉 💡 🚀 🤝 😅'.split(' ');

/** YouTube comment markup: *bold*, _italic_, -strikethrough-. */
function wrapSelection(el: HTMLTextAreaElement | null, value: string, mark: string): string {
  if (!el) return value;
  const { selectionStart: a, selectionEnd: b } = el;
  if (a === b) return value;
  return `${value.slice(0, a)}${mark}${value.slice(a, b)}${mark}${value.slice(b)}`;
}

function Composer() {
  const [text, setText] = useState('');
  const [el, setEl] = useState<HTMLTextAreaElement | null>(null);
  const [canned, setCanned] = useStore<CannedResponse[]>(KEYS.canned, []);
  const [name, setName] = useState('');
  return (
    <div className="grid c2" style={{ alignItems: 'start' }}>
      <Card title="Comment composer" hint="Select text, then format it. YouTube renders *bold*, _italic_ and -strikethrough- in comments." actions={<CopyButton text={text} label="Copy comment" />}>
        <div className="row">
          <Button variant="small" onClick={() => setText(wrapSelection(el, text, '*'))}>
            <b>Bold</b>
          </Button>
          <Button variant="small" onClick={() => setText(wrapSelection(el, text, '_'))}>
            <i>Italic</i>
          </Button>
          <Button variant="small" onClick={() => setText(wrapSelection(el, text, '-'))}>
            <s>Strike</s>
          </Button>
        </div>
        <textarea ref={setEl} value={text} onChange={(e) => setText(e.target.value)} rows={6} placeholder="Write a comment or reply" aria-label="Comment text" />
        <div className="chips">
          {EMOJI.map((e) => (
            <span key={e} className="chip clickable" onClick={() => setText((t) => t + e)}>
              {e}
            </span>
          ))}
        </div>
        <div className="row">
          <div className="grow">
            <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Name this response to save it" aria-label="Canned response name" />
          </div>
          <Button
            disabled={!name.trim() || !text.trim()}
            onClick={() => {
              setCanned((all) => [...all, { id: uid(), name: name.trim(), text }]);
              setName('');
            }}
          >
            Save as canned response
          </Button>
        </div>
      </Card>
      <Card title="Canned responses" hint="Replies you send often. Copy one, or load it into the composer to adjust.">
        {!canned.length ? <div className="muted small">None saved yet.</div> : null}
        {canned.map((c) => (
          <div key={c.id} className="stack" style={{ gap: 4, paddingBottom: 8, borderBottom: '1px solid var(--line)' }}>
            <div className="row between">
              <strong>{c.name}</strong>
              <div className="row">
                <CopyButton text={c.text} />
                <Button variant="small" onClick={() => setText(c.text)}>
                  Load
                </Button>
                <Button variant="small" onClick={() => setCanned((all) => all.filter((x) => x.id !== c.id))}>
                  Delete
                </Button>
              </div>
            </div>
            <div className="small muted pre">{c.text}</div>
          </div>
        ))}
      </Card>
    </div>
  );
}

type Filter = 'all' | 'links' | 'questions' | 'unanswered' | 'short';

function matches(row: CommentRow, filter: Filter, query: string): boolean {
  if (query && !`${row.text} ${row.author}`.toLowerCase().includes(query.toLowerCase())) return false;
  if (filter === 'links') return extractLinks(row.text).length > 0;
  if (filter === 'questions') return row.text.includes('?');
  if (filter === 'unanswered') return row.replyCount === 0;
  if (filter === 'short') return row.text.trim().length < 12;
  return true;
}

function Inbox() {
  const [rows, setRows] = useState<CommentRow[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [progress, setProgress] = useState(0);
  const [filter, setFilter] = useState<Filter>('all');
  const [query, setQuery] = useState('');
  const [picked, setPicked] = useState<Set<string>>(new Set());
  const [confirm, setConfirm] = useState(false);
  const [replyTo, setReplyTo] = useState<CommentRow | null>(null);
  const [reply, setReply] = useState('');
  const [canned] = useStore<CannedResponse[]>(KEYS.canned, []);
  const toast = useToast();

  const visible = useMemo(() => rows.filter((r) => matches(r, filter, query)), [rows, filter, query]);
  const cloud = useMemo(() => wordFrequencies(rows.map((r) => r.text), 60), [rows]);
  const maxCount = cloud[0]?.count ?? 1;

  const load = async () => {
    setBusy('load');
    try {
      const channel = await getMyChannel();
      setRows(await listChannelComments(channel.id, 1000, setProgress));
      setLoaded(true);
      setPicked(new Set());
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(null);
    }
  };
  const remove = async () => {
    setBusy('remove');
    try {
      const ids = [...picked];
      await rejectComments(ids);
      setRows((all) => all.filter((r) => !picked.has(r.id)));
      setPicked(new Set());
      toast(`Removed ${ids.length} comment${ids.length === 1 ? '' : 's'}.`, 'good');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(null);
      setConfirm(false);
    }
  };

  if (!loaded) {
    return (
      <Empty title="Load your channel's comments">
        <p>Fetches the most recent 1,000 top-level comments across your videos. Costs about 10 quota units.</p>
        <p style={{ marginTop: 12 }}>
          <Button variant="primary" busy={busy === 'load'} onClick={() => void load()}>
            {busy === 'load' ? `Loading… ${progress}` : 'Load comments'}
          </Button>
        </p>
      </Empty>
    );
  }
  return (
    <div className="stack">
      <Card title="Word cloud" hint={`Most used words across ${rows.length} comments.`}>
        <div className="cloud">
          {cloud.map((w) => (
            <span key={w.word} style={{ fontSize: 12 + (w.count / maxCount) * 26, opacity: 0.55 + (w.count / maxCount) * 0.45, cursor: 'pointer' }} title={`${w.count} uses`} onClick={() => setQuery(w.word)}>
              {w.word}
            </span>
          ))}
        </div>
      </Card>
      <Card
        title={`${visible.length} of ${rows.length} comments`}
        actions={
          <>
            <Button variant="small" onClick={() => downloadFile('comments.csv', toCsv(visible as unknown as Record<string, unknown>[]), 'text/csv')}>
              Export CSV
            </Button>
            <Button variant="small" busy={busy === 'load'} onClick={() => void load()}>
              Reload
            </Button>
          </>
        }
      >
        <div className="row">
          <div className="grow">
            <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter by text or author" aria-label="Filter comments" />
          </div>
          <select value={filter} onChange={(e) => setFilter(e.target.value as Filter)} style={{ width: 220 }} aria-label="Comment filter">
            <option value="all">All comments</option>
            <option value="links">Contains a link</option>
            <option value="questions">Questions</option>
            <option value="unanswered">No replies yet</option>
            <option value="short">Very short</option>
          </select>
          <Button variant="small" onClick={() => setPicked(new Set(visible.map((r) => r.id)))}>
            Select shown
          </Button>
          <Button variant="danger" disabled={!picked.size} onClick={() => setConfirm(true)}>
            Remove {picked.size || ''} selected
          </Button>
        </div>
        <Table
          rows={visible.slice(0, 200)}
          rowKey={(r) => r.id}
          columns={[
            {
              key: 'p',
              label: '',
              render: (r) => (
                <input
                  type="checkbox"
                  aria-label={`Select comment by ${r.author}`}
                  checked={picked.has(r.id)}
                  onChange={() =>
                    setPicked((set) => {
                      const next = new Set(set);
                      if (next.has(r.id)) next.delete(r.id);
                      else next.add(r.id);
                      return next;
                    })
                  }
                />
              ),
            },
            {
              key: 'c',
              label: 'Comment',
              render: (r) => (
                <div>
                  <div className="pre">{r.text}</div>
                  <div className="small muted">
                    {r.author} · {new Date(r.publishedAt).toLocaleDateString()} ·{' '}
                    <a href={`https://www.youtube.com/watch?v=${r.videoId}&lc=${r.id}`} target="_blank" rel="noreferrer">
                      open
                    </a>
                  </div>
                </div>
              ),
            },
            { key: 'l', label: 'Likes', align: 'right', render: (r) => r.likeCount },
            { key: 'r', label: 'Replies', align: 'right', render: (r) => r.replyCount },
            {
              key: 'a',
              label: '',
              align: 'right',
              render: (r) => (
                <Button
                  variant="small"
                  onClick={() => {
                    setReplyTo(r);
                    setReply('');
                  }}
                >
                  Reply
                </Button>
              ),
            },
          ]}
        />
        {visible.length > 200 ? <div className="small muted">Showing the first 200. Narrow the filter to see the rest; the CSV export includes all {visible.length}.</div> : null}
      </Card>
      {confirm ? (
        <Modal
          title={`Remove ${picked.size} comment${picked.size === 1 ? '' : 's'}?`}
          onClose={() => setConfirm(false)}
          footer={
            <>
              <Button onClick={() => setConfirm(false)}>Cancel</Button>
              <Button variant="danger" busy={busy === 'remove'} onClick={() => void remove()}>
                Remove
              </Button>
            </>
          }
        >
          <p>The comments are rejected through YouTube's moderation API and disappear from your videos. This cannot be undone from CreatorDeck.</p>
          <p className="muted small">Costs 50 quota units per 40 comments.</p>
        </Modal>
      ) : null}
      {replyTo ? (
        <Modal
          title={`Reply to ${replyTo.author}`}
          onClose={() => setReplyTo(null)}
          footer={
            <Button
              variant="primary"
              busy={busy === 'reply'}
              disabled={!reply.trim()}
              onClick={() => {
                setBusy('reply');
                replyToComment(replyTo.id, reply)
                  .then(() => {
                    toast('Reply posted.', 'good');
                    setRows((all) => all.map((r) => (r.id === replyTo.id ? { ...r, replyCount: r.replyCount + 1 } : r)));
                    setReplyTo(null);
                  })
                  .catch((error) => toast(errorMessage(error), 'bad'))
                  .finally(() => setBusy(null));
              }}
            >
              Post reply (50 units)
            </Button>
          }
        >
          <div className="notice pre">{replyTo.text}</div>
          <Field label="Your reply">
            <textarea value={reply} onChange={(e) => setReply(e.target.value)} rows={4} aria-label="Reply text" />
          </Field>
          {canned.length ? (
            <div className="chips">
              {canned.map((c) => (
                <span key={c.id} className="chip clickable" onClick={() => setReply(c.text)}>
                  {c.name}
                </span>
              ))}
            </div>
          ) : null}
        </Modal>
      ) : null}
    </div>
  );
}

export function CommentsPage() {
  const [tab, setTab] = useState<'compose' | 'inbox'>('compose');
  return (
    <Page title="Comments" subtitle="Canned responses and formatting for replies, plus filtering, bulk removal, export and a word cloud for your own channel's comments.">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'compose', label: 'Composer and canned responses' },
          { value: 'inbox', label: 'Channel comments' },
        ]}
      />
      {tab === 'compose' ? (
        <Composer />
      ) : (
        <ConnectGate>
          <Inbox />
          <Notice>Only top-level comments are listed. Comments held for review by YouTube are not returned by this API call.</Notice>
        </ConnectGate>
      )}
    </Page>
  );
}
