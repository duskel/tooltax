/**
 * tooltax -- token-budget linter and leaderboard for MCP tool schemas.
 *
 * Programmatic entry point. The CLI in `cli.ts` is a thin wrapper over this.
 */

export type {
  Finding,
  JsonSchemaNode,
  LeaderboardRow,
  LintReport,
  Rule,
  RuleContext,
  RuleMeta,
  ScoreReport,
  ServerEntry,
  ServerSource,
  Severity,
  Tokenizer,
  ToolCost,
  ToolDefinition,
} from './types.js';

export {
  DEFAULT_TOKENIZER_ID,
  TOKENIZERS,
  getTokenizer,
  listTokenizerIds,
} from './tokenizers/index.js';

export { DEFAULT_CONTEXT_WINDOW, costIndex, scoreTools } from './score/score.js';
export { serializeTool, serializeToolSchema } from './score/serialize.js';

export { RULES, getRule, listRuleIds, lintTools } from './rules/index.js';
export type { LintOptions } from './rules/index.js';

export { describeSource, parseSourceSpec, resolveServerSource, resolveSource } from './sources/resolve.js';
export { extractTools } from './sources/normalize.js';
export { fetchToolsOverStdio } from './sources/stdio.js';
export { fetchToolsOverHttp } from './sources/http.js';

export { loadRegistry, defaultRegistryDir, defaultSchemaPath, SLUG_PATTERN } from './registry/load.js';
export type { LoadedEntry, RegistryLoadResult, ValidationIssue } from './registry/load.js';
export {
  buildLeaderboard,
  rankRows,
  renderLeaderboardMarkdown,
  formatNumber,
  formatPercent,
} from './registry/leaderboard.js';

export { badgeColor, badgeMarkdown, buildBadge, buildPendingBadge, formatTokensShort } from './badge.js';
export type { ShieldsEndpoint } from './badge.js';

export { formatLint, formatScore } from './report.js';
