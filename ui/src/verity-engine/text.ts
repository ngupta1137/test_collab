// @ts-nocheck
// Copied from the Verity engine repo (src/engine, src/agents, src/gateway). Type-checked and tested there
// (node --test, 13 tests; evals/run.ts). Do not edit here: change it in verity and copy again.
// Text normalization shared by query time and index time, so the lexicon
// rewrites both sides the same way ("MO" in a synonym and "mo" in a query
// both become "mail order").

// Conversational filler and function words. Fixed before the first eval run.
export const STOPWORDS = new Set([
  'a', 'an', 'the', 'and', 'or', 'of', 'to', 'in', 'on', 'at', 'for', 'by', 'with', 'from',
  'is', 'are', 'was', 'be', 'it', 'its', 'this', 'that', 'there', 'their',
  'i', 'me', 'my', 'we', 'you', 'your', 'he', 'she', 'they', 'them',
  'do', 'does', 'did', 'can', 'could', 'will', 'would', 'should', 'may', 'might',
  'what', 'how', 'when', 'where', 'which', 'who', 'why', 'many', 'much',
  'say', 'tell', 'know', 'need', 'want', 'wants', 'get', 'please', 'about', 'any',
  // contractions typed without apostrophes (F10)
  'whats', 'hows', 'wheres', 'whens', 'whos', 'im', 'ive', 'dont', 'doesnt', 'didnt', 'cant', 'wont', 'isnt', 'arent', 'theres', 'thats', 'shes', 'hes', 'theyre', 'youre',
]);

export function normalizeSpace(s: string): string {
  return s
    .replace(/[‘’]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/\s+/g, ' ')
    .replace(/\s+([.,;:!?])/g, '$1')
    .trim();
}

export function basicNormalize(s: string): string {
  return s
    .toLowerCase()
    .replace(/['\u2019]/g, '')
    .replace(/[^a-z0-9&\s-]/g, ' ')
    .replace(/-/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export type Lexicon = Record<string, string>;

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

// Replace lexicon phrases as whole words, longest key first, two passes so
// chains resolve ("are ex" -> "rx" -> "prescription").
export function applyLexicon(normalized: string, lex: Lexicon): { text: string; hits: string[] } {
  const keys = Object.keys(lex).sort((a, b) => b.length - a.length);
  let text = normalized;
  const hits: string[] = [];
  for (let pass = 0; pass < 2; pass++) {
    for (const key of keys) {
      const k = basicNormalize(key);
      const re = new RegExp(`(^|\\s)${escapeRe(k)}(?=\\s|$)`, 'g');
      if (re.test(text)) {
        text = text.replace(re, `$1${basicNormalize(lex[key])}`);
        hits.push(`${key} -> ${lex[key]}`);
      }
    }
  }
  return { text, hits };
}

function stem(t: string): string {
  if (t.length > 4 && t.endsWith('ies')) return t.slice(0, -3) + 'y';
  if (t.length > 3 && t.endsWith('s') && !t.endsWith('ss')) return t.slice(0, -1);
  return t;
}

export function tokens(text: string): string[] {
  return text.split(' ').filter((t) => t && !STOPWORDS.has(t)).map(stem);
}

export function prepare(raw: string, lex: Lexicon): { tokens: string[]; text: string; hits: string[] } {
  const { text, hits } = applyLexicon(basicNormalize(raw), lex);
  return { tokens: tokens(text), text, hits };
}
