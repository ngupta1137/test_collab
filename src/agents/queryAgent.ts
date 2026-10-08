// Query agent: runtime step 4 (FOUNDATIONS section 7), model-backed.
// It never answers. It rewrites the redacted question into standalone parts,
// fixes speech-to-text and internal jargon, and PROPOSES candidate units from a
// catalog of titles. Steps 7 to 9 then decide, deterministically, whether a
// proposed unit is eligible, applicable and authoritative.
//
// What the model sees: the redacted query, the lexicon, and the routing-index
// fields of units (id, title, synonyms for units in scope; id, title, owner
// for units out of scope). No unit bodies, ever.

import type { Gateway } from '../gateway/gateway.ts';
import type { KnowledgeUnit, Role } from '../engine/types.ts';

export interface AssistPart {
  text: string; // standalone rewrite used for keyword search
  unit_ids: string[]; // proposed, in scope
  restricted_ids: string[]; // proposed, out of scope (routing only)
}

export interface Assist {
  parts: AssistPart[];
  urgent: boolean;
  model: string;
  source: string;
}

export const QUERY_PROMPT_VERSION = 'query-agent-v1';

const SYSTEM = `You are the query-understanding step of Verity, a governed knowledge service for a health plan's contact center.
You NEVER answer the question and NEVER add facts. Your only job is to restate it and point at catalog entries.

Return ONLY a JSON object, no prose, with this shape:
{"parts":[{"text":"...","unit_ids":["..."],"restricted_ids":["..."]}],"urgent":false}

Rules:
1. Split the question into parts only if it asks two or more different things. Each "text" is a standalone question; carry the subject over (e.g. "and is shipping free" after a mail-order question becomes "is mail order shipping free").
2. Fix speech-to-text errors and expand abbreviations using the lexicon (e.g. "are ex" = Rx, "male order" = mail order, "peace see pee" = PCP).
3. unit_ids: up to 2 IN-SCOPE catalog ids whose title or synonyms cover what this part is actually asking. A shared word is not enough. If none clearly fits, use []. Never invent ids.
4. restricted_ids: OUT-OF-SCOPE catalog ids that clearly cover the part. Use only when no in-scope id fits.
5. If two in-scope entries both cover the same question (for example two answers to the same policy question), list both.
6. If the person asks to reword, soften or paraphrase approved wording, still point at the unit for that wording; Verity will return the exact approved text.
7. urgent = true only for possible medical emergencies or self-harm (overdose, not wanting to wake up, chest pain, breathing trouble, blue lips, fainting).
8. The question may contain [REDACTED] markers; ignore them.`;

function catalog(units: KnowledgeUnit[], role: Role): string {
  const lines: string[] = ['IN SCOPE (id | title | synonyms):'];
  for (const u of units.filter((x) => x.status === 'approved' && role.knowledge_bases.includes(x.knowledge_base)))
    lines.push(`${u.unit_id} | ${u.title} | ${u.synonyms.join(', ')}`);
  lines.push('', 'OUT OF SCOPE for this caller (id | title | owning team):');
  for (const u of units.filter((x) => x.status === 'approved' && !role.knowledge_bases.includes(x.knowledge_base)))
    lines.push(`${u.unit_id} | ${u.title} | ${u.owner}`);
  return lines.join('\n');
}

export function parseAssist(text: string, units: KnowledgeUnit[], role: Role): Omit<Assist, 'model' | 'source'> | null {
  const m = text.match(/\{[\s\S]*\}/);
  if (!m) return null;
  let j: any;
  try {
    j = JSON.parse(m[0]);
  } catch {
    return null;
  }
  if (!Array.isArray(j.parts) || j.parts.length === 0) return null;
  const byId = new Map(units.map((u) => [u.unit_id, u]));
  const inScope = (id: string) => byId.get(id)?.status === 'approved' && role.knowledge_bases.includes(byId.get(id)!.knowledge_base);
  const outScope = (id: string) => byId.get(id)?.status === 'approved' && !role.knowledge_bases.includes(byId.get(id)!.knowledge_base);
  const parts = j.parts.slice(0, 4).map((p: any) => ({
    text: String(p.text ?? '').slice(0, 300),
    // Hallucinated or misfiled ids are dropped here, deterministically.
    unit_ids: (Array.isArray(p.unit_ids) ? p.unit_ids : []).map(String).filter(inScope).slice(0, 2),
    restricted_ids: (Array.isArray(p.restricted_ids) ? p.restricted_ids : []).map(String).filter(outScope).slice(0, 2),
  })).filter((p: AssistPart) => p.text.length > 0);
  if (!parts.length) return null;
  return { parts, urgent: j.urgent === true };
}

export async function runQueryAgent(gw: Gateway, redactedQuery: string, units: KnowledgeUnit[], role: Role, lexicon: Record<string, string>): Promise<Assist | null> {
  if (!gw.enabled) return null;
  const user = `LEXICON: ${Object.entries(lexicon).map(([k, v]) => `${k} = ${v}`).join('; ')}\n\nCATALOG\n${catalog(units, role)}\n\nQUESTION: ${redactedQuery}`;
  const reply = await gw.complete({ task: 'query', system: SYSTEM, user, maxTokens: 400 });
  if (!reply) return null;
  const parsed = parseAssist(reply.text, units, role);
  if (!parsed) return null;
  return { ...parsed, model: reply.model, source: reply.source };
}
