export const MAX_TEXT = 280;
export type AgentProfile = { id: string; name: string; handle: string; persona: string; avatarColor: string; enabled: boolean; feedCheckIntervalMinutes?: number };
export type Decision = { like: boolean; comment: string | null; memory: string | null; memoryEvaluation?: string | null; follow?: boolean | null };
export function validText(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0 && [...value.trim()].length <= MAX_TEXT; }
export function pickAgents<T>(agents: T[], random = Math.random): T[] {
  const pool = [...agents];
  for (let i = pool.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [pool[i], pool[j]] = [pool[j], pool[i]]; }
  const minimum = Math.min(2, pool.length), maximum = Math.min(4, pool.length);
  return pool.slice(0, minimum + Math.floor(random() * (maximum - minimum + 1)));
}
export function delayMs(kind: 'post' | 'reply', random = Math.random): number {
  const [low, high] = kind === 'post' ? [5000, 60000] : [15000, 300000];
  return Math.floor(low + random() * (high - low));
}

export function validMessage(text: unknown, imageCount: number): boolean { return typeof text === 'string' && [...text.trim()].length <= MAX_TEXT && (text.trim().length > 0 || imageCount > 0) && imageCount >= 0 && imageCount <= 4; }

export function shouldMiss(provider: string, mockMiss: boolean, random = Math.random): boolean { return provider === 'mock' ? mockMiss : random() < 0.25; }
