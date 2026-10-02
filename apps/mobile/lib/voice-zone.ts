export type VoiceZone = "send" | "cancel" | "edit";

/**
 * Press-to-talk zones, matching the hold overlay: the lower-left arc cancels,
 * the lower-right arc edits, and every other point sends on release.
 * Coordinates are in the same space as the window (absolute finger position).
 */
export function voiceZone(
  x: number,
  y: number,
  width: number,
  height: number,
): VoiceZone {
  if (!(width > 0) || !(height > 0)) return "send";
  const inArcBand = y >= height * 0.68;
  if (!inArcBand) return "send";
  if (x < width * 0.4) return "cancel";
  if (x > width * 0.6) return "edit";
  return "send";
}
