import type { ToolDefinition } from '../types.js';
import { extractTools } from './normalize.js';

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'tooltax', version: '0.1.0' };

export type HttpOptions = {
  url: string;
  headers?: Record<string, string>;
  timeoutMs?: number;
};

/**
 * Fetch tool definitions from an HTTP endpoint.
 *
 * Two cases are handled, in order:
 *
 * 1. A plain GET that returns JSON already containing a tool array (a schema
 *    someone published as a static file).
 * 2. The MCP Streamable HTTP transport: POST `initialize`, then `tools/list`,
 *    carrying any `Mcp-Session-Id` the server assigns. Responses may come back
 *    as JSON or as an SSE stream; both are parsed.
 *
 * @throws {Error} if neither path yields a tool list, quoting both failures.
 */
export async function fetchToolsOverHttp(options: HttpOptions): Promise<ToolDefinition[]> {
  const timeoutMs = options.timeoutMs ?? 60_000;

  let staticError: string;
  try {
    return await fetchStaticJson(options.url, options.headers, timeoutMs);
  } catch (error) {
    staticError = error instanceof Error ? error.message : String(error);
  }

  try {
    return await fetchOverMcpHttp(options.url, options.headers, timeoutMs);
  } catch (error) {
    const rpcError = error instanceof Error ? error.message : String(error);
    throw new Error(
      `Could not read tools from ${options.url}.\n` +
        `  as a static JSON schema: ${staticError}\n` +
        `  as an MCP HTTP endpoint: ${rpcError}`,
    );
  }
}

async function fetchStaticJson(
  url: string,
  headers: Record<string, string> | undefined,
  timeoutMs: number,
): Promise<ToolDefinition[]> {
  const response = await withTimeout(
    (signal) => fetch(url, { headers: { accept: 'application/json', ...headers }, signal }),
    timeoutMs,
    url,
  );
  if (!response.ok) {
    throw new Error(`HTTP ${response.status} ${response.statusText}`);
  }
  const text = await response.text();
  let payload: unknown;
  try {
    payload = JSON.parse(text);
  } catch {
    throw new Error('response body was not valid JSON');
  }
  return extractTools(payload, url);
}

async function fetchOverMcpHttp(
  url: string,
  headers: Record<string, string> | undefined,
  timeoutMs: number,
): Promise<ToolDefinition[]> {
  const baseHeaders: Record<string, string> = {
    'content-type': 'application/json',
    accept: 'application/json, text/event-stream',
    ...headers,
  };

  const initResponse = await withTimeout(
    (signal) =>
      fetch(url, {
        method: 'POST',
        headers: baseHeaders,
        signal,
        body: JSON.stringify({
          jsonrpc: '2.0',
          id: 1,
          method: 'initialize',
          params: {
            protocolVersion: PROTOCOL_VERSION,
            capabilities: {},
            clientInfo: CLIENT_INFO,
          },
        }),
      }),
    timeoutMs,
    url,
  );

  if (!initResponse.ok) {
    throw new Error(`initialize returned HTTP ${initResponse.status} ${initResponse.statusText}`);
  }

  const sessionId = initResponse.headers.get('mcp-session-id');
  const sessionHeaders = sessionId
    ? { ...baseHeaders, 'mcp-session-id': sessionId }
    : baseHeaders;

  const initPayload = parseRpcBody(await initResponse.text());
  if (initPayload?.error) {
    throw new Error(`initialize failed: ${initPayload.error.message ?? 'unknown error'}`);
  }

  await withTimeout(
    (signal) =>
      fetch(url, {
        method: 'POST',
        headers: sessionHeaders,
        signal,
        body: JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized' }),
      }),
    timeoutMs,
    url,
  ).catch(() => undefined);

  const listResponse = await withTimeout(
    (signal) =>
      fetch(url, {
        method: 'POST',
        headers: sessionHeaders,
        signal,
        body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }),
      }),
    timeoutMs,
    url,
  );

  if (!listResponse.ok) {
    throw new Error(`tools/list returned HTTP ${listResponse.status} ${listResponse.statusText}`);
  }

  const listPayload = parseRpcBody(await listResponse.text());
  if (!listPayload) {
    throw new Error('tools/list returned no parseable JSON-RPC message');
  }
  if (listPayload.error) {
    throw new Error(`tools/list failed: ${listPayload.error.message ?? 'unknown error'}`);
  }

  return extractTools(listPayload, url);
}

type RpcBody = { result?: { tools?: ToolDefinition[] }; error?: { message?: string } };

/**
 * Parse a response body that is either a bare JSON-RPC object or an SSE stream
 * of `data:` lines. Returns the last message carrying a `result` or `error`.
 */
function parseRpcBody(text: string): RpcBody | null {
  const trimmed = text.trim();
  if (!trimmed) {
    return null;
  }

  if (!trimmed.startsWith('event:') && !trimmed.startsWith('data:')) {
    try {
      return JSON.parse(trimmed) as RpcBody;
    } catch {
      return null;
    }
  }

  let last: RpcBody | null = null;
  for (const line of trimmed.split(/\r?\n/)) {
    if (!line.startsWith('data:')) {
      continue;
    }
    const data = line.slice(5).trim();
    if (!data || data === '[DONE]') {
      continue;
    }
    try {
      const parsed = JSON.parse(data) as RpcBody;
      if (parsed.result !== undefined || parsed.error !== undefined) {
        last = parsed;
      }
    } catch {
      continue;
    }
  }
  return last;
}

async function withTimeout<T>(
  run: (signal: AbortSignal) => Promise<T>,
  timeoutMs: number,
  label: string,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await run(controller.signal);
  } catch (error) {
    if (controller.signal.aborted) {
      throw new Error(`request to ${label} timed out after ${timeoutMs}ms`);
    }
    throw error;
  } finally {
    clearTimeout(timer);
  }
}
