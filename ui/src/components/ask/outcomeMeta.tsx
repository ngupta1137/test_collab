import {
  AlertOctagon, Ban, CheckCircle2, Clock, GitCompare, HelpCircle, SearchX, type LucideIcon,
} from "lucide-react";
import type { Outcome } from "@/services/verity";

export const OUTCOME_META: Record<Outcome, { label: string; icon: LucideIcon; text: string; border: string; bg: string }> = {
  answer: { label: "Answer", icon: CheckCircle2, text: "text-outcome-answer", border: "border-outcome-answer", bg: "bg-outcome-answer/10" },
  needs_clarification: { label: "Needs clarification", icon: HelpCircle, text: "text-outcome-clarify", border: "border-outcome-clarify", bg: "bg-outcome-clarify/10" },
  insufficient_evidence: { label: "Insufficient evidence", icon: SearchX, text: "text-outcome-insufficient", border: "border-outcome-insufficient", bg: "bg-outcome-insufficient/10" },
  conflict: { label: "Conflict", icon: GitCompare, text: "text-outcome-conflict", border: "border-outcome-conflict", bg: "bg-outcome-conflict/10" },
  stale: { label: "Stale", icon: Clock, text: "text-outcome-stale", border: "border-outcome-stale", bg: "bg-outcome-stale/10" },
  not_authorized: { label: "Not authorized", icon: Ban, text: "text-outcome-unauthorized", border: "border-outcome-unauthorized", bg: "bg-outcome-unauthorized/10" },
  safety_escalation: { label: "Safety escalation", icon: AlertOctagon, text: "text-outcome-safety", border: "border-outcome-safety", bg: "bg-outcome-safety/10" },
};

export function OutcomePill({ outcome, size = "md" }: { outcome: Outcome; size?: "sm" | "md" }) {
  const m = OUTCOME_META[outcome];
  const Icon = m.icon;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full border font-semibold ${m.text} ${m.border} ${m.bg} ${size === "sm" ? "px-2 py-0.5 text-xs" : "px-3 py-1 text-sm"}`}>
      <Icon className={size === "sm" ? "h-3 w-3" : "h-4 w-4"} aria-hidden="true" />
      {m.label}
    </span>
  );
}
