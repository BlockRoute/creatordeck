import { useEffect, useRef, useState } from 'react';
import { measureThumbnail, scoreThumbnail, type ThumbnailReport } from '../../core/thumbnail';
import { uid } from '../../core/text';
import { setThumbnail } from '../../yt/api';
import { parseVideoId } from '../../yt/innertube';
import { THUMB_H, THUMB_W, blobToDataUrl, exportJpegUnder2Mb, exportPng, hitTest, renderComposition, samplePixels, videoThumbnailDataUrl, type Background, type ImageLayer, type Layer, type TextLayer } from '../canvas';
import { useConnection } from '../channel';
import { Button, Card, Field, Gauge, Notice, Page, Tabs, downloadFile, errorMessage, useRoute, useToast } from '../kit';

const FONTS = ['Impact, sans-serif', 'Arial Black, sans-serif', 'system-ui, sans-serif', 'Georgia, serif', 'Courier New, monospace', 'Trebuchet MS, sans-serif'];

function newText(): TextLayer {
  return { id: uid(), kind: 'text', x: 80, y: 80, opacity: 1, text: 'YOUR TITLE', size: 140, font: FONTS[0] as string, bold: true, fill: '#ffffff', stroke: '#000000', strokeWidth: 14, shadow: true, background: null };
}

async function analyse(src: string, bytes?: number): Promise<ThumbnailReport> {
  const { pixels, sourceWidth, sourceHeight } = await samplePixels(src);
  return scoreThumbnail(measureThumbnail(pixels), { width: sourceWidth, height: sourceHeight, bytes });
}

function ReportView({ report, src }: { report: ThumbnailReport; src: string }) {
  return (
    <div className="grid c2" style={{ alignItems: 'start' }}>
      <Card title="Score">
        <div className="row" style={{ gap: 18, alignItems: 'flex-start' }}>
          <Gauge value={report.score} label="Thumbnail score" />
          <div className="grow">
            {report.checks.map((c) => (
              <div key={c.id} className="check-row">
                <span className={`dot ${c.score >= 0.9 ? 'pass' : c.score >= 0.5 ? 'part' : 'fail'}`} />
                <div>
                  <div>{c.label}</div>
                  <div className="small muted">{c.detail}</div>
                </div>
              </div>
            ))}
          </div>
        </div>
        <Notice>This score measures pixels: contrast, colour, clutter and format. It cannot judge the idea, the face or the wording. The AI Tools page has a vision-model critique for that.</Notice>
      </Card>
      <Card title="How it looks in the feed" hint="The same image at the sizes YouTube shows it.">
        {(['#0f0f0f', '#ffffff'] as const).map((bg) => (
          <div key={bg} className="row" style={{ background: bg, padding: 12, borderRadius: 10, gap: 12, alignItems: 'flex-end' }}>
            <img src={src} alt="" style={{ width: 246, borderRadius: 8 }} />
            <img src={src} alt="" style={{ width: 168, borderRadius: 6 }} />
            <img src={src} alt="" style={{ width: 120, borderRadius: 4 }} />
          </div>
        ))}
      </Card>
    </div>
  );
}

function Analyzer({ initialVideoId }: { initialVideoId: string | null }) {
  const [src, setSrc] = useState<string | null>(null);
  const [report, setReport] = useState<ThumbnailReport | null>(null);
  const [input, setInput] = useState(initialVideoId ?? '');
  const [busy, setBusy] = useState(false);
  const toast = useToast();

  const run = async (dataUrl: string, bytes?: number) => {
    setSrc(dataUrl);
    setReport(await analyse(dataUrl, bytes));
  };
  const fromVideo = async (value: string) => {
    const id = parseVideoId(value);
    if (!id) return toast('Paste a valid video link or ID.', 'bad');
    setBusy(true);
    try {
      await run(await videoThumbnailDataUrl(id));
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };
  useEffect(() => {
    if (initialVideoId) void fromVideo(initialVideoId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [initialVideoId]);

  return (
    <div className="stack">
      <Card title="Analyse a thumbnail">
        <div className="grid c2">
          <Field label="From a video">
            <div className="row">
              <div className="grow">
                <input value={input} onChange={(e) => setInput(e.target.value)} placeholder="Video link or ID" aria-label="Video for thumbnail" />
              </div>
              <Button variant="primary" busy={busy} onClick={() => void fromVideo(input)}>
                Analyse
              </Button>
            </div>
          </Field>
          <Field label="Or upload an image">
            <input
              type="file"
              accept="image/*"
              aria-label="Upload thumbnail"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void blobToDataUrl(file).then((url) => run(url, file.size), (err) => toast(errorMessage(err), 'bad'));
              }}
            />
          </Field>
        </div>
      </Card>
      {src && report ? <ReportView report={report} src={src} /> : null}
    </div>
  );
}

function Generator() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [background, setBackground] = useState<Background>({ kind: 'gradient', from: '#7c5cff', to: '#22d3ee', angle: 35 });
  const [layers, setLayers] = useState<Layer[]>([newText()]);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [videoInput, setVideoInput] = useState('');
  const [uploadTo, setUploadTo] = useState('');
  const [report, setReport] = useState<{ report: ThumbnailReport; src: string } | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);
  const { connected } = useConnection();
  const toast = useToast();
  const selected = layers.find((l) => l.id === selectedId) ?? null;

  useEffect(() => {
    if (canvasRef.current) void renderComposition(canvasRef.current, background, layers, selectedId);
  }, [background, layers, selectedId]);

  const patch = (id: string, change: Partial<TextLayer> | Partial<ImageLayer>) => setLayers((all) => all.map((l) => (l.id === id ? ({ ...l, ...change } as Layer) : l)));
  const point = (e: React.PointerEvent<HTMLCanvasElement>) => {
    const rect = e.currentTarget.getBoundingClientRect();
    return { x: ((e.clientX - rect.left) / rect.width) * THUMB_W, y: ((e.clientY - rect.top) / rect.height) * THUMB_H };
  };
  const clean = async (): Promise<HTMLCanvasElement> => {
    const canvas = document.createElement('canvas');
    canvas.width = THUMB_W;
    canvas.height = THUMB_H;
    await renderComposition(canvas, background, layers, null);
    return canvas;
  };
  const guard = async (name: string, fn: () => Promise<void>) => {
    setBusy(name);
    try {
      await fn();
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(null);
    }
  };
  const addImage = (file: File) =>
    void blobToDataUrl(file).then((src) => {
      const img = new Image();
      img.onload = () => {
        const scale = Math.min(1, 520 / img.width, 520 / img.height);
        const layer: ImageLayer = { id: uid(), kind: 'image', x: 700, y: 120, opacity: 1, src, width: img.width * scale, height: img.height * scale };
        setLayers((all) => [...all, layer]);
        setSelectedId(layer.id);
      };
      img.src = src;
    });

  return (
    <div className="grid" style={{ gridTemplateColumns: 'minmax(0, 1.7fr) minmax(280px, 1fr)', alignItems: 'start' }}>
      <div className="stack">
        <div className="canvas-stage">
          <canvas
            ref={canvasRef}
            width={THUMB_W}
            height={THUMB_H}
            aria-label="Thumbnail canvas"
            onPointerDown={(e) => {
              const p = point(e);
              const hit = canvasRef.current ? hitTest(canvasRef.current, layers, p.x, p.y) : null;
              setSelectedId(hit?.id ?? null);
              if (hit) {
                drag.current = { id: hit.id, dx: p.x - hit.x, dy: p.y - hit.y };
                e.currentTarget.setPointerCapture(e.pointerId);
              }
            }}
            onPointerMove={(e) => {
              if (!drag.current) return;
              const p = point(e);
              patch(drag.current.id, { x: Math.round(p.x - drag.current.dx), y: Math.round(p.y - drag.current.dy) });
            }}
            onPointerUp={() => {
              drag.current = null;
            }}
          />
        </div>
        <div className="row">
          <Button
            onClick={() => {
              const layer = newText();
              setLayers((all) => [...all, layer]);
              setSelectedId(layer.id);
            }}
          >
            Add text
          </Button>
          <label className="btn">
            Add image
            <input type="file" accept="image/*" hidden onChange={(e) => e.target.files?.[0] && addImage(e.target.files[0])} />
          </label>
          <Button busy={busy === 'jpg'} onClick={() => void guard('jpg', async () => downloadFile('thumbnail.jpg', await exportJpegUnder2Mb(await clean())))}>
            Download JPG
          </Button>
          <Button busy={busy === 'png'} onClick={() => void guard('png', async () => downloadFile('thumbnail.png', await exportPng(await clean())))}>
            Download PNG
          </Button>
          <Button
            busy={busy === 'score'}
            onClick={() =>
              void guard('score', async () => {
                const blob = await exportJpegUnder2Mb(await clean());
                const src = await blobToDataUrl(blob);
                setReport({ report: await analyse(src, blob.size), src });
              })
            }
          >
            Score it
          </Button>
        </div>
        {report ? <ReportView report={report.report} src={report.src} /> : null}
      </div>

      <div className="stack">
        <Card title="Background">
          <Tabs
            value={background.kind}
            onChange={(kind) =>
              setBackground(kind === 'color' ? { kind, color: '#101827' } : kind === 'gradient' ? { kind, from: '#7c5cff', to: '#22d3ee', angle: 35 } : background.kind === 'image' ? background : { kind: 'color', color: '#101827' })
            }
            options={[
              { value: 'gradient', label: 'Gradient' },
              { value: 'color', label: 'Colour' },
              { value: 'image', label: 'Image' },
            ]}
          />
          {background.kind === 'color' ? <input type="color" value={background.color} onChange={(e) => setBackground({ kind: 'color', color: e.target.value })} aria-label="Background colour" /> : null}
          {background.kind === 'gradient' ? (
            <div className="row">
              <input type="color" value={background.from} onChange={(e) => setBackground({ ...background, from: e.target.value })} aria-label="Gradient start" />
              <input type="color" value={background.to} onChange={(e) => setBackground({ ...background, to: e.target.value })} aria-label="Gradient end" />
              <input type="range" min={0} max={360} value={background.angle} onChange={(e) => setBackground({ ...background, angle: Number(e.target.value) })} aria-label="Gradient angle" />
            </div>
          ) : null}
          <Field label="Use an image">
            <input type="file" accept="image/*" aria-label="Background image" onChange={(e) => e.target.files?.[0] && void blobToDataUrl(e.target.files[0]).then((src) => setBackground({ kind: 'image', src }))} />
          </Field>
          <Field label="Or the current thumbnail of a video">
            <div className="row">
              <div className="grow">
                <input value={videoInput} onChange={(e) => setVideoInput(e.target.value)} placeholder="Video link or ID" aria-label="Background from video" />
              </div>
              <Button
                busy={busy === 'frame'}
                onClick={() =>
                  void guard('frame', async () => {
                    const id = parseVideoId(videoInput);
                    if (!id) throw new Error('Paste a valid video link or ID.');
                    setBackground({ kind: 'image', src: await videoThumbnailDataUrl(id) });
                  })
                }
              >
                Use
              </Button>
            </div>
          </Field>
        </Card>

        <Card title="Layers" hint="Click a layer on the canvas to select it; drag to move.">
          {layers.map((l, i) => (
            <div key={l.id} className="row between">
              <span className={`chip clickable ${l.id === selectedId ? 'on' : ''}`} onClick={() => setSelectedId(l.id)}>
                {l.kind === 'text' ? l.text.split('\n')[0]?.slice(0, 22) || 'Text' : 'Image'}
              </span>
              <div className="row">
                <Button variant="small" disabled={i === layers.length - 1} onClick={() => setLayers((all) => all.map((x, j) => (j === i ? (all[i + 1] as Layer) : j === i + 1 ? (all[i] as Layer) : x)))}>
                  ↑
                </Button>
                <Button variant="small" disabled={i === 0} onClick={() => setLayers((all) => all.map((x, j) => (j === i ? (all[i - 1] as Layer) : j === i - 1 ? (all[i] as Layer) : x)))}>
                  ↓
                </Button>
                <Button variant="small" onClick={() => setLayers((all) => all.filter((x) => x.id !== l.id))}>
                  Delete
                </Button>
              </div>
            </div>
          ))}
          {!layers.length ? <div className="muted small">No layers. Add text or an image.</div> : null}
        </Card>

        {selected?.kind === 'text' ? (
          <Card title="Text">
            <textarea value={selected.text} onChange={(e) => patch(selected.id, { text: e.target.value })} rows={2} aria-label="Layer text" />
            <div className="grid c2">
              <Field label={`Size ${selected.size}px`}>
                <input type="range" min={24} max={320} value={selected.size} onChange={(e) => patch(selected.id, { size: Number(e.target.value) })} />
              </Field>
              <Field label="Font">
                <select value={selected.font} onChange={(e) => patch(selected.id, { font: e.target.value })}>
                  {FONTS.map((f) => (
                    <option key={f} value={f}>
                      {f.split(',')[0]}
                    </option>
                  ))}
                </select>
              </Field>
              <Field label="Fill">
                <input type="color" value={selected.fill} onChange={(e) => patch(selected.id, { fill: e.target.value })} />
              </Field>
              <Field label={`Outline ${selected.strokeWidth}px`}>
                <div className="row">
                  <input type="color" value={selected.stroke} onChange={(e) => patch(selected.id, { stroke: e.target.value })} />
                  <input type="range" min={0} max={40} value={selected.strokeWidth} onChange={(e) => patch(selected.id, { strokeWidth: Number(e.target.value) })} />
                </div>
              </Field>
            </div>
            <div className="row">
              <label className="check">
                <input type="checkbox" checked={selected.bold} onChange={(e) => patch(selected.id, { bold: e.target.checked })} /> Bold
              </label>
              <label className="check">
                <input type="checkbox" checked={selected.shadow} onChange={(e) => patch(selected.id, { shadow: e.target.checked })} /> Shadow
              </label>
              <label className="check">
                <input type="checkbox" checked={!!selected.background} onChange={(e) => patch(selected.id, { background: e.target.checked ? '#e11d48' : null })} /> Box
              </label>
              {selected.background ? <input type="color" value={selected.background} onChange={(e) => patch(selected.id, { background: e.target.value })} aria-label="Box colour" /> : null}
            </div>
          </Card>
        ) : null}
        {selected?.kind === 'image' ? (
          <Card title="Image">
            <Field label={`Width ${Math.round(selected.width)}px`}>
              <input
                type="range"
                min={40}
                max={THUMB_W}
                value={selected.width}
                onChange={(e) => patch(selected.id, { width: Number(e.target.value), height: (Number(e.target.value) / selected.width) * selected.height })}
              />
            </Field>
            <Field label={`Opacity ${Math.round(selected.opacity * 100)}%`}>
              <input type="range" min={10} max={100} value={selected.opacity * 100} onChange={(e) => patch(selected.id, { opacity: Number(e.target.value) / 100 })} />
            </Field>
          </Card>
        ) : null}

        {connected ? (
          <Card title="Set as a video's thumbnail" hint="Uploads through the YouTube API. Costs 50 quota units.">
            <div className="row">
              <div className="grow">
                <input value={uploadTo} onChange={(e) => setUploadTo(e.target.value)} placeholder="Your video's link or ID" aria-label="Video to update" />
              </div>
              <Button
                variant="primary"
                busy={busy === 'upload'}
                onClick={() =>
                  void guard('upload', async () => {
                    const id = parseVideoId(uploadTo);
                    if (!id) throw new Error('Paste a valid video link or ID.');
                    await setThumbnail(id, await exportJpegUnder2Mb(await clean()));
                    toast('Thumbnail updated on YouTube.', 'good');
                  })
                }
              >
                Upload
              </Button>
            </div>
          </Card>
        ) : null}
      </div>
    </div>
  );
}

export function ThumbnailsPage() {
  const route = useRoute();
  const analyzeId = route.query.get('analyze');
  const [tab, setTab] = useState<'make' | 'analyze'>(analyzeId ? 'analyze' : 'make');
  return (
    <Page title="Thumbnails" subtitle="Build a 1280×720 thumbnail, then check how it reads at feed size.">
      <Tabs
        value={tab}
        onChange={setTab}
        options={[
          { value: 'make', label: 'Generator' },
          { value: 'analyze', label: 'Analyser' },
        ]}
      />
      {tab === 'make' ? <Generator /> : <Analyzer initialVideoId={analyzeId} />}
    </Page>
  );
}
