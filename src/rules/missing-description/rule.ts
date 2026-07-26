import type { Finding, Rule, RuleContext } from '../../types.js';
import { isSchemaNode, option, walkSchema, wordCount } from '../lib.js';

/**
 * The counterpart to `verbose-description`. Brevity is only a virtue when the
 * description still says something: a tool with no description, or one that just
 * restates its own name, forces the model to guess, which costs far more in
 * retried tool calls than the description would have cost in context.
 */
export const rule: Rule = {
  meta: {
    id: 'missing-description',
    title: 'Description is missing or says nothing',
    severity: 'error',
    category: 'prose',
    rationale:
      'Cutting tokens is only a win if the tool is still selectable. An absent description, or one that merely restates the tool name, pushes the cost from context into failed and retried calls.',
    fix: 'Give every tool one short sentence covering what it does and when to choose it over its neighbours. Describe parameters only where the name is genuinely ambiguous.',
  },

  check(context: RuleContext): Finding[] {
    const minWords = option(context.options, 'minWords', 3);
    const findings: Finding[] = [];

    for (const tool of context.tools) {
      const description = typeof tool.description === 'string' ? tool.description.trim() : '';

      if (!description) {
        findings.push({
          ruleId: rule.meta.id,
          severity: rule.meta.severity,
          tool: tool.name,
          message: 'tool has no description; the model has only the name to go on.',
          estimatedSavings: 0,
        });
        continue;
      }

      if (wordCount(description) < minWords) {
        findings.push({
          ruleId: rule.meta.id,
          severity: rule.meta.severity,
          tool: tool.name,
          message:
            `description is only ${wordCount(description)} word(s) ("${description}"); ` +
            `say what it does and when to use it.`,
          estimatedSavings: 0,
        });
        continue;
      }

      if (restatesName(tool.name, description)) {
        findings.push({
          ruleId: rule.meta.id,
          severity: rule.meta.severity,
          tool: tool.name,
          message: `description ("${description}") only restates the tool name; add what it is for.`,
          estimatedSavings: 0,
        });
      }
    }

    for (const tool of context.tools) {
      const properties = tool.inputSchema?.properties;
      if (!isSchemaNode(properties)) {
        continue;
      }
      const undocumented = Object.entries(properties).filter(
        ([, node]) =>
          isSchemaNode(node) &&
          !node.description &&
          !node.enum &&
          isOpaqueType(node.type),
      );
      if (undocumented.length > 0 && walkSchema(tool).length > 1) {
        findings.push({
          ruleId: rule.meta.id,
          severity: 'info',
          tool: tool.name,
          message:
            `${undocumented.length} free-form parameter(s) have no description ` +
            `(${undocumented.map(([name]) => name).join(', ')}); a few words each prevents wrong calls.`,
          estimatedSavings: 0,
        });
      }
    }

    return findings;
  },
};

/** True when the description is just the tool name with separators removed. */
function restatesName(name: string, description: string): boolean {
  const normalize = (text: string): string => text.toLowerCase().replace(/[^a-z0-9]/g, '');
  return normalize(description) === normalize(name);
}

/**
 * Only flag types where the name alone cannot imply the expected value. A
 * boolean called `recursive` needs no description; a string called `target` does.
 */
function isOpaqueType(type: unknown): boolean {
  if (typeof type === 'string') {
    return type === 'string' || type === 'object' || type === 'array';
  }
  return false;
}

export default rule;
