import { describe, expect, it } from 'vitest';
import { badgeColor, badgeMarkdown, buildBadge, buildPendingBadge, formatTokensShort } from '../src/badge.js';
import { scoreTools } from '../src/score/score.js';
import { getTokenizer } from '../src/tokenizers/index.js';

const tokenizer = getTokenizer('o200k');

describe('formatTokensShort', () => {
  it('leaves counts under a thousand alone', () => {
    expect(formatTokensShort(0)).toBe('0');
    expect(formatTokensShort(999)).toBe('999');
  });

  it('uses one decimal below ten thousand', () => {
    expect(formatTokensShort(1_200)).toBe('1.2k');
    expect(formatTokensShort(9_940)).toBe('9.9k');
  });

  it('rounds to whole thousands above ten thousand', () => {
    expect(formatTokensShort(12_400)).toBe('12k');
    expect(formatTokensShort(134_000)).toBe('134k');
  });
});

describe('badgeColor', () => {
  it('gets worse as the payload grows', () => {
    expect(badgeColor(500)).toBe('brightgreen');
    expect(badgeColor(3_000)).toBe('green');
    expect(badgeColor(8_000)).toBe('yellow');
    expect(badgeColor(15_000)).toBe('orange');
    expect(badgeColor(60_000)).toBe('red');
  });
});

describe('buildBadge', () => {
  it('produces a valid shields.io endpoint object', () => {
    const score = scoreTools([{ name: 'a', description: 'Does a thing.' }], tokenizer);
    const badge = buildBadge(score);
    expect(badge.schemaVersion).toBe(1);
    expect(badge.label).toBe('tool tokens');
    expect(badge.message).toContain('1 tools');
    expect(typeof badge.color).toBe('string');
  });

  it('marks a pending entry without inventing a number', () => {
    const badge = buildPendingBadge();
    expect(badge.message).toBe('pending');
    expect(badge.message).not.toMatch(/\d/);
  });
});

describe('badgeMarkdown', () => {
  it('url-encodes the endpoint so shields.io receives it intact', () => {
    const markdown = badgeMarkdown('acme__thing');
    expect(markdown).toContain('img.shields.io/endpoint?url=');
    expect(markdown).toContain(encodeURIComponent('acme__thing.json'));
    expect(markdown).not.toContain('?url=https://');
  });
});
