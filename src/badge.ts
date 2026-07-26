import type { ScoreReport } from './types.js';

/** The shields.io endpoint response shape. */
export type ShieldsEndpoint = {
  schemaVersion: 1;
  label: string;
  message: string;
  color: string;
  labelColor?: string;
  isError?: boolean;
  cacheSeconds?: number;
};

/**
 * Colour thresholds, in tokens, for a whole server's tool payload.
 *
 * These are judgement calls, not measurements. The reasoning: under 2k is
 * negligible against a 200k window, 5k is roughly where a server starts to
 * matter when a user has several installed, and past 20k a single server is
 * eating a tenth of the window on its own.
 */
const THRESHOLDS: Array<{ max: number; color: string }> = [
  { max: 2_000, color: 'brightgreen' },
  { max: 5_000, color: 'green' },
  { max: 10_000, color: 'yellow' },
  { max: 20_000, color: 'orange' },
  { max: Number.POSITIVE_INFINITY, color: 'red' },
];

export function badgeColor(totalTokens: number): string {
  for (const { max, color } of THRESHOLDS) {
    if (totalTokens < max) {
      return color;
    }
  }
  return 'red';
}

/** Format a token count compactly for a badge: 1234 becomes `1.2k`. */
export function formatTokensShort(tokens: number): string {
  if (tokens < 1_000) {
    return String(tokens);
  }
  const thousands = tokens / 1_000;
  return thousands < 10 ? `${thousands.toFixed(1)}k` : `${Math.round(thousands)}k`;
}

/**
 * Build the JSON a shields.io dynamic endpoint badge consumes.
 *
 * Serve the result at a stable URL and point shields.io at it:
 * `https://img.shields.io/endpoint?url=<encoded url to this json>`
 */
export function buildBadge(score: ScoreReport, label = 'tool tokens'): ShieldsEndpoint {
  return {
    schemaVersion: 1,
    label,
    message: `${formatTokensShort(score.totalTokens)} (${score.toolCount} tools)`,
    color: badgeColor(score.totalTokens),
    cacheSeconds: 86_400,
  };
}

/** Badge JSON for an entry whose schema could not be fetched. */
export function buildPendingBadge(label = 'tool tokens'): ShieldsEndpoint {
  return {
    schemaVersion: 1,
    label,
    message: 'pending',
    color: 'lightgrey',
    cacheSeconds: 3_600,
  };
}

/**
 * The markdown a maintainer pastes into their own README.
 *
 * @param slug - The registry slug, `<owner>__<name>`.
 * @param baseUrl - Where the badge JSON is served from.
 */
export function badgeMarkdown(
  slug: string,
  baseUrl = 'https://raw.githubusercontent.com/duskel/tooltax/main/badges',
): string {
  const endpoint = `${baseUrl}/${slug}.json`;
  const shields = `https://img.shields.io/endpoint?url=${encodeURIComponent(endpoint)}`;
  return `[![tool tokens](${shields})](https://github.com/duskel/tooltax/blob/main/LEADERBOARD.md)`;
}
