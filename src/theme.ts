import type { Actor } from "./model";

// Calm, distinct hues calibrated for the light cream canvas.
// Deliberately avoids pure red/green so color never reads as accidental
// success/error — color encodes OWNER, not status (see docs/flow-mode.md).
const PALETTE = [
  "#5B8DB8", // blue
  "#8B7EC8", // violet
  "#D9A05B", // amber
  "#5BA8A0", // teal
  "#C77B9A", // mauve
  "#7FA659", // olive
  "#C98A5E", // clay
  "#6C8A9C", // slate
];

// Neutral color for nodes without an owner (e.g. terminals).
export const NEUTRAL = "#b9b2a4";

export type ActorColors = Record<string, string>;

export function buildActorColors(actors: Actor[]): ActorColors {
  const colors: ActorColors = {};
  actors.forEach((a, i) => {
    colors[a.id] = a.color ?? PALETTE[i % PALETTE.length];
  });
  return colors;
}
