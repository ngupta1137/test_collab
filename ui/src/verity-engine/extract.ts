// @ts-nocheck
// Copied from the Verity engine repo src/engine/extract.ts (tested there: npm test). Do not edit here; change it in the verity repo and copy again.
// Source document -> candidate knowledge units (FOUNDATIONS section 9, authoring).
//
// This is the rules-based BASELINE extractor ("rules-v0"). In production the
// extraction agent (a model behind the gateway) proposes the units; this
// baseline does the same job with deterministic rules so the authoring flow
// works with no model and no API key, and so the model version has something
// to beat on the same checks.
//
// Whatever proposes the units, the next steps are deterministic: every
// candidate is compared with the approved units (hash, then word diff), and
// nothing is published here. Candidates go to the approval queue.

import type { KnowledgeUnit } from './types.ts';
import { checkChange, normalizeForHash, type DriftResult } from './drift.ts';

export const EXTRACTOR_VERSION = 'rules-v0';

export type CandidateType = 'verbatim' | 'procedure' | 'fact';

export type MatchStatus =
  | 'unchanged' // identical (after normalization) to an approved unit: nothing to do
  | 'changed' // same topic as an approved unit, different text: drift flag, routed for review
  | 'new'; // no approved unit covers it: draft for review

export interface CandidateUnit {
  cid: string;
  title: string;
  type: CandidateType;
  body: string;
  verbatim: boolean;
  knowledge_base: string;
  owner: string;
  source_doc: string;
  source_section: string;
  effective_date: string;
  review_date: string;
  suggested_synonyms: string[];
  match: {
    status: MatchStatus;
    unit_id: string | null;
    unit_title: string | null;
    similarity: number;
    drift: DriftResult | null;
  };
  route_to: string;
  extractor: string;
  suggestions: Suggestion[];
}

/**
 * Reviewer suggestions (the brief's "AI recommends" row). Advisory only: a
 * person accepts or ignores them in the review queue.
 * - merge: a new candidate that probably restates an existing unit
 * - split: one candidate that holds several separate facts
 * - tags: applicability (line of business, states, plan year) and synonyms the
 *   text itself supports. Only what the source states is proposed; the default
 *   scope is never widened or narrowed by guesswork.
 */
export type Suggestion =
  | { kind: 'merge'; unit_id: string; unit_title: string; overlap: number; reason: string }
  | { kind: 'split'; parts: { text: string; unit_id: string | null; unit_title: string | null }[]; reason: string }
  | { kind: 'tags'; lob: string[] | null; states: string[] | null; plan_year: number | null; synonyms: string[]; evidence: string[]; reason: string };

export interface SkippedLine {
  text: string;
  reason: string;
}

export interface ExtractionResult {
  doc_id: string;
  title: string;
  owner: string;
  effective_date: string;
  candidates: CandidateUnit[];
  skipped: SkippedLine[];
  lifecycle_notes: string[];
  extractor: string;
}

const STOP = new Set(['the', 'a', 'an', 'and', 'or', 'of', 'to', 'for', 'in', 'on', 'by', 'is', 'are', 'be', 'with', 'your', 'this', 'that', 'can', 'may', 'will', 'it', 'as', 'at', 'from', 'any', 'their', 'members', 'member']);

function isoFromUs(s: string | undefined): string | null {
  const m = s?.match(/(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (!m) return null;
  return `${m[3]}-${m[1]!.padStart(2, '0')}-${m[2]!.padStart(2, '0')}`;
}

function plusOneYear(iso: string): string {
  return `${Number(iso.slice(0, 4)) + 1}${iso.slice(4)}`;
}

function titleCase(s: string): string {
  const t = s.replace(/[\[\]*:]/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  return t.charAt(0).toUpperCase() + t.slice(1);
}

/** "[EDUCATION] Pricing disclaimer" -> "Pricing disclaimer"; "[OPENING]" -> "Opening". */
function sectionName(section: string): string {
  const rest = section.replace(/^\[[^\]]+\]\s*/, '');
  return (rest || section.replace(/^\[|\]$/g, '')).replace(/\(aka.*$/i, '').trim();
}

function kbFor(docId: string, verbatim: boolean, section: string): string {
  // Call openings and closings are shared across teams; everything else stays
  // in the knowledge base of the source document.
  if (verbatim && /open|clos|intro|wrap/i.test(section)) return 'KB-SHARED';
  const m = docId.match(/^(KB-[A-Z]+)/);
  return m ? m[1]! : 'KB-UNASSIGNED';
}

function contentWords(s: string): string[] {
  return normalizeForHash(s).replace(/[^a-z0-9\s-]/g, ' ').split(/\s+/).filter((w) => w.length > 2 && !STOP.has(w));
}

function jaccard(a: string, b: string): number {
  const x = new Set(contentWords(a));
  const y = new Set(contentWords(b));
  if (!x.size || !y.size) return 0;
  const inter = [...x].filter((w) => y.has(w)).length;
  return Math.round((inter / new Set([...x, ...y]).size) * 100) / 100;
}

// Changed-vs-new threshold on content-word overlap. Chosen on the three
// synthetic documents; reported, not tuned per case (evals/EXTRACTION.md).
export const MATCH_THRESHOLD = 0.4;

interface Raw {
  title: string;
  type: CandidateType;
  body: string;
  verbatim: boolean;
  section: string;
  review?: string | null;
  labeled?: boolean;
}

/** Split a messy source document into raw candidates. Deterministic. */
function segment(text: string): { header: Record<string, string>; title: string; raws: Raw[]; skipped: SkippedLine[]; notes: string[] } {
  const lines = text.split(/\r?\n/);
  const header: Record<string, string> = {};
  const raws: Raw[] = [];
  const skipped: SkippedLine[] = [];
  const notes: string[] = [];
  const title = titleCase((lines[0] ?? '').replace(/\(SYNTHETIC.*$/i, ''));
  let section = 'Document';
  let list: { title: string; items: string[]; numbered: boolean; section: string } | null = null;
  let prevWasPlain = false;

  const flush = () => {
    if (!list) return;
    if (list.numbered) {
      raws.push({ title: list.title, type: 'procedure', body: list.items.map((it, i) => `${i + 1}) ${it.replace(/\.?$/, '.')}`).join(' '), verbatim: false, section: list.section });
    } else {
      for (const it of list.items) raws.push({ title: `${list.title}: ${it.split(/\s+/).slice(0, 5).join(' ')}`, type: 'fact', body: it.replace(/\.?$/, '.'), verbatim: false, section: list.section });
    }
    list = null;
  };

  for (const rawLine of lines.slice(1)) {
    const line = rawLine.trim();
    if (!line) { prevWasPlain = false; continue; }
    const wasPlain = prevWasPlain;
    prevWasPlain = false;
    if (/^doc id:/i.test(line)) {
      for (const part of line.split('|')) {
        const [k, ...v] = part.split(':');
        if (k && v.length) header[k.trim().toLowerCase()] = v.join(':').trim();
      }
      continue;
    }
    const sec = line.match(/^\[([^\]]+)\]/) ?? line.match(/^\*\*(.+)\*\*$/);
    if (sec) {
      flush();
      section = line.startsWith('[') ? `[${sec[1]}]` : `${section.split(' ')[0]} ${sec[1]}`;
      const aka = line.match(/aka\s+"([^"]+)"/i);
      if (aka) notes.push(`Synonym in source: "${aka[1]}" for ${section}`);
      continue;
    }
    // Verbatim: a quoted passage marked for exact reading.
    const vb = line.match(/^(.*?)(?:verbatim\s*\(legal\)|\(read as written\))\s*:?\s*[-:]?\s*"(.+)"\s*$/i);
    if (vb) {
      flush();
      const label = vb[1]!.replace(/[-:]\s*$/, '').trim();
      const name = label || sectionName(section);
      raws.push({ title: `${titleCase(name || section)} (verbatim)`, type: 'verbatim', body: vb[2]!.trim(), verbatim: true, section: label ? `${section} ${label}`.trim() : section });
      continue;
    }
    if (/^(tip|fyi)\b/i.test(line)) { skipped.push({ text: line, reason: 'coaching tip, not knowledge' }); continue; }
    if (/retired|do not use/i.test(line)) { skipped.push({ text: line, reason: 'lifecycle note: routed to the owner as a possible retirement' }); notes.push(`Possible retirement: "${line}"`); continue; }
    const num = line.match(/^(\d+)[.)]\s+(.+)$/);
    const bul = line.match(/^[-*•]\s+(.+)$/);
    if (num || bul) {
      const numbered = !!num;
      if (!list || list.numbered !== numbered) {
        flush();
        list = { title: titleCase(sectionName(section)), items: [], numbered, section };
      }
      list.items.push((num ? num[2] : bul![1])!.trim());
      continue;
    }
    // A heading line ending in a colon starts a list section.
    if (/:$/.test(line)) { flush(); section = line.replace(/:$/, ''); continue; }
    flush();
    // "Label: text" or a plain sentence.
    const lab = line.match(/^([A-Z][A-Za-z -]{2,40}):\s+(.+)$/);
    const reviewDue = isoFromUs(line.match(/next review due ([\d/]+)/i)?.[1]);
    const body = (lab ? lab[2]! : line).replace(/\[reviewed[^\]]*\]/i, '').trim();
    if (body.split(/\s+/).length < 4) { skipped.push({ text: line, reason: 'too short to stand alone' }); continue; }
    const prev = raws[raws.length - 1];
    if (!lab && prev && prev.type === 'fact' && !prev.labeled && prev.section === section && wasPlain) {
      // Consecutive unlabeled sentences in one section form one paragraph, one unit.
      prev.body = `${prev.body} ${body}`;
      continue;
    }
    const inBracket = section.startsWith('[');
    const name = lab ? lab[1]! : inBracket ? sectionName(section) : body.split(/\s+/).slice(0, 6).join(' ');
    raws.push({ title: titleCase(name), type: 'fact', body, verbatim: false, section: lab ? `${section} ${lab[1]}`.trim() : section, review: reviewDue, labeled: !!lab });
    prevWasPlain = !lab;
    continue;
  }
  flush();
  return { header, title, raws, skipped, notes };
}

/**
 * Extract candidate units from one source document and compare each with the
 * approved units. Pure function: nothing is stored or published.
 */
export function extract(text: string, approved: KnowledgeUnit[], previous?: CandidateUnit[], fallbackDocId = 'DOC-UPLOAD', lexicon: Record<string, string> = {}): ExtractionResult {
  const { header, title, raws, skipped, notes } = segment(text);
  const docId = header['doc id'] ?? fallbackDocId;
  const owner = (header['owner'] ?? 'Unassigned').replace(/ Knowledge Team$| Team$/, '');
  const effective = isoFromUs(header['effective']) ?? isoFromUs(header['last edited']) ?? '2026-01-01';
  const live = approved.filter((u) => u.status === 'approved');

  const candidates = raws.map((r, i): CandidateUnit => {
    // Source-change check first: the same section of the same document as last
    // ingested. Unchanged text means nothing to review, whatever the unit says.
    const prev = previous?.find((p) => p.source_section === r.section && p.verbatim === r.verbatim);
    const prevUnit = prev?.match.unit_id ? live.find((u) => u.unit_id === prev.match.unit_id) : undefined;
    if (prev && normalizeForHash(prev.body) === normalizeForHash(r.body)) {
      return { ...prev, cid: `${docId}#${i + 1}`, match: { ...prev.match, status: 'unchanged', drift: null }, route_to: 'none', suggestions: [] };
    }
    if (prev && prevUnit) {
      const drift = checkChange(prev.body, r.body, prevUnit.verbatim);
      return {
        ...prev, cid: `${docId}#${i + 1}`, body: r.body, title: prev.title,
        match: { status: 'changed', unit_id: prevUnit.unit_id, unit_title: prevUnit.title, similarity: drift.similarity, drift },
        route_to: drift.route_to,
        suggestions: [],
      };
    }
    let best: { u: KnowledgeUnit; sim: number } | null = null;
    for (const u of live) {
      if (u.verbatim !== r.verbatim) continue; // a script line never matches a fact, and the reverse
      const sim = jaccard(u.body, r.body);
      if (!best || sim > best.sim) best = { u, sim };
    }
    let status: MatchStatus = 'new';
    let drift: DriftResult | null = null;
    if (best && normalizeForHash(best.u.body) === normalizeForHash(r.body)) status = 'unchanged';
    else if (best && best.sim >= MATCH_THRESHOLD) {
      status = 'changed';
      drift = checkChange(best.u.body, r.body, best.u.verbatim);
    }
    const kb = kbFor(docId, r.verbatim, r.section);
    const route = status === 'unchanged' ? 'none' : drift ? drift.route_to : r.verbatim ? 'Legal (verbatim)' : 'Author';
    const synonyms = [...new Set(contentWords(r.title).slice(0, 3))];
    return {
      cid: `${docId}#${i + 1}`,
      title: r.title,
      type: r.type,
      body: r.body,
      verbatim: r.verbatim,
      knowledge_base: kb,
      owner: r.verbatim ? 'Compliance' : owner,
      source_doc: docId,
      source_section: r.section,
      effective_date: effective,
      review_date: r.review ?? plusOneYear(effective),
      suggested_synonyms: synonyms,
      match: {
        status,
        unit_id: status === 'new' ? null : best!.u.unit_id,
        unit_title: status === 'new' ? null : best!.u.title,
        similarity: best?.sim ?? 0,
        drift,
      },
      route_to: route,
      extractor: EXTRACTOR_VERSION,
      suggestions: [],
    };
  });

  for (const c of candidates) c.suggestions = c.match.status === 'unchanged' ? [] : suggest(c, live, lexicon);
  return { doc_id: docId, title, owner, effective_date: effective, candidates, skipped, lifecycle_notes: notes, extractor: EXTRACTOR_VERSION };
}

// Merge: overlap below the "changed" threshold but clearly the same topic,
// counted on body words plus the unit's curated synonyms.
export const MERGE_MIN_OVERLAP = 0.4; // below this, topic overlap was mostly shared vocabulary (e.g. "maintenance medications by mail")

function topicWords(u: KnowledgeUnit): Set<string> {
  return new Set([...contentWords(u.body), ...contentWords(u.title), ...u.synonyms.flatMap((x) => contentWords(x))]);
}

function clauses(body: string): string[] {
  // Sentences first, then comma or semicolon lists inside a sentence.
  const out: string[] = [];
  for (const sentence of body.split(/(?<=[.!?])\s+(?=[A-Z"])/)) {
    // A comma list that ends in "or"/"and" is one statement with options, not several facts.
    const enumeration = /,\s+(or|and)\s+[^,]+$/.test(sentence.replace(/[.\s]+$/, ''));
    const sep = enumeration ? /\s*;\s+/ : /\s*[;,]\s+(?![^()]*\))/;
    const bits = sentence.split(sep).map((b) => b.replace(/[.\s]+$/, '').trim()).filter((b) => b.split(/\s+/).length >= 3);
    if (bits.length >= 2) out.push(...bits);
    else out.push(sentence.replace(/[.\s]+$/, '').trim());
  }
  return out.filter(Boolean);
}

function suggest(c: CandidateUnit, live: KnowledgeUnit[], lexicon: Record<string, string>): Suggestion[] {
  const out: Suggestion[] = [];
  if (c.verbatim) return out; // verbatim is never merged or split by suggestion: Legal decides wording as a whole
  if (c.match.status === 'new') {
    const words = new Set(contentWords(c.body + ' ' + c.title));
    let best: { u: KnowledgeUnit; overlap: number } | null = null;
    for (const u of live) {
      if (u.verbatim || u.knowledge_base !== c.knowledge_base) continue;
      const t = topicWords(u);
      const inter = [...words].filter((w) => t.has(w)).length;
      const overlap = Math.round((inter / Math.max(1, Math.min(words.size, t.size))) * 100) / 100;
      if (inter >= 2 && (!best || overlap > best.overlap)) best = { u, overlap };
    }
    if (best && best.overlap >= MERGE_MIN_OVERLAP)
      out.push({ kind: 'merge', unit_id: best.u.unit_id, unit_title: best.u.title, overlap: best.overlap, reason: `Covers the same topic as ${best.u.unit_id} (${Math.round(best.overlap * 100)}% topic overlap). Link this source to it instead of creating a second unit.` });
  }
  const tags = suggestTags(c, lexicon);
  if (tags) out.push(tags);
  if (c.type === 'procedure') return out; // numbered steps stay together
  const parts = clauses(c.body).map((text) => {
        let hit: KnowledgeUnit | null = null;
        let top = 0;
        for (const u of live) {
          if (u.verbatim) continue;
          const sim = jaccard(u.body, text);
          if (sim > top) { top = sim; hit = u; }
        }
        return top >= 0.5 && hit ? { text, unit_id: hit.unit_id, unit_title: hit.title } : { text, unit_id: null, unit_title: null };
  });
  // Suggest a split only when it clearly helps: a part already belongs to a
  // different unit, or the candidate packs four or more statements.
  const elsewhere = parts.some((p) => p.unit_id && p.unit_id !== c.match.unit_id);
  if (parts.length >= 3 && (elsewhere || parts.length >= 4)) {
    out.push({ kind: 'split', parts, reason: `Holds ${parts.length} separate statements${elsewhere ? ', and part of it is already its own unit' : ''}. One fact per unit keeps citations precise and lets each part change on its own.` });
  }
  return out;
}

const STATES: Record<string, string> = {
  alabama: 'AL', alaska: 'AK', arizona: 'AZ', arkansas: 'AR', california: 'CA', colorado: 'CO', connecticut: 'CT', delaware: 'DE', florida: 'FL', georgia: 'GA',
  hawaii: 'HI', idaho: 'ID', illinois: 'IL', indiana: 'IN', iowa: 'IA', kansas: 'KS', kentucky: 'KY', louisiana: 'LA', maine: 'ME', maryland: 'MD',
  massachusetts: 'MA', michigan: 'MI', minnesota: 'MN', mississippi: 'MS', missouri: 'MO', montana: 'MT', nebraska: 'NE', nevada: 'NV', 'new hampshire': 'NH',
  'new jersey': 'NJ', 'new mexico': 'NM', 'new york': 'NY', 'north carolina': 'NC', 'north dakota': 'ND', ohio: 'OH', oklahoma: 'OK', oregon: 'OR',
  pennsylvania: 'PA', 'rhode island': 'RI', 'south carolina': 'SC', 'south dakota': 'SD', tennessee: 'TN', texas: 'TX', utah: 'UT', vermont: 'VT',
  virginia: 'VA', washington: 'WA', 'west virginia': 'WV', wisconsin: 'WI', wyoming: 'WY',
};

/**
 * Applicability and synonyms the text supports. Silent when the source says
 * nothing: an unstated scope stays at the default and the author decides.
 */
export function suggestTags(c: CandidateUnit, lexicon: Record<string, string>): Suggestion | null {
  const text = `${c.title}. ${c.body}`;
  const evidence: string[] = [];

  const lob: string[] = [];
  if (/\bMAPD\b|Medicare Advantage/i.test(text)) { lob.push('MAPD'); evidence.push('mentions Medicare Advantage / MAPD'); }
  if (/\bPDP\b|stand-?alone Prescription Drug Plan/i.test(text)) { lob.push('PDP'); evidence.push('mentions PDP'); }

  const states: string[] = [];
  const lower = text.toLowerCase();
  for (const [name, abbr] of Object.entries(STATES)) if (new RegExp(`\\b${name}\\b`).test(lower)) states.push(abbr);
  // Two-letter codes only inside a list that follows "in", "for" or "of" and sits next to a
  // state ("in Florida and TX", "residents of TX, GA"); never bare words like "OR" or "IN".
  const names = Object.keys(STATES).join('|');
  const item = `(?:${names}|[A-Z]{2}\\b)`;
  const list = new RegExp(`\\b(?:in|for|of)\\s+(${item}(?:\\s*(?:,|,?\\s*and|,?\\s*or)\\s*${item})*)`, 'gi');
  for (const m of text.matchAll(list))
    for (const code of m[1]!.match(/\b[A-Z]{2}\b/g) ?? []) if (Object.values(STATES).includes(code) && !states.includes(code)) states.push(code);
  if (states.length) evidence.push(`names ${states.join(', ')}`);

  const years = [...new Set([...text.matchAll(/\b(?:plan year|PY|CY)\s*(20\d\d)\b|\b(20\d\d)\s+plan year\b/gi)].map((m) => Number(m[1] ?? m[2])))];
  if (years.length) evidence.push(`plan year ${years.join(', ')}`);

  // Synonyms: lexicon shorthand whose expansion appears in the unit ("mail order" -> "mo", "male order").
  const have = new Set(c.suggested_synonyms.map((x) => x.toLowerCase()));
  const syn: string[] = [];
  for (const [short, full] of Object.entries(lexicon)) {
    if (short.length < 2 || have.has(short.toLowerCase())) continue;
    if (new RegExp(`\\b${full.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'i').test(text)) { syn.push(short); have.add(short.toLowerCase()); }
  }
  if (syn.length) evidence.push(`lexicon shorthand for terms used here: ${syn.join(', ')}`);

  const planYear = years.length === 1 ? years[0]! : null;
  if (!lob.length && !states.length && planYear === null && !syn.length) return null;
  return {
    kind: 'tags',
    lob: lob.length ? lob : null,
    states: states.length ? states : null,
    plan_year: planYear,
    synonyms: syn,
    evidence,
    reason: `The text states: ${evidence.join('; ')}. Accept to scope the unit that way, or leave the default (all lines of business, all states, current plan year).`,
  };
}
