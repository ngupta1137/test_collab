// @ts-nocheck
// Copied from the verity engine (src/engine/ownerQueue.ts).
// Owner review queue. A stale or conflict outcome is not just a message to the
// asker: it is work for the unit's owner. Deterministic, no model. One open item
// per (kind, units); repeats raise the count and the "last asked" date instead of
// creating noise. Claims record who is on it. Nothing here edits a unit.

export type ReviewKind = 'stale' | 'conflict';
export type ReviewStatus = 'open' | 'claimed' | 'resolved';

export interface ReviewItem {
  item_id: string;
  kind: ReviewKind;
  unit_ids: string[];
  owner: string;
  status: ReviewStatus;
  opened: string;
  last_asked: string;
  asks: number;
  example_query: string; // already redacted
  claimed_by: string | null;
  note: string;
}

export class OwnerQueue {
  private items: ReviewItem[] = [];
  private seq = 0;

  /** Open (or bump) an item for a stale or conflict outcome. */
  open(kind: ReviewKind, unitIds: string[], owner: string, queryRedacted: string, today: string): ReviewItem {
    const key = [...unitIds].sort().join('+');
    const hit = this.items.find((i) => i.kind === kind && [...i.unit_ids].sort().join('+') === key && i.status !== 'resolved');
    if (hit) {
      hit.asks += 1;
      hit.last_asked = today;
      return hit;
    }
    const item: ReviewItem = {
      item_id: `RV-${String(++this.seq).padStart(3, '0')}`, kind, unit_ids: [...unitIds], owner, status: 'open',
      opened: today, last_asked: today, asks: 1, example_query: queryRedacted, claimed_by: null,
      note: kind === 'stale' ? 'Past its review date. Re-confirm or revise; the unit is not served until then.' : 'Two approved units disagree. Retire one or add a supersedes link; the model never picks.',
    };
    this.items.push(item);
    return item;
  }

  claim(itemId: string, by: string): ReviewItem | null {
    const i = this.items.find((x) => x.item_id === itemId);
    if (!i || i.status === 'resolved') return null;
    i.status = 'claimed';
    i.claimed_by = by;
    return i;
  }

  resolve(itemId: string): ReviewItem | null {
    const i = this.items.find((x) => x.item_id === itemId);
    if (!i) return null;
    i.status = 'resolved';
    return i;
  }

  private gapClaims = new Map<string, { by: string; at: string }>();

  /** Someone takes a gap cluster, so two authors do not write the same unit. */
  claimGap(clusterId: string, by: string, today: string): { by: string; at: string } {
    const hit = this.gapClaims.get(clusterId);
    if (hit) return hit;
    const c = { by, at: today };
    this.gapClaims.set(clusterId, c);
    return c;
  }
  gapClaim(clusterId: string): { by: string; at: string } | null {
    return this.gapClaims.get(clusterId) ?? null;
  }
  releaseGap(clusterId: string): void {
    this.gapClaims.delete(clusterId);
  }

  list(status?: ReviewStatus): ReviewItem[] {
    return (status ? this.items.filter((i) => i.status === status) : [...this.items]).sort((a, b) => b.asks - a.asks || a.item_id.localeCompare(b.item_id));
  }
}

/** Days between two ISO dates (a - b), never negative. */
export function ageDays(today: string, since: string): number {
  return Math.max(0, Math.round((Date.parse(today) - Date.parse(since)) / 86400000));
}
