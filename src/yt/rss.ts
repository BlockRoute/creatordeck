export interface FeedEntry {
  videoId: string;
  title: string;
  published: string;
  updated: string;
  views: number | null;
  likes: number | null;
  description: string;
}

export interface ChannelFeed {
  channelId: string;
  title: string;
  entries: FeedEntry[];
}

function decode(text: string): string {
  return text
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&amp;/g, '&');
}

function tag(xml: string, name: string): string {
  const m = xml.match(new RegExp(`<${name}[^>]*>([\\s\\S]*?)</${name}>`));
  return m ? decode((m[1] as string).trim()) : '';
}

function attr(xml: string, name: string, attribute: string): string | null {
  const m = xml.match(new RegExp(`<${name}[^>]*\\b${attribute}="([^"]*)"`));
  return m ? (m[1] as string) : null;
}

/** Parses a channel's public Atom feed. Regex-based because service workers have no DOMParser. */
export function parseFeed(xml: string): ChannelFeed {
  const head = xml.split('<entry>')[0] ?? '';
  const entries = [...xml.matchAll(/<entry>([\s\S]*?)<\/entry>/g)].map((m) => {
    const entry = m[1] as string;
    const views = attr(entry, 'media:statistics', 'views');
    const likes = attr(entry, 'media:starRating', 'count');
    return {
      videoId: tag(entry, 'yt:videoId'),
      title: tag(entry, 'title'),
      published: tag(entry, 'published'),
      updated: tag(entry, 'updated'),
      views: views === null ? null : Number(views),
      likes: likes === null ? null : Number(likes),
      description: tag(entry, 'media:description'),
    };
  });
  return { channelId: tag(head, 'yt:channelId'), title: tag(head, 'title'), entries: entries.filter((e) => e.videoId) };
}

export async function fetchFeed(channelId: string): Promise<ChannelFeed> {
  const response = await fetch(`https://www.youtube.com/feeds/videos.xml?channel_id=${encodeURIComponent(channelId)}`, { credentials: 'omit' });
  if (!response.ok) throw new Error(`Channel feed returned ${response.status}`);
  return parseFeed(await response.text());
}
