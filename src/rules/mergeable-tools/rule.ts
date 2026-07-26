import type { Finding, Rule, RuleContext, ToolDefinition } from '../../types.js';
import { option, savings, structuralFingerprint } from '../lib.js';

/**
 * `get_user`, `get_user_by_email` and `get_user_by_id` are one tool with a
 * discriminator. Each extra tool pays the full name plus description plus schema
 * tax, and more tools also measurably degrades selection accuracy.
 */
export const rule: Rule = {
  meta: {
    id: 'mergeable-tools',
    title: 'Near-identical tools that could be one',
    severity: 'info',
    category: 'surface',
    rationale:
      'Tools that share a name prefix and an identical input shape are usually variants of a single operation. Every variant is billed separately in context, and a larger tool surface makes the model pick wrong more often.',
    fix: 'Merge the variants into one tool with a mode or filter parameter, and let the tool branch internally.',
  },

  check(context: RuleContext): Finding[] {
    const minGroupSize = option(context.options, 'minGroupSize', 2);
    const groups = new Map<string, ToolDefinition[]>();

    for (const tool of context.tools) {
      const prefix = namePrefix(tool.name);
      if (!prefix) {
        continue;
      }
      const shape = tool.inputSchema ? structuralFingerprint(tool.inputSchema) : 'none';
      const key = `${prefix}::${shape}`;
      const bucket = groups.get(key);
      if (bucket) {
        bucket.push(tool);
      } else {
        groups.set(key, [tool]);
      }
    }

    const findings: Finding[] = [];
    for (const [key, tools] of groups) {
      if (tools.length < minGroupSize + 1) {
        continue;
      }
      const prefix = key.slice(0, key.indexOf('::'));
      const redundant = tools.slice(1);
      const redundantTokens = redundant.reduce(
        (sum, tool) => sum + (context.costs.get(tool.name)?.tokens ?? 0),
        0,
      );
      findings.push({
        ruleId: rule.meta.id,
        severity: rule.meta.severity,
        tool: null,
        message:
          `${tools.length} tools share the prefix "${prefix}" and an identical input shape ` +
          `(${tools.map((t) => t.name).join(', ')}); consider one tool with a mode parameter.`,
        estimatedSavings: savings(redundantTokens * 0.6),
      });
    }

    findings.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
    return findings;
  },
};

/** The leading segment of a snake_case, kebab-case or camelCase tool name. */
function namePrefix(name: string): string | null {
  const parts = name.split(/[_\-.]|(?=[A-Z])/).filter(Boolean);
  return parts.length >= 2 && parts[0] ? parts[0].toLowerCase() : null;
}

export default rule;
