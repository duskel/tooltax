import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { promisify } from 'node:util';
import { describe, expect, it } from 'vitest';

const run = promisify(execFile);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const cli = resolve(repoRoot, 'dist', 'cli.js');
const fixture = resolve(repoRoot, 'src', 'rules', 'enum-bloat', 'fixtures', 'trigger.json');

type Result = { code: number; stdout: string; stderr: string };

async function tooltax(args: string[], stdin?: string): Promise<Result> {
  try {
    const child = run('node', [cli, ...args], { cwd: repoRoot, maxBuffer: 20 * 1024 * 1024 });
    if (stdin !== undefined) {
      child.child.stdin?.end(stdin);
    }
    const { stdout, stderr } = await child;
    return { code: 0, stdout, stderr };
  } catch (error) {
    const e = error as { code?: number; stdout?: string; stderr?: string };
    return { code: e.code ?? 1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' };
  }
}

// The CLI is only exercised when dist/ exists. `npm run build` runs before
// `npm test` in CI; locally, skip rather than fail with a confusing ENOENT.
const describeCli = existsSync(cli) ? describe : describe.skip;

describeCli('tooltax CLI', () => {
  it('prints usage with no arguments', async () => {
    const { code, stdout } = await tooltax([]);
    expect(code).toBe(0);
    expect(stdout).toContain('USAGE');
    expect(stdout).toContain('score');
    expect(stdout).toContain('leaderboard');
  });

  it('prints a version', async () => {
    const { code, stdout } = await tooltax(['--version']);
    expect(code).toBe(0);
    expect(stdout.trim()).toMatch(/^\d+\.\d+\.\d+$/);
  });

  it('exits 2 for an unknown command', async () => {
    const { code, stderr } = await tooltax(['frobnicate']);
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown command');
  });

  it('exits 2 for an unknown option', async () => {
    const { code, stderr } = await tooltax(['score', fixture, '--nope']);
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown option');
  });

  it('scores a JSON file', async () => {
    const { code, stdout } = await tooltax(['score', fixture]);
    expect(code).toBe(0);
    expect(stdout).toContain('convert_currency');
    expect(stdout).toContain('context window');
  });

  it('emits valid JSON with --json', async () => {
    const { code, stdout } = await tooltax(['score', fixture, '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.totalTokens).toBeGreaterThan(0);
    expect(parsed.tools[0].name).toBe('convert_currency');
    expect(parsed.tokenizer.exact).toBe(true);
  });

  it('reads from stdin', async () => {
    const payload = JSON.stringify({ tools: [{ name: 'a', description: 'Does a thing.' }] });
    const { code, stdout } = await tooltax(['score', '-', '--json'], payload);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).toolCount).toBe(1);
  });

  it('exits 1 when --max-tokens is exceeded', async () => {
    const { code, stderr } = await tooltax(['score', fixture, '--max-tokens', '10']);
    expect(code).toBe(1);
    expect(stderr).toContain('exceeds --max-tokens');
  });

  it('exits 0 when within --max-tokens', async () => {
    const { code } = await tooltax(['score', fixture, '--max-tokens', '1000000']);
    expect(code).toBe(0);
  });

  it('accepts --flag=value as well as --flag value', async () => {
    const { code, stdout } = await tooltax(['score', fixture, '--json', '--context-window=8000']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).contextWindow).toBe(8000);
  });

  it('rejects a non-numeric --max-tokens', async () => {
    const { code, stderr } = await tooltax(['score', fixture, '--max-tokens', 'lots']);
    expect(code).toBe(2);
    expect(stderr).toContain('positive integer');
  });

  it('lints and reports findings', async () => {
    const { code, stdout } = await tooltax(['lint', fixture, '--json']);
    expect(code).toBe(0);
    const parsed = JSON.parse(stdout);
    expect(parsed.findings.some((f: { ruleId: string }) => f.ruleId === 'enum-bloat')).toBe(true);
  });

  it('exits 1 when --max-findings is exceeded', async () => {
    const { code } = await tooltax(['lint', fixture, '--max-findings', '0']);
    expect(code).toBe(1);
  });

  it('rejects an unknown rule id', async () => {
    const { code, stderr } = await tooltax(['lint', fixture, '--rule', 'nope']);
    expect(code).toBe(2);
    expect(stderr).toContain('Unknown rule');
  });

  it('lists rules as JSON', async () => {
    const { code, stdout } = await tooltax(['rules', '--json']);
    expect(code).toBe(0);
    const rules = JSON.parse(stdout);
    expect(Array.isArray(rules)).toBe(true);
    expect(rules.length).toBeGreaterThan(0);
    expect(rules[0]).toHaveProperty('rationale');
  });

  it('validates the shipped registry', async () => {
    const { code, stdout } = await tooltax(['validate']);
    expect(code).toBe(0);
    expect(stdout).toContain('valid');
  });

  it('emits badge JSON', async () => {
    const { code, stdout } = await tooltax(['badge', fixture, '--json']);
    expect(code).toBe(0);
    expect(JSON.parse(stdout).schemaVersion).toBe(1);
  });

  it('reports a missing file clearly and exits 1', async () => {
    const { code, stderr } = await tooltax(['score', 'definitely-not-here.json']);
    expect(code).toBe(1);
    expect(stderr).toContain('No such file');
  });

  it('rejects an unknown tokenizer', async () => {
    const { code, stderr } = await tooltax(['score', fixture, '--tokenizer', 'nope']);
    expect(code).toBe(1);
    expect(stderr).toContain('Unknown tokenizer');
  });

  it('warns when an inexact tokenizer is used', async () => {
    const { code, stdout } = await tooltax(['score', fixture, '--tokenizer', 'approx']);
    expect(code).toBe(0);
    expect(stdout).toContain('approximation');
  });
});
