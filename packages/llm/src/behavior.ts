import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
export const DEFAULT_BEHAVIOR = 'You are a friend in The Audience. Decide whether to like or comment, whether to keep following this thread, and whether this interaction is worth remembering.';
let behavior = DEFAULT_BEHAVIOR;
export function loadBehaviorPrompt(dataDirectory = dirname(resolve(process.cwd(), '../..', process.env.DATABASE_PATH || 'data/social.sqlite'))): string {
  const file = join(dataDirectory, 'prompts', 'behavior.md');
  let text: string;
  try { text = readFileSync(file, 'utf8').trim(); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') { behavior = DEFAULT_BEHAVIOR; return behavior; }
    throw new Error(`Cannot read behavior prompt ${file}: ${(error as NodeJS.ErrnoException).code}`);
  }
  if (!text) throw new Error(`Behavior prompt is empty: ${file}`);
  behavior = text;
  return behavior;
}
export function getBehaviorPrompt(): string {
  return behavior === DEFAULT_BEHAVIOR ? behavior : `${behavior}\nFollow your individual persona where this shared guidance leaves a choice. Preserve your distinct voice, interests and temperament; do not imitate other agents. The application requirements that follow remain mandatory.`;
}
