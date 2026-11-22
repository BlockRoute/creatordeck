import { useState } from 'react';
import { exportJpegUnder2Mb, loadImage, videoThumbnailDataUrl } from '../canvas';
import { saveBackup } from '../../services/bulk';
import { setThumbnail } from '../../yt/api';
import type { VideoMeta } from '../../shared/types';
import { ConnectGate, LibraryGate, QuotaWarning, useConnection } from '../channel';
import { Button, Card, Field, Notice, Page, errorMessage, useToast } from '../kit';

type Corner = 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right';

function place(corner: Corner, width: number, height: number): { x: number; y: number } {
  const pad = 36;
  switch (corner) {
    case 'top-left':
      return { x: pad, y: pad };
    case 'top-right':
      return { x: 1280 - width - pad, y: pad };
    case 'bottom-left':
      return { x: pad, y: 720 - height - pad };
    case 'bottom-right':
      return { x: 1280 - width - pad, y: 720 - height - pad };
    default: {
      const exhaustive: never = corner;
      return exhaustive;
    }
  }
}

async function compose(videoId: string, overlayUrl: string, corner: Corner, scale: number): Promise<Blob> {
  const base = await videoThumbnailDataUrl(videoId);
  const canvas = document.createElement('canvas');
  canvas.width = 1280;
  canvas.height = 720;
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('Canvas is not available.');
  const background = await loadImage(base);
  const overlay = await loadImage(overlayUrl);
  ctx.drawImage(background, 0, 0, 1280, 720);
  const width = 1280 * scale;
  const height = width * (overlay.naturalHeight / Math.max(1, overlay.naturalWidth));
  const at = place(corner, width, height);
  ctx.drawImage(overlay, at.x, at.y, width, height);
  return exportJpegUnder2Mb(canvas);
}

export function OverlaysPage() {
  return (
    <ConnectGate>
      <LibraryGate>{(library) => <OverlayEditor videos={library.items} />}</LibraryGate>
    </ConnectGate>
  );
}

function OverlayEditor({ videos }: { videos: VideoMeta[] }) {
  const { channel } = useConnection();
  const [picked, setPicked] = useState<string[]>([]);
  const [overlay, setOverlay] = useState('');
  const [corner, setCorner] = useState<Corner>('bottom-left');
  const [scale, setScale] = useState(0.22);
  const [preview, setPreview] = useState('');
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState('');
  const toast = useToast();

  const previewOne = async () => {
    const id = picked[0];
    if (!id || !overlay) return toast('Choose an overlay and at least one video.', 'warn');
    setBusy(true);
    try {
      const blob = await compose(id, overlay, corner, scale);
      setPreview(URL.createObjectURL(blob));
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  const apply = async () => {
    if (!overlay || !picked.length) return toast('Choose an overlay and at least one video.', 'warn');
    if (!window.confirm(`Replace the thumbnail on ${picked.length} video${picked.length === 1 ? '' : 's'}? This cannot be undone from here.`)) return;
    setBusy(true);
    const lines: string[] = [];
    try {
      const chosen = videos.filter((video) => picked.includes(video.id));
      await saveBackup('Before thumbnail overlays', channel?.id ?? '', chosen);
      for (const video of chosen) {
        try {
          const blob = await compose(video.id, overlay, corner, scale);
          await setThumbnail(video.id, blob);
          lines.push(`Updated ${video.title}`);
        } catch (error) {
          lines.push(`Failed ${video.title}: ${errorMessage(error)}`);
        }
        setLog(lines.join('\n'));
      }
      toast('Finished. A metadata backup was saved; download any thumbnail you still want from YouTube.', 'good');
    } catch (error) {
      toast(errorMessage(error), 'bad');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Page title="Thumbnail overlays" subtitle="Draws one image on top of each selected video's current thumbnail and uploads the result. Dry-run the first video before applying.">
      <Notice>YouTube stores a single custom thumbnail. This replaces it. The metadata backup does not contain the old image, so save a copy from YouTube first if you need it back.</Notice>
      <Card>
        <Field label="Overlay image (PNG with transparency works best)">
          <input type="file" accept="image/png,image/jpeg" onChange={(e) => {
            const file = e.target.files?.[0];
            if (!file) return;
            const reader = new FileReader();
            reader.onload = () => setOverlay(String(reader.result));
            reader.readAsDataURL(file);
          }} />
        </Field>
        <div className="grid c2">
          <Field label="Corner">
            <select value={corner} onChange={(e) => setCorner(e.target.value as Corner)}>
              <option value="top-left">Top left</option>
              <option value="top-right">Top right</option>
              <option value="bottom-left">Bottom left</option>
              <option value="bottom-right">Bottom right</option>
            </select>
          </Field>
          <Field label="Width" hint="share of the 1280px frame">
            <input type="number" min={0.05} max={0.6} step={0.01} value={scale} onChange={(e) => setScale(Number(e.target.value))} />
          </Field>
        </div>
        <Field label="Videos">
          <div className="stack" style={{ maxHeight: 240, overflow: 'auto' }}>
            {videos.slice(0, 100).map((video) => (
              <label key={video.id} className="row">
                <input type="checkbox" checked={picked.includes(video.id)} onChange={() => setPicked((list) => (list.includes(video.id) ? list.filter((id) => id !== video.id) : [...list, video.id]))} />
                {video.title}
              </label>
            ))}
          </div>
        </Field>
        <QuotaWarning cost={50 * Math.max(1, picked.length)} />
        <div className="row end">
          <Button busy={busy} onClick={() => void previewOne()}>Preview first</Button>
          <Button variant="primary" busy={busy} onClick={() => void apply()}>Apply</Button>
        </div>
        {preview ? <img src={preview} alt="Overlay preview" style={{ width: '100%', maxWidth: 640, borderRadius: 8 }} /> : null}
        {log ? <pre className="mono" style={{ whiteSpace: 'pre-wrap' }}>{log}</pre> : null}
      </Card>
    </Page>
  );
}
