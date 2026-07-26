import { readdir } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { SLUG_PATTERN, loadRegistry } from '../src/registry/load.js';
import {
  formatNumber,
  formatPercent,
  rankRows,
  renderLeaderboardMarkdown,
} from '../src/registry/leaderboard.js';
import { scoreTools } from '../src/score/score.js';
import { getTokenizer } from '../src/tokenizers/index.js';
import type { LeaderboardRow } from '../src/types.js';

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const registryDir = resolve(repoRoot, 'servers');
const schemaPath = resolve(repoRoot, 'schema', 'server.schema.json');
const tokenizer = getTokenizer('o200k');

const { entries, issues } = await loadRegistry(registryDir, schemaPath);

describe('the shipped registry', () => {
  it('has no schema violations', () => {
    expect(
      issues,
      `invalid entries:\n${issues.map((i) => `  ${i.slug}: ${i.message}`).join('\n')}`,
    ).toEqual([]);
  });

  it('is not empty', () => {
    expect(entries.length).toBeGreaterThan(0);
  });

  it('has one file per entry with no strays', async () => {
    const files = (await readdir(registryDir)).filter((f) => f.endsWith('.json'));
    expect(files.length).toBe(entries.length + issues.length);
  });

  it('uses the <owner>__<name> slug convention throughout', () => {
    for (const { slug } of entries) {
      expect(slug, `"${slug}" does not match the slug convention`).toMatch(SLUG_PATTERN);
    }
  });

  it('has unique slugs', () => {
    const slugs = entries.map((e) => e.slug);
    expect(new Set(slugs).size).toBe(slugs.length);
  });

  it('points every entry at an https repository', () => {
    for (const { slug, entry } of entries) {
      expect(entry.repo, `${slug} has a non-https repo`).toMatch(/^https:\/\//);
    }
  });

  it('never embeds anything that looks like a credential', () => {
    const suspicious = /(secret|password|api[_-]?key|token|bearer)/i;
    for (const { slug, entry } of entries) {
      const env = 'env' in entry.source ? (entry.source.env ?? {}) : {};
      for (const [key, value] of Object.entries(env)) {
        expect(suspicious.test(key), `${slug} env key "${key}" looks like a credential`).toBe(false);
        expect(value.length, `${slug} env value for "${key}" is suspiciously long`).toBeLessThan(60);
      }
    }
  });

  it('gives every entry a name and a category', () => {
    for (const { slug, entry } of entries) {
      expect(entry.name.trim().length, `${slug} has an empty name`).toBeGreaterThan(0);
      expect(entry.category, `${slug} has no category`).toBeTruthy();
    }
  });
});

describe('loadRegistry error reporting', () => {
  it('explains a missing registry directory instead of throwing ENOENT', async () => {
    await expect(loadRegistry(resolve(repoRoot, 'no-such-dir'), schemaPath)).rejects.toThrow(
      /No registry directory/,
    );
  });

  it('explains a missing schema file', async () => {
    await expect(loadRegistry(registryDir, resolve(repoRoot, 'nope.json'))).rejects.toThrow(
      /Could not read the registry schema/,
    );
  });
});

describe('leaderboard rendering', () => {
  const scored = (slug: string, tokens: number): LeaderboardRow => ({
    slug,
    entry: { name: slug, repo: 'https://example.com/x', source: { type: 'npm', package: 'p' } },
    status: 'scored',
    score: scoreTools(
      [{ name: 't', description: 'x'.repeat(tokens) }],
      tokenizer,
    ),
  });

  const pending: LeaderboardRow = {
    slug: 'acme__broken',
    entry: {
      name: 'Broken',
      repo: 'https://example.com/b',
      source: { type: 'npm', package: 'b' },
    },
    status: 'pending',
    reason: 'Timed out after 1000ms',
  };

  it('ranks cheaper servers first and pushes pending rows last', () => {
    const ranked = rankRows([scored('b__b', 400), pending, scored('a__a', 40)]);
    expect(ranked[0]?.slug).toBe('a__a');
    expect(ranked[1]?.slug).toBe('b__b');
    expect(ranked[2]?.status).toBe('pending');
  });

  it('renders both sections with the pending reason', () => {
    const markdown = renderLeaderboardMarkdown([scored('a__a', 40), pending], tokenizer);
    expect(markdown).toContain('## Scored');
    expect(markdown).toContain('## Pending');
    expect(markdown).toContain('Timed out after 1000ms');
    expect(markdown).toContain(tokenizer.id);
  });

  it('never prints a token number for a pending row', () => {
    const markdown = renderLeaderboardMarkdown([pending], tokenizer);
    const pendingSection = markdown.slice(markdown.indexOf('## Pending'));
    expect(pendingSection).not.toMatch(/\|\s*[\d,]+\s*\|/);
  });

  it('escapes pipes so a server name cannot break the table', () => {
    const nasty: LeaderboardRow = {
      ...pending,
      entry: { ...pending.entry, name: 'a | b' },
    };
    expect(renderLeaderboardMarkdown([nasty], tokenizer)).toContain('a \\| b');
  });

  it('renders an empty registry without crashing', () => {
    expect(() => renderLeaderboardMarkdown([], tokenizer)).not.toThrow();
  });
});

describe('number formatting', () => {
  it('groups thousands', () => {
    expect(formatNumber(134_000)).toBe('134,000');
  });

  it('avoids printing 0.0% for a small but non-zero share', () => {
    expect(formatPercent(0.0002)).toBe('<0.1%');
    expect(formatPercent(0)).toBe('0.0%');
    expect(formatPercent(0.256)).toBe('25.6%');
  });
});
