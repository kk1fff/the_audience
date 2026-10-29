export type ActivityEvent = {
  id: number;
  status: string;
  outcome: string | null;
  completedAt: number | null;
  discoveredAt: number | null;
  dueAt: number;
  source?: string;
};

const reactionOutcomes = new Set(['liked', 'commented', 'liked_and_commented']);

export function organizePostActivity<T extends ActivityEvent>(items: T[]) {
  const reactions: T[] = [];
  const mentions: T[] = [];
  const other: T[] = [];
  for (const item of items) (item.status === 'done' && item.outcome && reactionOutcomes.has(item.outcome) ? reactions : item.source === 'mention' ? mentions : other).push(item);
  const time = (item: T) => item.completedAt ?? item.discoveredAt ?? item.dueAt;
  const newestFirst = (a: T, b: T) => time(b) - time(a) || b.id - a.id;
  reactions.sort(newestFirst);
  mentions.sort(newestFirst);
  other.sort(newestFirst);
  const counts = new Map<string, number>();
  for (const item of other) {
    const label = (item.outcome || item.status).replaceAll('_', ' ');
    counts.set(label, (counts.get(label) || 0) + 1);
  }
  return { reactions, mentions, other, counts };
}
