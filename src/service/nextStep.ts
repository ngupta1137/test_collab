// What the person does next when Verity cannot give an approved answer.
// An "I don't know" on a live call needs a recovery path, not just a refusal
// (round 2 review). Deterministic text; same for REST, MCP and the app.
export function nextStep(outcome: string, role: string, owner: string | null): string | null {
  const member = role === 'member_chat';
  switch (outcome) {
    case 'insufficient_evidence':
      return member
        ? 'Offer to connect the member with an advocate or schedule a call-back. Do not answer from general knowledge. The question is logged for the knowledge team.'
        : 'Do not answer from memory. Tell the member you will confirm, then ask your supervisor or warm-transfer to the help desk. The gap is logged for an author.';
    case 'conflict':
      return member
        ? 'Do not state either version as current. Offer to connect the member with an advocate.'
        : `Do not state either version as current. Tell the member you will confirm. Both owners${owner ? ` (${owner})` : ''} are notified to resolve it.`;
    case 'stale':
      return `Do not quote it as current. Confirm with the owner${owner ? ` (${owner})` : ''} or transfer.`;
    case 'not_authorized':
      return member ? 'Connect the member with an advocate who can help.' : `Warm-transfer to ${owner ?? 'the owning team'}, or ask them to answer.`;
    case 'needs_clarification':
      return member ? null : 'Ask the member the question above, then search again.';
    default:
      return null;
  }
}
