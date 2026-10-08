// Step 2 (PHI/PII redaction) and step 3 (safety pre-check). Deterministic
// pattern versions for the prototype; production adds a model classifier
// behind the same interface for step 3 (D + P).

// Each pattern removes the identifier's LABEL together with its value
// ("DOB 03/04/1950", "member John Smith"). Run 01 redacted only the value and
// the leftover label "DOB" steered search to the identity-verification unit
// (FAILURES.md F04).
const REDACTIONS: { label: string; re: RegExp }[] = [
  { label: 'SSN', re: /\b(ssn|social security( number)?)?[:#\s]*\d{3}-\d{2}-\d{4}\b/gi },
  { label: 'PHONE', re: /\b(phone|tel|cell)?[:#\s]*\(?\d{3}\)?[-.\s]\d{3}[-.\s]\d{4}\b/gi },
  { label: 'DOB', re: /\b(dob|d\.o\.b\.?|date of birth|born( on)?)?[:\s]*\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/gi },
  { label: 'MEMBER_ID', re: /\b(member id|id)?[:#\s]*[A-Z]?\d{8,11}\b/gi },
  { label: 'EMAIL', re: /\b[\w.+-]+@[\w-]+\.[\w.]+\b/g },
  // "member John Smith", "patient Jane Doe", "name is John Smith"
  // Prefix matched in any case ("Member Dorothy Hale" was missed in blind run 01, F08); the name itself must be capitalized.
  { label: 'NAME', re: /\b([Mm]ember|[Pp]atient|[Cc]aller|[Nn]ame is|[Ff]or)\s+[A-Z][a-z]+\s+[A-Z][a-z]+\b/g },
];

export function redact(query: string): { text: string; applied: string[] } {
  let text = query;
  const applied: string[] = [];
  for (const r of REDACTIONS) {
    if (r.re.test(text)) {
      applied.push(r.label);
      text = text.replace(r.re, ` [${r.label}]`).replace(/\s+/g, ' ').trim();
    }
    r.re.lastIndex = 0;
  }
  return { text, applied };
}

// Red-flag CATEGORIES, not phrasings: overdose or self-harm intent, passive
// suicidal ideation, cyanosis, respiratory distress, loss of consciousness,
// chest pain, stroke signs, severe bleeding. Blind run 01 missed two indirect
// phrasings (F09). Still a list: production adds a classifier behind this
// function (step 3 is D + P), and the list only ever adds escalations.
const SAFETY = [
  /chest pain|chest (is )?(tight|pressure)|heart attack/i,
  /can'?t breathe|cannot breathe|trouble breathing|short(ness)? of breath|breathing (funny|strange|weird|hard|badly)|gasping|can'?t catch (my|his|her|their) breath/i,
  /lips? (are |is |look |looks |turning )?(kind of )?(blue|purple|gray|grey)|turning blue/i,
  /suicid|kill (myself|me)|end (my|her|his) life|self[- ]harm|want to die|better off dead|(don'?t|doesn'?t|do not|does not) want to (wake up|live|be here)/i,
  /overdos|took (the |a )?(whole|entire) (bottle|pack|box)|took (all|too many) (of )?(my |her |his |the )?(pills|meds|medication)/i,
  /stroke|unconscious|unresponsive|passed out|fainted|seizure|face (is )?drooping|slurred speech/i,
  /severe bleeding|bleeding heavily|won'?t stop bleeding/i,
];

export function safetyCheck(query: string): string | null {
  for (const re of SAFETY) {
    const m = query.match(re);
    if (m) return m[0];
  }
  return null;
}

export const SAFETY_MESSAGE =
  'This sounds urgent. If this is a medical emergency, call 911 now. ' +
  'I am connecting you with a person who can help right away.';
