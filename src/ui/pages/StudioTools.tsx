import { useState } from 'react';
import { buildEndscreen, buildInfoCards, buildShortLink, applyEndscreen, applyInfoCards, linkShort, readEndScreen, type EndscreenElementInput, type InfoCardInput } from '../../services/studio';
import { parseVideoId } from '../../yt/innertube';
import { Button, Card, Field, Notice, Page, errorMessage, useToast } from '../kit';

type ElementKind = EndscreenElementInput['type'];

const POSITIONS: Record<string, { left: number; top: number; width: number }> = {
  'Top left': { left: 0.02, top: 0.05, width: 0.32 },
  'Top right': { left: 0.66, top: 0.05, width: 0.32 },
  'Bottom left': { left: 0.02, top: 0.52, width: 0.32 },
  'Bottom right': { left: 0.66, top: 0.52, width: 0.32 },
  Subscribe: { left: 0.82, top: 0.55, width: 0.15 },
};

interface DraftElement {
  type: ElementKind;
  videoType: 'best_for_viewer' | 'recent_upload' | 'fixed';
  target: string;
  position: string;
}

const BLANK: DraftElement = { type: 'video', videoType: 'best_for_viewer', target: '', position: 'Bottom left' };

export function StudioPage() {
  const [video, setVideo] = useState('');
  const [confirm, setConfirm] = useState('');
  const [startSeconds, setStartSeconds] = useState(0);
  const [elements, setElements] = useState<DraftElement[]>([{ ...BLANK }, { ...BLANK, type: 'subscribe', position: 'Subscribe' }]);
  const [cards, setCards] = useState<{ type: InfoCardInput['type']; target: string; at: number; message: string }[]>([{ type: 'video', target: '', at: 30, message: '' }]);
  const [shortId, setShortId] = useState('');
  const [related, setRelated] = useState('');
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const videoId = () => parseVideoId(video) ?? video.trim();

  const toElements = (): EndscreenElementInput[] =>
    elements.map((element) => {
      const box = POSITIONS[element.position] ?? POSITIONS['Bottom left']!;
      switch (element.type) {
        case 'video':
          return { type: 'video', videoType: element.videoType, targetVideoId: element.videoType === 'fixed' ? element.target.trim() : undefined, ...box };
        case 'playlist':
          return { type: 'playlist', playlistId: element.target.trim(), ...box };
        case 'subscribe':
          return { type: 'subscribe', channelId: element.target.trim(), ...box };
        case 'channel':
          return { type: 'channel', channelId: element.target.trim(), ...box };
        default: {
          const exhaustive: never = element.type;
          return exhaustive;
        }
      }
    });

  const toCards = (): InfoCardInput[] =>
    cards.map((card) => {
      switch (card.type) {
        case 'video':
          return { type: 'video', targetVideoId: card.target.trim(), teaserStartMs: card.at * 1000, customMessage: card.message || undefined };
        case 'playlist':
          return { type: 'playlist', playlistId: card.target.trim(), teaserStartMs: card.at * 1000, customMessage: card.message || undefined };
        case 'channel':
          return { type: 'channel', channelId: card.target.trim(), teaserStartMs: card.at * 1000, customMessage: card.message || undefined };
        default: {
          const exhaustive: never = card.type;
          return exhaustive;
        }
      }
    });

  const guard = (): string | null => {
    const id = videoId();
    if (confirm.trim() !== id) return 'Type the video ID in the confirmation box. It has to match exactly.';
    return null;
  };

  const run = async (fn: () => Promise<unknown>) => {
    const problem = guard();
    if (problem) return toast(problem, 'warn');
    setBusy(true);
    try {
      const result = await fn();
      setPreview(JSON.stringify(result, null, 2).slice(0, 4000));
      toast('Studio accepted the change. Open the video in YouTube Studio to confirm it looks right.', 'good');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Cards, end screens and Shorts" subtitle="Experimental. YouTube's public API cannot edit these, so this uses the Studio session already signed in to this browser. The requests can change or be rejected, and a failure leaves the video untouched.">
      <Notice tone="warn">Sign in to YouTube in this same Chrome profile. This does not use your API client. Apply only to videos on the channel you are signed into, and confirm the video ID before writing.</Notice>
      <Card title="Video">
        <div className="grid c2">
          <Field label="Video link or ID"><input value={video} onChange={(e) => setVideo(e.target.value)} /></Field>
          <Field label="Type the video ID to confirm a write"><input value={confirm} onChange={(e) => setConfirm(e.target.value)} /></Field>
        </div>
        <Button
          onClick={() => {
            setBusy(true);
            void readEndScreen(videoId())
              .then((result) => setPreview(JSON.stringify(result, null, 2).slice(0, 4000)))
              .catch((error) => toast(errorMessage(error), 'bad'))
              .finally(() => setBusy(false));
          }}
          busy={busy}
        >
          Read current end screen
        </Button>
      </Card>
      <Card title="End screen">
        <Field label="Starts at (seconds from the beginning)">
          <input type="number" min={0} value={startSeconds} onChange={(e) => setStartSeconds(Number(e.target.value))} />
        </Field>
        {elements.map((element, index) => (
          <div key={index} className="grid c2">
            <Field label={`Element ${index + 1}`}>
              <select value={element.type} onChange={(e) => setElements((list) => list.map((item, i) => (i === index ? { ...item, type: e.target.value as ElementKind } : item)))}>
                <option value="video">Video</option>
                <option value="playlist">Playlist</option>
                <option value="subscribe">Subscribe</option>
                <option value="channel">Channel</option>
              </select>
            </Field>
            <Field label="Position">
              <select value={element.position} onChange={(e) => setElements((list) => list.map((item, i) => (i === index ? { ...item, position: e.target.value } : item)))}>
                {Object.keys(POSITIONS).map((name) => <option key={name}>{name}</option>)}
              </select>
            </Field>
            {element.type === 'video' ? (
              <Field label="Which video">
                <select value={element.videoType} onChange={(e) => setElements((list) => list.map((item, i) => (i === index ? { ...item, videoType: e.target.value as DraftElement['videoType'] } : item)))}>
                  <option value="best_for_viewer">Best for viewer</option>
                  <option value="recent_upload">Recent upload</option>
                  <option value="fixed">A specific video</option>
                </select>
              </Field>
            ) : null}
            {element.type !== 'video' || element.videoType === 'fixed' ? (
              <Field label={element.type === 'playlist' ? 'Playlist ID' : element.type === 'video' ? 'Video ID' : 'Channel ID'}>
                <input value={element.target} onChange={(e) => setElements((list) => list.map((item, i) => (i === index ? { ...item, target: e.target.value } : item)))} />
              </Field>
            ) : null}
          </div>
        ))}
        <div className="row">
          {elements.length < 4 ? <Button variant="ghost" onClick={() => setElements((list) => [...list, { ...BLANK }])}>Add element</Button> : null}
          <Button variant="ghost" onClick={() => { try { setPreview(JSON.stringify(buildEndscreen(videoId(), startSeconds * 1000, toElements()), null, 2)); } catch (error) { toast(errorMessage(error), 'bad'); } }}>Preview payload</Button>
          <Button variant="primary" busy={busy} onClick={() => void run(() => applyEndscreen(videoId(), startSeconds * 1000, toElements()))}>Apply end screen</Button>
        </div>
      </Card>
      <Card title="Cards">
        {cards.map((card, index) => (
          <div key={index} className="grid c3">
            <Field label="Type">
              <select value={card.type} onChange={(e) => setCards((list) => list.map((item, i) => (i === index ? { ...item, type: e.target.value as InfoCardInput['type'] } : item)))}>
                <option value="video">Video</option>
                <option value="playlist">Playlist</option>
                <option value="channel">Channel</option>
              </select>
            </Field>
            <Field label="Target ID"><input value={card.target} onChange={(e) => setCards((list) => list.map((item, i) => (i === index ? { ...item, target: e.target.value } : item)))} /></Field>
            <Field label="Show teaser at (seconds)"><input type="number" min={0} value={card.at} onChange={(e) => setCards((list) => list.map((item, i) => (i === index ? { ...item, at: Number(e.target.value) } : item)))} /></Field>
          </div>
        ))}
        <div className="row">
          <Button variant="ghost" onClick={() => { try { setPreview(JSON.stringify(buildInfoCards(videoId(), toCards()), null, 2)); } catch (error) { toast(errorMessage(error), 'bad'); } }}>Preview payload</Button>
          <Button variant="primary" busy={busy} onClick={() => void run(() => applyInfoCards(videoId(), toCards()))}>Apply cards</Button>
        </div>
      </Card>
      <Card title="Link a Short to a long video">
        <div className="grid c2">
          <Field label="Short ID"><input value={shortId} onChange={(e) => setShortId(e.target.value)} /></Field>
          <Field label="Long video ID"><input value={related} onChange={(e) => setRelated(e.target.value)} /></Field>
        </div>
        <div className="row">
          <Button variant="ghost" onClick={() => { try { setPreview(JSON.stringify(buildShortLink(shortId.trim(), related.trim()), null, 2)); } catch (error) { toast(errorMessage(error), 'bad'); } }}>Preview payload</Button>
          <Button
            variant="primary"
            busy={busy}
            onClick={() => {
              if (confirm.trim() !== shortId.trim()) return toast('Type the Short ID in the confirmation box.', 'warn');
              setBusy(true);
              void linkShort(shortId.trim(), related.trim())
                .then((result) => {
                  setPreview(JSON.stringify(result, null, 2).slice(0, 4000));
                  toast('Studio accepted the link. Confirm it on the Short.', 'good');
                })
                .catch((error) => toast(errorMessage(error), 'bad'))
                .finally(() => setBusy(false));
            }}
          >
            Link Short
          </Button>
        </div>
      </Card>
      {preview ? <Card title="Last payload or response"><pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{preview}</pre></Card> : null}
    </Page>
  );
}
