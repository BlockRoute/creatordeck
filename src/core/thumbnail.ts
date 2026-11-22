import { clamp } from './text';

export interface PixelData {
  width: number;
  height: number;
  /** RGBA bytes, row-major, as in ImageData. */
  data: Uint8ClampedArray | Uint8Array;
}

export interface ThumbnailMetrics {
  /** Mean luma, 0..255. */
  brightness: number;
  /** Standard deviation of luma, 0..~128. */
  contrast: number;
  /** Hasler-Süsstrunk colourfulness; about 0 (grey) to 100+ (vivid). */
  colorfulness: number;
  /** Mean absolute luma gradient; high values mean a busy, detailed image. */
  detail: number;
  /** Detail inside the bottom-right corner, where YouTube draws the duration badge. */
  cornerDetail: number;
  dominantColors: { hex: string; share: number }[];
}

function luma(r: number, g: number, b: number): number {
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}

export function measureThumbnail(image: PixelData): ThumbnailMetrics {
  const { width, height, data } = image;
  const count = width * height;
  let sumL = 0;
  let sumL2 = 0;
  let sumRg = 0;
  let sumRg2 = 0;
  let sumYb = 0;
  let sumYb2 = 0;
  const lumas = new Float32Array(count);
  const buckets = new Map<number, number>();
  for (let i = 0; i < count; i += 1) {
    const r = data[i * 4] as number;
    const g = data[i * 4 + 1] as number;
    const b = data[i * 4 + 2] as number;
    const l = luma(r, g, b);
    lumas[i] = l;
    sumL += l;
    sumL2 += l * l;
    const rg = r - g;
    const yb = 0.5 * (r + g) - b;
    sumRg += rg;
    sumRg2 += rg * rg;
    sumYb += yb;
    sumYb2 += yb * yb;
    const key = ((r >> 5) << 6) | ((g >> 5) << 3) | (b >> 5);
    buckets.set(key, (buckets.get(key) ?? 0) + 1);
  }
  const meanL = sumL / count;
  const stdRg = Math.sqrt(Math.max(0, sumRg2 / count - (sumRg / count) ** 2));
  const stdYb = Math.sqrt(Math.max(0, sumYb2 / count - (sumYb / count) ** 2));
  const meanRgYb = Math.sqrt((sumRg / count) ** 2 + (sumYb / count) ** 2);

  let gradient = 0;
  let cornerGradient = 0;
  let cornerCount = 0;
  const cornerX = Math.floor(width * 0.78);
  const cornerY = Math.floor(height * 0.78);
  for (let y = 0; y < height - 1; y += 1) {
    for (let x = 0; x < width - 1; x += 1) {
      const i = y * width + x;
      const g = Math.abs((lumas[i] as number) - (lumas[i + 1] as number)) + Math.abs((lumas[i] as number) - (lumas[i + width] as number));
      gradient += g;
      if (x >= cornerX && y >= cornerY) {
        cornerGradient += g;
        cornerCount += 1;
      }
    }
  }

  const dominantColors = [...buckets.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 5)
    .map(([key, n]) => {
      const r = ((key >> 6) & 7) * 32 + 16;
      const g = ((key >> 3) & 7) * 32 + 16;
      const b = (key & 7) * 32 + 16;
      return { hex: `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`, share: n / count };
    });

  return {
    brightness: meanL,
    contrast: Math.sqrt(Math.max(0, sumL2 / count - meanL * meanL)),
    colorfulness: Math.sqrt(stdRg ** 2 + stdYb ** 2) + 0.3 * meanRgYb,
    detail: gradient / Math.max(1, (width - 1) * (height - 1)),
    cornerDetail: cornerCount ? cornerGradient / cornerCount : 0,
    dominantColors,
  };
}

export interface ThumbnailCheck {
  id: string;
  label: string;
  score: number;
  detail: string;
}

export interface ThumbnailReport {
  score: number;
  checks: ThumbnailCheck[];
}

/**
 * Scores a thumbnail on measurable visual properties. `metrics` should be measured on a
 * small render (about 320 px wide), which is close to how viewers actually see it.
 */
export function scoreThumbnail(metrics: ThumbnailMetrics, source: { width: number; height: number; bytes?: number }): ThumbnailReport {
  const ratio = source.width / source.height;
  const checks: ThumbnailCheck[] = [
    {
      id: 'size',
      label: 'Resolution of at least 1280×720',
      score: source.width >= 1280 && source.height >= 720 ? 1 : source.width >= 640 ? 0.5 : 0,
      detail: `${source.width}×${source.height}`,
    },
    {
      id: 'ratio',
      label: '16:9 aspect ratio',
      score: Math.abs(ratio - 16 / 9) < 0.02 ? 1 : 0,
      detail: `${ratio.toFixed(2)}:1`,
    },
    {
      id: 'contrast',
      label: 'Strong contrast',
      score: clamp(metrics.contrast / 60, 0, 1),
      detail: metrics.contrast >= 60 ? 'Light and dark areas are well separated' : 'Low contrast; the image may look flat at small sizes',
    },
    {
      id: 'brightness',
      label: 'Balanced brightness',
      score: metrics.brightness < 50 ? metrics.brightness / 50 : metrics.brightness > 215 ? clamp((255 - metrics.brightness) / 40, 0, 1) : 1,
      detail: metrics.brightness < 50 ? 'Very dark; it will sink into dark mode' : metrics.brightness > 215 ? 'Very bright; it may wash out on light backgrounds' : 'Neither too dark nor washed out',
    },
    {
      id: 'color',
      label: 'Vivid colour',
      score: clamp(metrics.colorfulness / 55, 0, 1),
      detail: metrics.colorfulness >= 55 ? 'Colours are saturated enough to stand out' : 'Muted palette; consider a bolder accent colour',
    },
    {
      id: 'clutter',
      label: 'Simple enough to read at small size',
      score: metrics.detail <= 22 ? 1 : clamp(1 - (metrics.detail - 22) / 30, 0, 1),
      detail: metrics.detail <= 22 ? 'Clear shapes with room to breathe' : 'Busy image; fine detail is lost when shown small',
    },
    {
      id: 'corner',
      label: 'Bottom-right corner kept clear',
      score: metrics.cornerDetail <= 18 ? 1 : clamp(1 - (metrics.cornerDetail - 18) / 30, 0, 1),
      detail: metrics.cornerDetail <= 18 ? 'Nothing important under the duration badge' : 'Detail in the corner will be covered by the duration badge',
    },
  ];
  if (source.bytes !== undefined) {
    checks.push({
      id: 'bytes',
      label: 'File under 2 MB',
      score: source.bytes <= 2 * 1024 * 1024 ? 1 : 0,
      detail: `${(source.bytes / 1024 / 1024).toFixed(2)} MB`,
    });
  }
  const weights: Record<string, number> = { size: 10, ratio: 10, contrast: 25, brightness: 10, color: 20, clutter: 15, corner: 10, bytes: 5 };
  const total = checks.reduce((s, c) => s + (weights[c.id] ?? 0), 0);
  const earned = checks.reduce((s, c) => s + (weights[c.id] ?? 0) * c.score, 0);
  return { score: Math.round((earned / total) * 100), checks };
}
