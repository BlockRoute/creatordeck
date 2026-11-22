import { LLM_PRESETS } from '../shared/llm';
import { getSettings } from '../shared/settings';
import type { LlmProvider } from '../shared/types';

export function parseJsonBlock<T>(text: string): T {
  const fenced = /```(?:json)?\s*([\s\S]*?)```/.exec(text)?.[1];
  const raw = (fenced ?? text).trim();
  const start = raw.search(/[[{]/);
  if (start < 0) throw new Error('The model did not return JSON.');
  const open = raw[start];
  const end = raw.lastIndexOf(open === '[' ? ']' : '}');
  if (end <= start) throw new Error('The model returned incomplete JSON.');
  return JSON.parse(raw.slice(start, end + 1)) as T;
}

interface ChatContent {
  type: 'text' | 'image_url';
  text?: string;
  image_url?: { url: string };
}

function imageParts(prompt: string, imageDataUrl?: string): string | ChatContent[] {
  if (!imageDataUrl) return prompt;
  return [
    { type: 'text', text: prompt },
    { type: 'image_url', image_url: { url: imageDataUrl } },
  ];
}

async function readError(response: Response): Promise<string> {
  const json = (await response.json().catch(() => null)) as { error?: { message?: string } } | null;
  return json?.error?.message ?? `The model request failed with status ${response.status}.`;
}

async function openaiCompat(baseUrl: string, apiKey: string, model: string, prompt: string, imageDataUrl?: string): Promise<string> {
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/chat/completions`, {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' },
    body: JSON.stringify({ model, messages: [{ role: 'user', content: imageParts(prompt, imageDataUrl) }] }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const json = (await response.json()) as { choices?: { message?: { content?: string } }[] };
  const text = json.choices?.[0]?.message?.content;
  if (!text) throw new Error('The model returned an empty response.');
  return text;
}

async function anthropic(baseUrl: string, apiKey: string, model: string, prompt: string, imageDataUrl?: string): Promise<string> {
  const content: unknown[] = [{ type: 'text', text: prompt }];
  if (imageDataUrl) {
    const match = /^data:(.*?);base64,(.*)$/.exec(imageDataUrl);
    if (!match) throw new Error('The thumbnail could not be read.');
    content.push({ type: 'image', source: { type: 'base64', media_type: match[1], data: match[2] } });
  }
  const response = await fetch(`${baseUrl.replace(/\/$/, '')}/messages`, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'anthropic-dangerous-direct-browser-access': 'true',
      'content-type': 'application/json',
    },
    body: JSON.stringify({ model, max_tokens: 1500, messages: [{ role: 'user', content }] }),
  });
  if (!response.ok) throw new Error(await readError(response));
  const json = (await response.json()) as { content?: { text?: string }[] };
  const text = json.content?.map((part) => part.text ?? '').join('');
  if (!text) throw new Error('The model returned an empty response.');
  return text;
}

function endpoint(provider: LlmProvider, baseUrl: string, model: string): { baseUrl: string; model: string } {
  const preset = LLM_PRESETS[provider];
  return { baseUrl: baseUrl.trim() || preset.baseUrl, model: model.trim() || preset.model };
}

/** Sends one prompt to the provider configured in Settings. An image is attached when the caller has one. */
export async function complete(prompt: string, imageDataUrl?: string): Promise<string> {
  // The dashboard is a browser page, so Anthropic treats its request as a cross-origin call and rejects it.
  // The service worker has no page origin, so the same request is accepted.
  if (typeof window !== 'undefined') {
    const response = await chrome.runtime.sendMessage({ type: 'llm-complete', prompt, imageDataUrl }) as { ok?: boolean; text?: string; error?: string } | undefined;
    if (!response?.ok || !response.text) throw new Error(response?.error ?? 'The AI request did not finish.');
    return response.text;
  }
  const settings = await getSettings();
  if (!settings.llmApiKey.trim()) throw new Error('Add an API key under Settings, in the AI section.');
  const target = endpoint(settings.llmProvider, settings.llmBaseUrl, settings.llmModel);
  if (!target.baseUrl || !target.model) throw new Error('Set a base URL and a model under Settings.');
  switch (settings.llmProvider) {
    case 'anthropic':
      return anthropic(target.baseUrl, settings.llmApiKey, target.model, prompt, imageDataUrl);
    case 'openai':
    case 'xai':
    case 'openrouter':
    case 'gemini':
    case 'custom':
      return openaiCompat(target.baseUrl, settings.llmApiKey, target.model, prompt, imageDataUrl);
    default: {
      const exhaustive: never = settings.llmProvider;
      throw new Error(exhaustive);
    }
  }
}
