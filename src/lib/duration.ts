/** Round minutes up, then format as hours + minutes. */
export function formatDuration(minutes: number): string {
  const total = Math.max(0, Math.ceil(minutes));
  const hours = Math.floor(total / 60);
  const mins = total % 60;
  if (hours === 0) return `${mins} min`;
  if (mins === 0) return hours === 1 ? "1 hr" : `${hours} hr`;
  return `${hours} hr ${mins} min`;
}

export function roundUpMinutes(minutes: number): number {
  return Math.max(0, Math.ceil(minutes));
}
