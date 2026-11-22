import type { LlmProvider } from './types';

export const LLM_PRESETS: Record<LlmProvider, { label: string; baseUrl: string; model: string }> = {
  openai: { label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-4o-mini' },
  anthropic: { label: 'Anthropic', baseUrl: 'https://api.anthropic.com/v1', model: 'claude-sonnet-4-5' },
  xai: { label: 'xAI', baseUrl: 'https://api.x.ai/v1', model: 'grok-4' },
  openrouter: { label: 'OpenRouter', baseUrl: 'https://openrouter.ai/api/v1', model: 'openai/gpt-4o-mini' },
  gemini: { label: 'Google Gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta/openai', model: 'gemini-2.5-flash' },
  custom: { label: 'Custom (OpenAI-compatible)', baseUrl: '', model: '' },
};
