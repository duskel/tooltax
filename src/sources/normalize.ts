import type { ToolDefinition } from '../types.js';

/**
 * Pull an array of tool definitions out of the several shapes people actually
 * have on disk:
 *
 * - a bare array of tools
 * - a `tools/list` result: `{ "tools": [...] }`
 * - a full JSON-RPC envelope: `{ "result": { "tools": [...] } }`
 * - a client config blob keyed by server name, where one server has tools
 *
 * @throws {Error} with an actionable message if no tool array can be found.
 */
export function extractTools(payload: unknown, sourceLabel: string): ToolDefinition[] {
  const candidate = findToolArray(payload, 0);
  if (!candidate) {
    throw new Error(
      `Could not find a tool array in ${sourceLabel}. Expected a JSON array of tools, ` +
        `an object with a "tools" key, or a JSON-RPC response with "result.tools".`,
    );
  }

  const invalid = candidate.findIndex(
    (t) => t === null || typeof t !== 'object' || typeof (t as ToolDefinition).name !== 'string',
  );
  if (invalid !== -1) {
    throw new Error(
      `Tool at index ${invalid} in ${sourceLabel} is not a valid tool definition ` +
        `(every tool needs a string "name").`,
    );
  }

  return candidate as ToolDefinition[];
}

function findToolArray(value: unknown, depth: number): unknown[] | null {
  if (depth > 4 || value === null || typeof value !== 'object') {
    return null;
  }

  if (Array.isArray(value)) {
    return looksLikeToolArray(value) ? value : null;
  }

  const obj = value as Record<string, unknown>;

  // An explicit `tools` key is authoritative even when its contents are
  // malformed, so the caller gets a precise "tool at index N is invalid" error
  // instead of a misleading "no tool array found".
  if (Array.isArray(obj['tools'])) {
    return obj['tools'];
  }

  for (const key of ['result', 'mcpServers', 'servers', 'data']) {
    const nested = obj[key];
    if (nested !== undefined) {
      const found = findToolArray(nested, depth + 1);
      if (found) {
        return found;
      }
    }
  }

  for (const nested of Object.values(obj)) {
    const found = findToolArray(nested, depth + 1);
    if (found) {
      return found;
    }
  }

  return null;
}

/**
 * An empty array is a legitimate answer (a server can expose zero tools), so it
 * counts as a tool array. A non-empty array only counts if its first entry has a
 * string `name`, which is the one field the MCP spec makes mandatory.
 */
function looksLikeToolArray(value: unknown[]): boolean {
  if (value.length === 0) {
    return true;
  }
  const first = value[0];
  return first !== null && typeof first === 'object' && typeof (first as ToolDefinition).name === 'string';
}
