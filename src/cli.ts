#!/usr/bin/env node
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { badgeMarkdown, buildBadge, buildPendingBadge } from './badge.js';
import {
  buildLeaderboard,
  formatNumber,
  formatPercent,
  rankRows,
  renderLeaderboardMarkdown,
} from './registry/leaderboard.js';
import { defaultRegistryDir, defaultSchemaPath, loadRegistry } from './registry/load.js';
import { formatLint, formatScore } from './report.js';
import { RULES, lintTools } from './rules/index.js';
import { DEFAULT_CONTEXT_WINDOW, scoreTools } from './score/score.js';
import { describeSource, parseSourceSpec, resolveServerSource } from './sources/resolve.js';
import { DEFAULT_TOKENIZER_ID, getTokenizer, listTokenizerIds } from './tokenizers/index.js';

const VERSION = '0.1.0';

const USAGE = `tooltax ${VERSION} -- token-budget linter and leaderboard for MCP tool schemas.

USAGE
  tooltax <command> [options]

COMMANDS
  score <source>        Count the tokens a tool schema costs, with a per-tool breakdown.
  lint <source>         Explain why a schema is expensive and how to shrink it.
  leaderboard           Score every entry in servers/ and emit the ranked table.
  validate              Check every servers/*.json against the registry schema.
  rules                 List the lint rules and what each one catches.
  badge <source>        Print shields.io badge JSON and the markdown to embed.

SOURCES
  path/to/tools.json    A JSON file: a tool array, a tools/list result, or a JSON-RPC response.
  -                     Read that JSON from stdin.
  npm:<package>         Launch \`npx -y <package>\` as a stdio MCP server and ask it.
  pypi:<package>        Launch \`uvx <package>\` as a stdio MCP server and ask it.
  cmd:<command> [args]  Launch an arbitrary command as a stdio MCP server.
  https://...           A static JSON schema, or a live MCP Streamable HTTP endpoint.

OPTIONS
  --json                Emit machine-readable JSON instead of text.
  --tokenizer <id>      One of: ${listTokenizerIds().join(', ')} (default ${DEFAULT_TOKENIZER_ID}).
  --context-window <n>  Window used for the context-share figure (default ${DEFAULT_CONTEXT_WINDOW}).
  --max-tokens <n>      Exit 1 if the total exceeds n. Use this to gate CI.
  --max-findings <n>    Exit 1 if lint reports more than n findings.
  --timeout <ms>        Per-server timeout when launching a live server (default 90000).
  --limit <n>           How many tools to show in the score table (default 20).
  --rule <id>           Run only these rules. Repeatable.
  --skip-rule <id>      Skip these rules. Repeatable.
  --registry <dir>      Registry directory (default ./servers).
  --schema <path>       Registry schema (default ./schema/server.schema.json).
  --write               leaderboard: write LEADERBOARD.md and badges/ instead of printing.
  --concurrency <n>     leaderboard: servers to score in parallel (default 4).
  --slug <slug>         badge: registry slug to name the badge file after.
  -h, --help            Show this help.
  -v, --version         Show the version.

EXAMPLES
  tooltax score npm:@modelcontextprotocol/server-everything
  cat tools.json | tooltax lint -
  tooltax score ./schema.json --json --max-tokens 5000
  tooltax leaderboard --write
`;

type Options = {
  json: boolean;
  tokenizer: string;
  contextWindow: number;
  maxTokens: number | null;
  maxFindings: number | null;
  timeout: number;
  limit: number;
  rules: string[];
  skipRules: string[];
  registry: string;
  schema: string;
  write: boolean;
  concurrency: number;
  slug: string | null;
  positional: string[];
};

async function main(argv: string[]): Promise<number> {
  if (argv.length === 0 || argv[0] === '-h' || argv[0] === '--help') {
    process.stdout.write(USAGE);
    return 0;
  }
  if (argv[0] === '-v' || argv[0] === '--version') {
    process.stdout.write(`${VERSION}\n`);
    return 0;
  }

  const command = argv[0];
  const options = parseOptions(argv.slice(1));

  switch (command) {
    case 'score':
      return commandScore(options);
    case 'lint':
      return commandLint(options);
    case 'leaderboard':
      return commandLeaderboard(options);
    case 'validate':
      return commandValidate(options);
    case 'rules':
      return commandRules(options);
    case 'badge':
      return commandBadge(options);
    default:
      process.stderr.write(`Unknown command "${command}".\n\n${USAGE}`);
      return 2;
  }
}

function parseOptions(args: string[]): Options {
  const options: Options = {
    json: false,
    tokenizer: DEFAULT_TOKENIZER_ID,
    contextWindow: DEFAULT_CONTEXT_WINDOW,
    maxTokens: null,
    maxFindings: null,
    timeout: 90_000,
    limit: 20,
    rules: [],
    skipRules: [],
    registry: defaultRegistryDir(),
    schema: defaultSchemaPath(),
    write: false,
    concurrency: 4,
    slug: null,
    positional: [],
  };

  for (let i = 0; i < args.length; i += 1) {
    const arg = args[i];
    if (arg === undefined) {
      continue;
    }

    const eq = arg.indexOf('=');
    const flag = arg.startsWith('--') && eq !== -1 ? arg.slice(0, eq) : arg;
    const inlineValue = arg.startsWith('--') && eq !== -1 ? arg.slice(eq + 1) : null;

    const nextValue = (name: string): string => {
      if (inlineValue !== null) {
        return inlineValue;
      }
      const value = args[i + 1];
      if (value === undefined || value.startsWith('--')) {
        throw new CliError(`${name} needs a value.`);
      }
      i += 1;
      return value;
    };

    switch (flag) {
      case '--json':
        options.json = true;
        break;
      case '--write':
        options.write = true;
        break;
      case '--tokenizer':
        options.tokenizer = nextValue('--tokenizer');
        break;
      case '--context-window':
        options.contextWindow = positiveInt(nextValue('--context-window'), '--context-window');
        break;
      case '--max-tokens':
        options.maxTokens = positiveInt(nextValue('--max-tokens'), '--max-tokens');
        break;
      case '--max-findings':
        options.maxFindings = nonNegativeInt(nextValue('--max-findings'), '--max-findings');
        break;
      case '--timeout':
        options.timeout = positiveInt(nextValue('--timeout'), '--timeout');
        break;
      case '--limit':
        options.limit = positiveInt(nextValue('--limit'), '--limit');
        break;
      case '--concurrency':
        options.concurrency = positiveInt(nextValue('--concurrency'), '--concurrency');
        break;
      case '--rule':
        options.rules.push(nextValue('--rule'));
        break;
      case '--skip-rule':
        options.skipRules.push(nextValue('--skip-rule'));
        break;
      case '--registry':
        options.registry = resolve(nextValue('--registry'));
        break;
      case '--schema':
        options.schema = resolve(nextValue('--schema'));
        break;
      case '--slug':
        options.slug = nextValue('--slug');
        break;
      default:
        if (arg.startsWith('--')) {
          throw new CliError(`Unknown option "${flag}". Run tooltax --help.`);
        }
        options.positional.push(arg);
    }
  }

  return options;
}

async function loadTools(options: Options): Promise<{ tools: Awaited<ReturnType<typeof resolveServerSource>>; label: string }> {
  const raw = options.positional[0];
  if (!raw) {
    throw new CliError('This command needs a <source>. Run tooltax --help for the accepted forms.');
  }
  const spec = parseSourceSpec(raw);
  const tools = await resolveServerSource(spec, { timeoutMs: options.timeout });
  return { tools, label: describeSource(spec) };
}

async function commandScore(options: Options): Promise<number> {
  const tokenizer = getTokenizer(options.tokenizer);
  const { tools, label } = await loadTools(options);
  const report = scoreTools(tools, tokenizer, {
    source: label,
    contextWindow: options.contextWindow,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatScore(report, options.limit)}\n`);
  }

  return gateOnTokens(report.totalTokens, options);
}

async function commandLint(options: Options): Promise<number> {
  const tokenizer = getTokenizer(options.tokenizer);
  const { tools, label } = await loadTools(options);

  for (const id of [...options.rules, ...options.skipRules]) {
    if (!RULES.some((r) => r.meta.id === id)) {
      throw new CliError(
        `Unknown rule "${id}". Run tooltax rules to see the ${RULES.length} available.`,
      );
    }
  }

  const report = lintTools(tools, tokenizer, {
    source: label,
    contextWindow: options.contextWindow,
    include: options.rules,
    exclude: options.skipRules,
  });

  if (options.json) {
    process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
  } else {
    process.stdout.write(`${formatLint(report)}\n`);
  }

  const tokenExit = gateOnTokens(report.score.totalTokens, options);
  if (tokenExit !== 0) {
    return tokenExit;
  }
  if (options.maxFindings !== null && report.findings.length > options.maxFindings) {
    if (!options.json) {
      process.stderr.write(
        `\nFAIL: ${report.findings.length} findings exceeds --max-findings ${options.maxFindings}.\n`,
      );
    }
    return 1;
  }
  return 0;
}

async function commandLeaderboard(options: Options): Promise<number> {
  const tokenizer = getTokenizer(options.tokenizer);
  const { entries, issues } = await loadRegistry(options.registry, options.schema);

  if (issues.length > 0) {
    process.stderr.write(
      `Skipping ${issues.length} invalid registry entr(ies). Run tooltax validate for details.\n`,
    );
  }
  if (entries.length === 0) {
    throw new CliError(`No valid registry entries found in ${options.registry}.`);
  }

  // When stdout carries the payload (JSON, or a file write), per-server progress
  // goes to stderr so a long run is not silent. When the table itself is going
  // to stdout, progress would just be noise.
  const showProgress = options.json || options.write;
  const rows = await buildLeaderboard(entries, {
    tokenizer,
    contextWindow: options.contextWindow,
    timeoutMs: options.timeout,
    concurrency: options.concurrency,
    onProgress: showProgress
      ? (row, done, total) => {
          const status =
            row.status === 'scored'
              ? `${formatNumber(row.score?.totalTokens ?? 0)} tokens`
              : 'pending';
          process.stderr.write(`[${done}/${total}] ${row.slug}: ${status}\n`);
        }
      : undefined,
  });

  const ranked = rankRows(rows);
  const scored = ranked.filter((r) => r.status === 'scored');

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ rows: ranked }, null, 2)}\n`);
    return 0;
  }

  if (options.write) {
    const markdown = renderLeaderboardMarkdown(ranked, tokenizer);
    await writeFile(resolve(process.cwd(), 'LEADERBOARD.md'), markdown, 'utf8');

    const badgeDir = resolve(process.cwd(), 'badges');
    await mkdir(badgeDir, { recursive: true });
    for (const row of ranked) {
      const badge =
        row.status === 'scored' && row.score ? buildBadge(row.score) : buildPendingBadge();
      await writeFile(
        resolve(badgeDir, `${row.slug}.json`),
        `${JSON.stringify(badge, null, 2)}\n`,
        'utf8',
      );
    }
    process.stderr.write(
      `Wrote LEADERBOARD.md and ${ranked.length} badge file(s). ` +
        `${scored.length} scored, ${ranked.length - scored.length} pending.\n`,
    );
    return 0;
  }

  process.stdout.write(`${renderLeaderboardMarkdown(ranked, tokenizer)}`);
  return 0;
}

async function commandValidate(options: Options): Promise<number> {
  const { entries, issues } = await loadRegistry(options.registry, options.schema);

  if (options.json) {
    process.stdout.write(`${JSON.stringify({ valid: entries.length, issues }, null, 2)}\n`);
    return issues.length > 0 ? 1 : 0;
  }

  if (issues.length === 0) {
    process.stdout.write(`All ${entries.length} registry entr(ies) are valid.\n`);
    return 0;
  }

  process.stderr.write(`${issues.length} problem(s) in ${options.registry}:\n\n`);
  for (const issue of issues) {
    process.stderr.write(`  ${issue.slug}.json: ${issue.message}\n`);
  }
  process.stderr.write(`\n${entries.length} entr(ies) are valid.\n`);
  return 1;
}

function commandRules(options: Options): number {
  if (options.json) {
    process.stdout.write(`${JSON.stringify(RULES.map((r) => r.meta), null, 2)}\n`);
    return 0;
  }

  process.stdout.write(`${RULES.length} rules:\n\n`);
  for (const rule of RULES) {
    process.stdout.write(`  ${rule.meta.id}  [${rule.meta.severity}] [${rule.meta.category}]\n`);
    process.stdout.write(`    ${rule.meta.title}\n`);
    process.stdout.write(`    why: ${rule.meta.rationale}\n`);
    process.stdout.write(`    fix: ${rule.meta.fix}\n\n`);
  }
  return 0;
}

async function commandBadge(options: Options): Promise<number> {
  const tokenizer = getTokenizer(options.tokenizer);
  const { tools, label } = await loadTools(options);
  const report = scoreTools(tools, tokenizer, {
    source: label,
    contextWindow: options.contextWindow,
  });
  const badge = buildBadge(report);
  const slug = options.slug ?? 'your-org__your-server';

  if (options.json) {
    process.stdout.write(`${JSON.stringify(badge, null, 2)}\n`);
    return 0;
  }

  process.stdout.write('Badge endpoint JSON (serve this at a stable URL):\n\n');
  process.stdout.write(`${JSON.stringify(badge, null, 2)}\n\n`);
  process.stdout.write('Markdown for your README:\n\n');
  process.stdout.write(`${badgeMarkdown(slug)}\n`);
  return 0;
}

function gateOnTokens(totalTokens: number, options: Options): number {
  if (options.maxTokens === null || totalTokens <= options.maxTokens) {
    return 0;
  }
  if (!options.json) {
    const over = totalTokens - options.maxTokens;
    process.stderr.write(
      `\nFAIL: ${formatNumber(totalTokens)} tokens exceeds --max-tokens ` +
        `${formatNumber(options.maxTokens)} by ${formatNumber(over)} ` +
        `(${formatPercent(over / options.maxTokens)} over budget).\n`,
    );
  }
  return 1;
}

class CliError extends Error {}

function positiveInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed <= 0) {
    throw new CliError(`${name} must be a positive integer, got "${value}".`);
  }
  return parsed;
}

function nonNegativeInt(value: string, name: string): number {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < 0) {
    throw new CliError(`${name} must be a non-negative integer, got "${value}".`);
  }
  return parsed;
}

main(process.argv.slice(2))
  .then((code) => {
    process.exitCode = code;
  })
  .catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`tooltax: ${message}\n`);
    process.exitCode = error instanceof CliError ? 2 : 1;
  });
