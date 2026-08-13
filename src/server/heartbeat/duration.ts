const MIN_DURATION_MS = 60_000;
const MAX_DURATION_MS = 7 * 24 * 60 * 60 * 1_000;
const MULTIPLIERS = {
  d: 24 * 60 * 60 * 1_000,
  h: 60 * 60 * 1_000,
  m: 60 * 1_000,
} as const;

export function parseDuration(value: string): number {
  const match = /^(\d+)([mhd])$/.exec(value);
  if (!match) {
    throw new Error(
      "Heartbeat duration must be an integer followed by m, h, or d",
    );
  }

  const amount = Number(match[1]);
  const unit = match[2] as keyof typeof MULTIPLIERS;
  const duration = amount * MULTIPLIERS[unit];
  if (
    !Number.isSafeInteger(duration) ||
    duration < MIN_DURATION_MS ||
    duration > MAX_DURATION_MS
  ) {
    throw new Error("Heartbeat duration must be between 1 minute and 7 days");
  }
  return duration;
}
