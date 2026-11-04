// Opt-in lifecycle limits for isolated tuning workers; ordinary workers are unaffected.
export function tuningBudget(env: NodeJS.ProcessEnv = process.env) {
  const raw = env.TUNING_DEADLINE;
  if (!raw) return null;
  const deadline = Date.parse(raw);
  if (!Number.isFinite(deadline)) throw new Error('Invalid TUNING_DEADLINE');
  const limit = Number(env.TUNING_FAILURE_LIMIT || 3);
  if (!Number.isInteger(limit) || limit < 1) throw new Error('Invalid TUNING_FAILURE_LIMIT');
  let failures = 0;
  return {deadline, failed: () => ++failures >= limit, succeeded: () => { failures = 0; }};
}
