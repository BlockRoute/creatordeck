export const THUMB_W = 1280;
export const THUMB_H = 720;

interface LayerBase {
  id: string;
  x: number;
  y: number;
  opacity: number;
}

export interface TextLayer extends LayerBase {
  kind: 'text';
  text: string;
  size: number;
  font: string;
  bold: boolean;
  fill: string;
  stroke: string;
  strokeWidth: number;
  shadow: boolean;
  background: string | null;
}

export interface ImageLayer extends LayerBase {
  kind: 'image';
  /** Data URL, so layers survive being stored in templates. */
  src: string;
  width: number;
  height: number;
}

export type Layer = TextLayer | ImageLayer;

export type Background = { kind: 'color'; color: string } | { kind: 'gradient'; from: string; to: string; angle: number } | { kind: 'image'; src: string };

const imageCache = new Map<string, Promise<HTMLImageElement>>();

export function loadImage(src: string): Promise<HTMLImageElement> {
  let cached = imageCache.get(src);
  if (!cached) {
    cached = new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image();
      img.onload = () => resolve(img);
      img.onerror = () => reject(new Error('That image could not be loaded.'));
      img.src = src;
    });
    imageCache.set(src, cached);
  }
  return cached;
}

export function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result as string);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(blob);
  });
}

/** Fetches a remote image through the extension (which has host access) so the canvas is not tainted. */
export async function fetchImageDataUrl(url: string): Promise<string> {
  const response = await fetch(url, { credentials: 'omit' });
  if (!response.ok) throw new Error(`The image could not be downloaded (status ${response.status}).`);
  return blobToDataUrl(await response.blob());
}

export async function videoThumbnailDataUrl(videoId: string): Promise<string> {
  for (const name of ['maxresdefault', 'sddefault', 'hqdefault']) {
    try {
      return await fetchImageDataUrl(`https://i.ytimg.com/vi/${videoId}/${name}.jpg`);
    } catch {
      // Older or low-resolution uploads only have the smaller sizes.
    }
  }
  throw new Error('No thumbnail could be downloaded for that video.');
}

function fontOf(layer: TextLayer): string {
  return `${layer.bold ? '800' : '500'} ${layer.size}px ${layer.font}`;
}

export function measureLayer(ctx: CanvasRenderingContext2D, layer: Layer): { width: number; height: number } {
  if (layer.kind === 'image') return { width: layer.width, height: layer.height };
  ctx.font = fontOf(layer);
  const lines = layer.text.split('\n');
  return { width: Math.max(...lines.map((l) => ctx.measureText(l).width), 1), height: lines.length * layer.size * 1.15 };
}

async function drawBackground(ctx: CanvasRenderingContext2D, background: Background, w: number, h: number): Promise<void> {
  if (background.kind === 'color') {
    ctx.fillStyle = background.color;
    ctx.fillRect(0, 0, w, h);
  } else if (background.kind === 'gradient') {
    const rad = (background.angle * Math.PI) / 180;
    const dx = (Math.cos(rad) * w) / 2;
    const dy = (Math.sin(rad) * h) / 2;
    const gradient = ctx.createLinearGradient(w / 2 - dx, h / 2 - dy, w / 2 + dx, h / 2 + dy);
    gradient.addColorStop(0, background.from);
    gradient.addColorStop(1, background.to);
    ctx.fillStyle = gradient;
    ctx.fillRect(0, 0, w, h);
  } else {
    const img = await loadImage(background.src);
    // Cover: scale to fill, then centre-crop.
    const scale = Math.max(w / img.width, h / img.height);
    const dw = img.width * scale;
    const dh = img.height * scale;
    ctx.drawImage(img, (w - dw) / 2, (h - dh) / 2, dw, dh);
  }
}

export async function renderComposition(canvas: HTMLCanvasElement, background: Background, layers: Layer[], selectedId?: string | null): Promise<void> {
  const ctx = canvas.getContext('2d');
  if (!ctx) return;
  ctx.clearRect(0, 0, canvas.width, canvas.height);
  await drawBackground(ctx, background, canvas.width, canvas.height);
  for (const layer of layers) {
    ctx.save();
    ctx.globalAlpha = layer.opacity;
    if (layer.kind === 'image') {
      ctx.drawImage(await loadImage(layer.src), layer.x, layer.y, layer.width, layer.height);
    } else {
      ctx.font = fontOf(layer);
      ctx.textBaseline = 'top';
      const size = measureLayer(ctx, layer);
      if (layer.background) {
        const pad = layer.size * 0.22;
        ctx.fillStyle = layer.background;
        ctx.beginPath();
        ctx.roundRect(layer.x - pad, layer.y - pad, size.width + pad * 2, size.height + pad * 2, pad);
        ctx.fill();
      }
      if (layer.shadow) {
        ctx.shadowColor = 'rgba(0,0,0,0.65)';
        ctx.shadowBlur = layer.size * 0.18;
        ctx.shadowOffsetY = layer.size * 0.06;
      }
      layer.text.split('\n').forEach((line, i) => {
        const y = layer.y + i * layer.size * 1.15;
        if (layer.strokeWidth > 0) {
          ctx.lineJoin = 'round';
          ctx.lineWidth = layer.strokeWidth;
          ctx.strokeStyle = layer.stroke;
          ctx.strokeText(line, layer.x, y);
        }
        ctx.fillStyle = layer.fill;
        ctx.fillText(line, layer.x, y);
      });
    }
    ctx.restore();
    if (layer.id === selectedId) {
      const size = measureLayer(ctx, layer);
      ctx.save();
      ctx.strokeStyle = '#22d3ee';
      ctx.lineWidth = 3;
      ctx.setLineDash([10, 6]);
      ctx.strokeRect(layer.x - 6, layer.y - 6, size.width + 12, size.height + 12);
      ctx.restore();
    }
  }
}

export function hitTest(canvas: HTMLCanvasElement, layers: Layer[], x: number, y: number): Layer | null {
  const ctx = canvas.getContext('2d');
  if (!ctx) return null;
  for (let i = layers.length - 1; i >= 0; i -= 1) {
    const layer = layers[i] as Layer;
    const size = measureLayer(ctx, layer);
    if (x >= layer.x - 6 && x <= layer.x + size.width + 6 && y >= layer.y - 6 && y <= layer.y + size.height + 6) return layer;
  }
  return null;
}

function toBlob(canvas: HTMLCanvasElement, type: string, quality?: number): Promise<Blob> {
  return new Promise((resolve, reject) => canvas.toBlob((b) => (b ? resolve(b) : reject(new Error('Export failed.'))), type, quality));
}

/** Exports as JPEG, lowering quality until the file fits YouTube's 2 MB thumbnail limit. */
export async function exportJpegUnder2Mb(canvas: HTMLCanvasElement): Promise<Blob> {
  let blob = await toBlob(canvas, 'image/jpeg', 0.92);
  for (const quality of [0.85, 0.75, 0.65, 0.5]) {
    if (blob.size <= 2 * 1024 * 1024) break;
    blob = await toBlob(canvas, 'image/jpeg', quality);
  }
  return blob;
}

export async function exportPng(canvas: HTMLCanvasElement): Promise<Blob> {
  return toBlob(canvas, 'image/png');
}

/** Renders an image at a small size and returns its pixels for analysis. */
export async function samplePixels(src: string, width = 320): Promise<{ pixels: ImageData; sourceWidth: number; sourceHeight: number }> {
  const img = await loadImage(src);
  const height = Math.max(1, Math.round((img.height / img.width) * width));
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const ctx = canvas.getContext('2d', { willReadFrequently: true });
  if (!ctx) throw new Error('Canvas is not available.');
  ctx.drawImage(img, 0, 0, width, height);
  return { pixels: ctx.getImageData(0, 0, width, height), sourceWidth: img.width, sourceHeight: img.height };
}
