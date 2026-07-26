import { formatNumber, formatPercent } from './registry/leaderboard.js';
import { getRule } from './rules/index.js';
import type { LintReport, ScoreReport, Severity } from './types.js';

const BAR_WIDTH = 24;

/** Render a score report as aligned plain text. */
export function formatScore(report: ScoreReport, limit = 20): string {
  const lines: string[] = [];

  lines.push(`Source     ${report.source}`);
  lines.push(`Tokenizer  ${report.tokenizer.label}`);
  if (!report.tokenizer.exact) {
    lines.push('           WARNING: this tokenizer is an approximation, not a real BPE count.');
  }
  lines.push('');
  lines.push(
    `${formatNumber(report.totalTokens)} tokens across ${report.toolCount} tool(s) ` +
      `-- ${formatPercent(report.contextShare)} of a ${formatNumber(report.contextWindow)}-token context window.`,
  );
  lines.push(
    `Mean ${report.meanTokensPerTool} tokens/tool, ${formatNumber(report.totalBytes)} bytes on the wire.`,
  );

  if (report.tools.length === 0) {
    lines.push('');
    lines.push('This server exposes no tools.');
    return lines.join('\n');
  }

  lines.push('');

  const shown = report.tools.slice(0, limit);
  const nameWidth = Math.min(38, Math.max(...shown.map((t) => t.name.length), 4));
  const maxTokens = shown[0]?.tokens ?? 1;

  lines.push(`${'TOOL'.padEnd(nameWidth)}  ${'TOKENS'.padStart(7)}  ${'SHARE'.padStart(6)}  DESC/SCHEMA`);
  for (const tool of shown) {
    const bar = '#'.repeat(Math.max(1, Math.round((tool.tokens / maxTokens) * BAR_WIDTH)));
    lines.push(
      `${truncate(tool.name, nameWidth).padEnd(nameWidth)}  ` +
        `${formatNumber(tool.tokens).padStart(7)}  ` +
        `${formatPercent(tool.share).padStart(6)}  ` +
        `${String(tool.descriptionTokens).padStart(4)}/${String(tool.schemaTokens).padEnd(5)} ${bar}`,
    );
  }

  if (report.tools.length > shown.length) {
    const rest = report.tools.length - shown.length;
    const restTokens = report.tools.slice(limit).reduce((sum, t) => sum + t.tokens, 0);
    lines.push(`... and ${rest} more tool(s) totalling ${formatNumber(restTokens)} tokens.`);
  }

  return lines.join('\n');
}

/** Render a lint report as aligned plain text. */
export function formatLint(report: LintReport, limit = 40): string {
  const lines: string[] = [];
  lines.push(formatScore(report.score, 10));
  lines.push('');
  lines.push('-'.repeat(72));
  lines.push('');

  if (report.findings.length === 0) {
    lines.push('No findings. This schema is already lean.');
    return lines.join('\n');
  }

  lines.push(
    `${report.findings.length} finding(s): ` +
      `${report.counts.error} error, ${report.counts.warn} warn, ${report.counts.info} info. ` +
      `Estimated recoverable: ~${formatNumber(report.estimatedSavings)} tokens ` +
      `(${formatPercent(report.score.totalTokens > 0 ? report.estimatedSavings / report.score.totalTokens : 0)} of the payload).`,
  );
  lines.push('');

  const byRule = new Map<string, typeof report.findings>();
  for (const finding of report.findings) {
    const bucket = byRule.get(finding.ruleId);
    if (bucket) {
      bucket.push(finding);
    } else {
      byRule.set(finding.ruleId, [finding]);
    }
  }

  let shown = 0;
  for (const [ruleId, findings] of byRule) {
    if (shown >= limit) {
      break;
    }
    const meta = safeRuleMeta(ruleId);
    const ruleSavings = findings.reduce((sum, f) => sum + f.estimatedSavings, 0);
    lines.push(
      `[${label(findings[0]?.severity ?? 'info')}] ${ruleId} -- ${meta.title} ` +
        `(${findings.length} finding(s), ~${formatNumber(ruleSavings)} tokens)`,
    );
    for (const finding of findings.slice(0, 6)) {
      const where = finding.tool ? `${finding.tool}: ` : '';
      lines.push(`    ${where}${finding.message}`);
      shown += 1;
    }
    if (findings.length > 6) {
      lines.push(`    ... and ${findings.length - 6} more.`);
    }
    lines.push(`    fix: ${meta.fix}`);
    lines.push('');
  }

  return lines.join('\n').trimEnd();
}

function safeRuleMeta(ruleId: string): { title: string; fix: string } {
  try {
    const meta = getRule(ruleId).meta;
    return { title: meta.title, fix: meta.fix };
  } catch {
    return { title: ruleId, fix: 'See the rule documentation.' };
  }
}

function label(severity: Severity): string {
  return severity.toUpperCase().padEnd(5);
}

function truncate(text: string, width: number): string {
  return text.length <= width ? text : `${text.slice(0, width - 3)}...`;
}
