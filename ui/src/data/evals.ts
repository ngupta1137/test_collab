export const STATS = [
  { value: "0", label: "critical failures (golden set, 27 cases)" },
  { value: "96.4%", label: "outcome accuracy (golden)" },
  { value: "39.4% → 51.5%", label: "blind set (30 cases, written by an agent that never saw the engine)" },
  { value: "0 · 0", label: "permission leaks · retired units served" },
];

export const ACCURACY = [
  { name: "Golden", value: 96.4, color: "#4E8416" },
  { name: "Blind, first run", value: 39.4, color: "#B26B00" },
  { name: "Blind, after fixes", value: 51.5, color: "#5EA908" },
  { name: "Hold-out", value: 66.7, color: "#B26B00" },
];

// Retrieval and abstention, per set. Source: verity evals results*.json metrics. Synthetic data.
export const RETRIEVAL: { set: string; cases: number; r1: string; r3: string; r5: string; mrr: string; absPrecision: string; absRecall: string }[] = [
  { set: "Golden (27)", cases: 27, r1: "94.1%", r3: "100%", r5: "100%", mrr: "1.00", absPrecision: "100%", absRecall: "100%" },
  { set: "Blind (30)", cases: 30, r1: "70.6%", r3: "82.4%", r5: "88.2%", mrr: "0.80", absPrecision: "60%", absRecall: "100%" },
  { set: "Hold-out (15)", cases: 15, r1: "40%", r3: "60%", r5: "80%", mrr: "0.54", absPrecision: "76.9%", absRecall: "100%" },
];

export const GATE = [
  "Zero critical failures",
  "Zero permission leaks",
  "Verbatim 100%",
  "Zero retired exposure",
  "Verbatim drift flag recall 100%",
];

export const FAILURES: { id: string; symptom: string; status: "Fixed" | "Open" }[] = [
  { id: "F01", symptom: "Two approved units disagreed; date recency silently picked one", status: "Fixed" },
  { id: "F02", symptom: 'Abstained on "closing statement" on a recorded call', status: "Fixed" },
  { id: "F03", symptom: '"Voice" meant both input and delivery', status: "Fixed" },
  { id: "F04", symptom: 'Leftover "DOB" label steered search', status: "Fixed" },
  { id: "F05", symptom: "Second half of a two-part question lost its subject", status: "Open" },
  { id: "F06", symptom: "Grievance question got mail-order steps", status: "Fixed" },
  { id: "F07", symptom: '"tier3" steered toward the Kentucky pilot', status: "Fixed" },
  { id: "F08", symptom: 'PHI survived with capital "Member"', status: "Fixed" },
  { id: "F09", symptom: "Two indirect safety phrasings missed", status: "Fixed" },
  { id: "F10", symptom: "Contractions diluted coverage", status: "Fixed" },
  { id: "F11", symptom: "Unit-ID request treated as a search", status: "Fixed" },
  { id: "F12", symptom: "Conversational phrasing defeats the keyword gate", status: "Open" },
  { id: "F13", symptom: "A stale unit is dropped silently and a weaker unit answers instead", status: "Open" },
  { id: "F14", symptom: "A paraphrase of a restricted unit's title says no evidence, not not authorized", status: "Open" },
];

// Same metrics sliced by domain: each role has its own scope and its own cases, so one domain's pass cannot hide another's fail.
// Source: verity evals/results.json and results_blind_set.json, by_domain. Synthetic data.
export const DOMAINS: { name: string; scope: string; golden: string; blind: string; blindCritical: number; blindAbstention: string }[] = [
  { name: "Pharmacy advocate", scope: "KB-PHARM, KB-SHARED", golden: "19 of 20", blind: "11 of 20", blindCritical: 3, blindAbstention: "70%" },
  { name: "Insurance advocate", scope: "KB-INS, KB-SHARED", golden: "3 of 3", blind: "3 of 6", blindCritical: 1, blindAbstention: "100%" },
  { name: "Member chat", scope: "KB-PHARM, KB-INS", golden: "5 of 5", blind: "3 of 7", blindCritical: 1, blindAbstention: "75%" },
];
