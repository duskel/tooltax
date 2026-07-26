import { readFile, readdir } from 'node:fs/promises';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse as parseYaml } from 'yaml';
import { describe, expect, it } from 'vitest';
import { RULES, getRule, lintTools, listRuleIds } from '../src/rules/index.js';
import { costIndex, scoreTools } from '../src/score/score.js';
import { extractTools } from '../src/sources/normalize.js';
import { getTokenizer } from '../src/tokenizers/index.js';
import type { RuleMeta, ToolDefinition } from '../src/types.js';

const here = dirname(fileURLToPath(import.meta.url));
const rulesDir = resolve(here, '..', 'src', 'rules');
const tokenizer = getTokenizer('o200k');

/**
 * Discover rule directories from disk. This is what makes the contract test a
 * gate: a contributor who adds `src/rules/<id>/` gets held to every invariant
 * below without touching this file.
 */
async function discoverRuleDirs(): Promise<string[]> {
  const entries = await readdir(rulesDir, { withFileTypes: true });
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function loadFixture(ruleId: string, name: string): Promise<ToolDefinition[]> {
  const path = join(rulesDir, ruleId, 'fixtures', `${name}.json`);
  return extractTools(JSON.parse(await readFile(path, 'utf8')), path);
}

function runRule(ruleId: string, tools: ToolDefinition[]) {
  const rule = getRule(ruleId);
  const score = scoreTools(tools, tokenizer);
  return rule.check({ tools, tokenizer, costs: costIndex(score), options: {} });
}

const ruleDirs = await discoverRuleDirs();

describe('rule discovery', () => {
  it('finds rule directories on disk', () => {
    expect(ruleDirs.length).toBeGreaterThan(0);
  });

  it('registers every discovered rule directory in RULES', () => {
    expect([...listRuleIds()].sort()).toEqual(ruleDirs);
  });

  it('has no registered rule without a directory', () => {
    for (const id of listRuleIds()) {
      expect(ruleDirs, `rule "${id}" is registered but has no src/rules/${id}/`).toContain(id);
    }
  });

  it('gives every rule a unique id', () => {
    const ids = listRuleIds();
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('throws a helpful error for an unknown rule id', () => {
    expect(() => getRule('nope')).toThrowError(/Unknown rule "nope"/);
  });
});

describe.each(ruleDirs.map((id) => [id] as const))('rule contract: %s', (ruleId) => {
  it('is registered and its meta.id matches the directory name', () => {
    expect(getRule(ruleId).meta.id).toBe(ruleId);
  });

  it('declares a valid severity and a non-empty rationale and fix', () => {
    const meta = getRule(ruleId).meta;
    expect(['error', 'warn', 'info']).toContain(meta.severity);
    expect(meta.title.length).toBeGreaterThan(0);
    expect(meta.rationale.length).toBeGreaterThan(20);
    expect(meta.fix.length).toBeGreaterThan(20);
    expect(meta.category.length).toBeGreaterThan(0);
  });

  it('has a meta.yaml that matches the exported meta exactly', async () => {
    const raw = await readFile(join(rulesDir, ruleId, 'meta.yaml'), 'utf8');
    const fromYaml = parseYaml(raw) as RuleMeta;
    const fromCode = getRule(ruleId).meta;

    expect(fromYaml.id).toBe(fromCode.id);
    expect(fromYaml.title).toBe(fromCode.title);
    expect(fromYaml.severity).toBe(fromCode.severity);
    expect(fromYaml.category).toBe(fromCode.category);
    expect(normalize(fromYaml.rationale)).toBe(normalize(fromCode.rationale));
    expect(normalize(fromYaml.fix)).toBe(normalize(fromCode.fix));
  });

  it('reports at least one finding on its trigger fixture', async () => {
    const findings = runRule(ruleId, await loadFixture(ruleId, 'trigger'));
    expect(findings.length).toBeGreaterThan(0);
    for (const finding of findings) {
      expect(finding.ruleId).toBe(ruleId);
      expect(finding.message.length).toBeGreaterThan(0);
      expect(finding.estimatedSavings).toBeGreaterThanOrEqual(0);
      expect(Number.isInteger(finding.estimatedSavings)).toBe(true);
    }
  });

  it('reports no findings on its clean fixture', async () => {
    const findings = runRule(ruleId, await loadFixture(ruleId, 'clean'));
    expect(findings, `expected no findings, got: ${JSON.stringify(findings)}`).toEqual([]);
  });

  it('reports no findings on an empty tool list', () => {
    expect(runRule(ruleId, [])).toEqual([]);
  });

  it('survives a malformed tool without throwing', () => {
    const nasty: ToolDefinition[] = [
      { name: 'weird', description: '', inputSchema: undefined },
      { name: 'nulls', inputSchema: { type: 'object', properties: {} } },
    ];
    expect(() => runRule(ruleId, nasty)).not.toThrow();
  });
});

describe('lintTools', () => {
  it('never estimates savings above the total payload', async () => {
    const tools = await loadFixture('repeated-boilerplate', 'trigger');
    const report = lintTools(tools, tokenizer);
    expect(report.estimatedSavings).toBeLessThanOrEqual(report.score.totalTokens);
  });

  it('sorts errors before warnings before info', async () => {
    const tools = await loadFixture('missing-description', 'trigger');
    const report = lintTools(tools, tokenizer);
    const order = { error: 0, warn: 1, info: 2 } as const;
    for (let i = 1; i < report.findings.length; i += 1) {
      const previous = report.findings[i - 1];
      const current = report.findings[i];
      if (previous && current) {
        expect(order[previous.severity]).toBeLessThanOrEqual(order[current.severity]);
      }
    }
  });

  it('honours include and exclude filters', async () => {
    const tools = await loadFixture('enum-bloat', 'trigger');
    const only = lintTools(tools, tokenizer, { include: ['enum-bloat'] });
    expect(only.findings.every((f) => f.ruleId === 'enum-bloat')).toBe(true);

    const without = lintTools(tools, tokenizer, { exclude: ['enum-bloat'] });
    expect(without.findings.some((f) => f.ruleId === 'enum-bloat')).toBe(false);
  });

  it('counts findings by severity', async () => {
    const tools = await loadFixture('missing-description', 'trigger');
    const report = lintTools(tools, tokenizer);
    const total = report.counts.error + report.counts.warn + report.counts.info;
    expect(total).toBe(report.findings.length);
  });

  it('turns a throwing rule into a finding instead of crashing', () => {
    const exploding = {
      meta: {
        id: 'boom',
        title: 'Explodes',
        severity: 'warn' as const,
        category: 'test',
        rationale: 'x',
        fix: 'y',
      },
      check(): never {
        throw new Error('kaboom');
      },
    };
    const original = [...RULES];
    (RULES as unknown as typeof exploding[]).push(exploding);
    try {
      const report = lintTools([{ name: 'a', description: 'A tool that does a thing.' }], tokenizer);
      const boom = report.findings.find((f) => f.ruleId === 'boom');
      expect(boom?.message).toContain('kaboom');
    } finally {
      (RULES as unknown as unknown[]).length = 0;
      (RULES as unknown as unknown[]).push(...original);
    }
  });

  it('respects per-rule option overrides', async () => {
    const tools = await loadFixture('enum-bloat', 'clean');
    const strict = lintTools(tools, tokenizer, {
      include: ['enum-bloat'],
      ruleOptions: { 'enum-bloat': { maxEnumValues: 0 } },
    });
    expect(strict.findings.length).toBe(0);
  });
});

function normalize(text: string): string {
  return text.replace(/\s+/g, ' ').trim();
}
