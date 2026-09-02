/**
 * you.com Research API boundary — ported from comic-book-pipeline's
 * stages/research_scout/youcom.py (request shape) and stages/youcom_scout.py
 * (the schema convention). you.com sits behind Cloudflare and 403s
 * ("error code: 1010") any request without a real User-Agent — probed by the
 * Python pipeline on 2026-08-05, still true here.
 */
import { readFileSync } from 'node:fs';

const RESEARCH_API = 'https://api.you.com/v1/research';
const TIMEOUT_MS = 15 * 60 * 1000;

// The Python pipeline's own key store — reused so this project never needs
// its own copy of the same secrets. Read-only: never write to that repo.
const OTHER_REPO_ENV = '/Users/nhanvu/Documents/code/comic-book-pipeline/.env';

/** `YDC_API_KEY` / `GEMINI_API_KEY` / `TAVILY_API_KEY`: env first, else the other repo's .env. */
export function readKey(name: string): string {
  const fromEnv = (process.env[name] || '').trim();
  if (fromEnv) return fromEnv;
  try {
    const text = readFileSync(OTHER_REPO_ENV, 'utf8');
    const m = text.match(new RegExp(`^${name}=(.+)$`, 'm'));
    if (m) return m[1].trim().replace(/^["']|["']$/g, '');
  } catch {
    // no .env to fall back to — caller decides whether a missing key is fatal
  }
  return '';
}

export type ResearchOpts = {
  input: string;
  schema: unknown;
  domains: string[];
  effort?: 'standard' | 'deep';
};

/**
 * Runs one you.com Research call and returns the parsed `output.content`.
 * Strict schema in, strict JSON out — but you.com sometimes still wraps the
 * content as a JSON *string* rather than an object, so this always tries a
 * parse before handing it back.
 */
export async function research(opts: ResearchOpts): Promise<any> {
  const key = readKey('YDC_API_KEY');
  if (!key) throw new Error('YDC_API_KEY not set (env or comic-book-pipeline/.env)');

  const body = JSON.stringify({
    input: opts.input,
    research_effort: opts.effort ?? 'standard',
    source_control: { include_domains: opts.domains },
    output_schema: opts.schema,
  });

  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  let res: Response;
  try {
    res = await fetch(RESEARCH_API, {
      method: 'POST',
      headers: {
        'X-API-Key': key,
        'Content-Type': 'application/json',
        Accept: 'application/json',
        // WAF 403s the default fetch UA — always send a real one.
        'User-Agent': 'sport-scout/1.0',
      },
      body,
      signal: controller.signal,
    });
  } finally {
    clearTimeout(timer);
  }

  const text = await res.text();
  if (!res.ok) {
    throw new Error(`you.com research HTTP ${res.status}: ${text.slice(0, 200)}`);
  }

  const payload = JSON.parse(text);
  let content = payload?.output?.content;
  if (typeof content === 'string') {
    try {
      content = JSON.parse(content);
    } catch {
      // left as a string — caller sees whatever you.com actually sent
    }
  }
  return content;
}
