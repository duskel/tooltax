/**
 * Build the pull-request comment for registry entries changed in a PR.
 *
 * Usage: node scripts/pr-comment.mjs <slug> [<slug> ...] > body.md
 *
 * Scores only the named entries, so a registry PR gets its number and its badge
 * markdown in the PR itself rather than waiting for the nightly leaderboard run.
 * Writes nothing and exits 0 when no slugs are given.
 */
import { readdir } from 'node:fs/promises';
import { resolve } from 'node:path';
import { badgeMarkdown } from '../dist/badge.js';
import { buildLeaderboard } from '../dist/registry/leaderboard.js';
import { loadRegistry } from '../dist/registry/load.js';
import { getTokenizer } from '../dist/tokenizers/index.js';

const slugs = process.argv.slice(2).filter(Boolean);
if (slugs.length === 0) {
  process.exit(0);
}

const { entries } = await loadRegistry(
  resolve(process.cwd(), 'servers'),
  resolve(process.cwd(), 'schema', 'server.schema.json'),
);

const targeted = entries.filter((e) => slugs.includes(e.slug));
if (targeted.length === 0) {
  process.stderr.write(`None of [${slugs.join(', ')}] matched a valid registry entry.\n`);
  process.exit(0);
}

const tokenizer = getTokenizer();
const rows = await buildLeaderboard(targeted, {
  tokenizer,
  timeoutMs: 120_000,
  concurrency: 2,
});

const lines = [];
lines.push('## tooltax score');
lines.push('');
lines.push('| Server | Tools | Tokens | Context @200k |');
lines.push('|---|---:|---:|---:|');

for (const row of rows) {
  if (row.status === 'scored') {
    lines.push(
      `| \`${row.slug}\` | ${row.score.toolCount} | ${row.score.totalTokens.toLocaleString('en-US')} | ` +
        `${(row.score.contextShare * 100).toFixed(1)}% |`,
    );
  } else {
    const reason = String(row.reason ?? 'unknown').replace(/\s+/g, ' ').slice(0, 140);
    lines.push(`| \`${row.slug}\` | - | pending | ${reason.replace(/\|/g, '\\|')} |`);
  }
}

lines.push('');
lines.push('Lower is better. These tokens are spent on every request before the conversation starts.');
lines.push('');

const scored = rows.filter((r) => r.status === 'scored');
if (scored.length > 0) {
  lines.push('### Your badge');
  lines.push('');
  lines.push('Paste this into your own README:');
  lines.push('');
  for (const row of scored) {
    lines.push('```markdown');
    lines.push(badgeMarkdown(row.slug));
    lines.push('```');
    lines.push('');
  }
}

const pending = rows.filter((r) => r.status !== 'scored');
if (pending.length > 0) {
  lines.push(
    'Entries listed as pending are still merged. They appear in the pending section of ' +
      'LEADERBOARD.md with the reason attached -- tooltax never publishes a number it did not measure.',
  );
  lines.push('');
}

process.stdout.write(`${lines.join('\n')}\n`);
