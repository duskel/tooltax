import type { Finding, Rule, RuleContext } from '../../types.js';
import { isSchemaNode, option, savings, structuralFingerprint } from '../lib.js';

/**
 * The same `{ owner, repo, branch }` object redefined in fourteen tools is
 * fourteen copies in context. This is exactly the redundancy the MCP spec's
 * token-bloat proposal (SEP-1576) targets with `$ref` deduplication.
 */
export const rule: Rule = {
  meta: {
    id: 'duplicate-param-shape',
    title: 'The same parameter shape is redefined across tools',
    severity: 'warn',
    category: 'structure',
    rationale:
      'Servers that wrap one API tend to repeat the same identifier or pagination object in every tool. Each repetition is serialized into context separately, so the cost scales with the number of tools rather than the number of distinct shapes.',
    fix: 'Hoist the shared shape into $defs and reference it with $ref, or flatten it into a small number of primitive parameters that do not need repeating.',
  },

  check(context: RuleContext): Finding[] {
    const minRepeats = option(context.options, 'minRepeats', 3);
    const minTokens = option(context.options, 'minTokens', 15);

    const shapes = new Map<string, { tools: Set<string>; count: number; sample: string }>();

    for (const tool of context.tools) {
      const properties = tool.inputSchema?.properties;
      if (!isSchemaNode(properties)) {
        continue;
      }
      for (const [name, node] of Object.entries(properties)) {
        if (!isSchemaNode(node)) {
          continue;
        }
        const fingerprint = `${name}:${structuralFingerprint(node)}`;
        const existing = shapes.get(fingerprint);
        if (existing) {
          existing.tools.add(tool.name);
          existing.count += 1;
        } else {
          shapes.set(fingerprint, {
            tools: new Set([tool.name]),
            count: 1,
            sample: name,
          });
        }
      }
    }

    const findings: Finding[] = [];
    for (const [fingerprint, { tools, count, sample }] of shapes) {
      if (tools.size < minRepeats) {
        continue;
      }
      const shapeJson = fingerprint.slice(sample.length + 1);
      const tokens = context.tokenizer.count(shapeJson);
      if (tokens < minTokens) {
        continue;
      }
      findings.push({
        ruleId: rule.meta.id,
        severity: rule.meta.severity,
        tool: null,
        message:
          `parameter "${sample}" has an identical shape in ${tools.size} tools ` +
          `(~${tokens} tokens each); hoist it into $defs and $ref it.`,
        estimatedSavings: savings(tokens * (count - 1) * 0.7),
      });
    }

    findings.sort((a, b) => b.estimatedSavings - a.estimatedSavings);
    return findings;
  },
};

export default rule;
