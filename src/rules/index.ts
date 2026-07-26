import type {
  Finding,
  LintReport,
  Rule,
  RuleContext,
  ScoreReport,
  Severity,
  Tokenizer,
  ToolDefinition,
} from '../types.js';
import { costIndex, scoreTools } from '../score/score.js';
import { rule as deepNesting } from './deep-nesting/rule.js';
import { rule as duplicateParamShape } from './duplicate-param-shape/rule.js';
import { rule as enumBloat } from './enum-bloat/rule.js';
import { rule as mergeableTools } from './mergeable-tools/rule.js';
import { rule as missingDescription } from './missing-description/rule.js';
import { rule as oversizedExample } from './oversized-example/rule.js';
import { rule as repeatedBoilerplate } from './repeated-boilerplate/rule.js';
import { rule as verboseDescription } from './verbose-description/rule.js';

/**
 * Every rule tooltax ships.
 *
 * Registration is explicit rather than filesystem-driven so that the same code
 * path works from source, from `dist/`, and from a bundler. The contract test in
 * `test/rules.test.ts` walks `src/rules/` on disk and fails if any directory is
 * missing from this array, so a new rule cannot be silently forgotten.
 */
export const RULES: readonly Rule[] = [
  missingDescription,
  verboseDescription,
  repeatedBoilerplate,
  duplicateParamShape,
  enumBloat,
  oversizedExample,
  deepNesting,
  mergeableTools,
];

export function listRuleIds(): string[] {
  return RULES.map((r) => r.meta.id);
}

/**
 * Resolve a rule by id.
 *
 * @throws {Error} if the id is unknown, listing the valid ids.
 */
export function getRule(id: string): Rule {
  const found = RULES.find((r) => r.meta.id === id);
  if (!found) {
    throw new Error(`Unknown rule "${id}". Available: ${listRuleIds().join(', ')}.`);
  }
  return found;
}

export type LintOptions = {
  source?: string;
  contextWindow?: number;
  /** Rule ids to run. Defaults to all. */
  include?: string[];
  /** Rule ids to skip. */
  exclude?: string[];
  /** Per-rule option overrides, keyed by rule id. */
  ruleOptions?: Record<string, Record<string, unknown>>;
};

/**
 * Score a tool payload and run every enabled rule against it.
 *
 * A rule that throws is downgraded to an `error` finding naming the rule rather
 * than being allowed to abort the run, so one bad contributed rule cannot break
 * the leaderboard.
 */
export function lintTools(
  tools: ToolDefinition[],
  tokenizer: Tokenizer,
  options: LintOptions = {},
): LintReport {
  const score: ScoreReport = scoreTools(tools, tokenizer, {
    source: options.source,
    contextWindow: options.contextWindow,
  });

  const active = RULES.filter((r) => {
    if (options.include && options.include.length > 0 && !options.include.includes(r.meta.id)) {
      return false;
    }
    if (options.exclude && options.exclude.includes(r.meta.id)) {
      return false;
    }
    return true;
  });

  const costs = costIndex(score);
  const findings: Finding[] = [];

  for (const rule of active) {
    const context: RuleContext = {
      tools,
      tokenizer,
      costs,
      options: options.ruleOptions?.[rule.meta.id] ?? {},
    };
    try {
      findings.push(...rule.check(context));
    } catch (error) {
      findings.push({
        ruleId: rule.meta.id,
        severity: 'error',
        tool: null,
        message: `rule threw: ${error instanceof Error ? error.message : String(error)}`,
        estimatedSavings: 0,
      });
    }
  }

  const severityOrder: Record<Severity, number> = { error: 0, warn: 1, info: 2 };
  findings.sort(
    (a, b) =>
      severityOrder[a.severity] - severityOrder[b.severity] ||
      b.estimatedSavings - a.estimatedSavings ||
      a.ruleId.localeCompare(b.ruleId),
  );

  const counts: Record<Severity, number> = { error: 0, warn: 0, info: 0 };
  for (const finding of findings) {
    counts[finding.severity] += 1;
  }

  const rawSavings = findings.reduce((sum, f) => sum + f.estimatedSavings, 0);

  return {
    source: score.source,
    score,
    findings,
    estimatedSavings: Math.min(rawSavings, score.totalTokens),
    counts,
  };
}
