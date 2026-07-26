import type { ScoreReport, ToolCost, ToolDefinition, Tokenizer } from '../types.js';
import { serializeTool, serializeToolSchema } from './serialize.js';

/**
 * Default assumed context window. 200,000 is the Claude / GPT-4.1-class figure
 * and is the number most teams are actually budgeting against.
 */
export const DEFAULT_CONTEXT_WINDOW = 200_000;

export type ScoreOptions = {
  source?: string;
  contextWindow?: number;
};

/**
 * Score a set of MCP tool definitions.
 *
 * @param tools - Tool definitions, typically from an MCP `tools/list` response.
 * @param tokenizer - The tokenizer to bill with.
 * @param options - Source label and assumed context window.
 * @returns A report with total cost and a per-tool breakdown, most expensive first.
 */
export function scoreTools(
  tools: ToolDefinition[],
  tokenizer: Tokenizer,
  options: ScoreOptions = {},
): ScoreReport {
  const contextWindow = options.contextWindow ?? DEFAULT_CONTEXT_WINDOW;
  if (!Number.isFinite(contextWindow) || contextWindow <= 0) {
    throw new Error(`contextWindow must be a positive number, got ${contextWindow}.`);
  }

  const costs: ToolCost[] = tools.map((tool) => {
    const serialized = serializeTool(tool);
    const tokens = tokenizer.count(serialized);
    const descriptionTokens = tool.description
      ? tokenizer.count(tool.description)
      : 0;
    const schemaSerialized = serializeToolSchema(tool);
    const schemaTokens = schemaSerialized ? tokenizer.count(schemaSerialized) : 0;
    return {
      name: tool.name,
      tokens,
      descriptionTokens,
      schemaTokens,
      share: 0,
      bytes: Buffer.byteLength(serialized, 'utf8'),
    };
  });

  const totalTokens = costs.reduce((sum, c) => sum + c.tokens, 0);
  const totalBytes = costs.reduce((sum, c) => sum + c.bytes, 0);

  for (const cost of costs) {
    cost.share = totalTokens > 0 ? cost.tokens / totalTokens : 0;
  }

  costs.sort((a, b) => b.tokens - a.tokens || a.name.localeCompare(b.name));

  return {
    source: options.source ?? 'unknown',
    tokenizer: {
      id: tokenizer.id,
      label: tokenizer.label,
      encoding: tokenizer.encoding,
      exact: tokenizer.exact,
    },
    toolCount: tools.length,
    totalTokens,
    totalBytes,
    meanTokensPerTool:
      tools.length > 0 ? Math.round((totalTokens / tools.length) * 10) / 10 : 0,
    contextWindow,
    contextShare: totalTokens / contextWindow,
    tools: costs,
  };
}

/** Build a lookup of tool name to cost, for rules that need per-tool numbers. */
export function costIndex(report: ScoreReport): Map<string, ToolCost> {
  return new Map(report.tools.map((t) => [t.name, t]));
}
