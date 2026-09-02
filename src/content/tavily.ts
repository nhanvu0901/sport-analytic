/**
 * Tavily search boundary — backs g2 (same-format): a plain web search
 * restricted to youtube.com stands in for the YouTube Data API (no separate
 * key needed) to check whether a video already answers this exact framing.
 */
import { readKey } from './youcom';

const SEARCH_API = 'https://api.tavily.com/search';
const TIMEOUT_MS = 45_000;

export type TavilyHit = { title: string; url: string };

export async function searchSite(query: string, domains: string[], max = 6): Promise<TavilyHit[]> {
  const key = readKey('TAVILY_API_KEY');
  if (!key) throw new Error('TAVILY_API_KEY not set (env or comic-book-pipeline/.env)');

  const body = JSON.stringify({
    api_key: key,
    query,
    max_results: max,
    search_depth: 'basic',
    include_domains: domains,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(SEARCH_API, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`tavily search HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const payload = JSON.parse(text);
  const results = Array.isArray(payload?.results) ? payload.results : [];
  return results.map((r: any) => ({ title: String(r?.title ?? ''), url: String(r?.url ?? '') }));
}
