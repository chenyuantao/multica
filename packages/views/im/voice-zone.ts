export type VoiceZone = "send" | "cancel" | "edit";

/**
 * Press-to-talk zones, matching the phone overlay: the lower-left arc
 * cancels, the lower-right arc edits, and every other point sends on release.
 * Coordinates are the finger position in the window.
 */
export function voiceZone(x: number, y: number, width: number, height: number): VoiceZone {
  if (!(width > 0) || !(height > 0)) return "send";
  if (y < height * 0.68) return "send";
  if (x < width * 0.4) return "cancel";
  if (x > width * 0.6) return "edit";
  return "send";
}
