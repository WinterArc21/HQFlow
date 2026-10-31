/** `1 step`, `2 steps` — for regular English nouns only. */
export function countLabel(count: number, singular: string): string {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}
