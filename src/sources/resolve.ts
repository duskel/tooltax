import { readFile } from 'node:fs/promises';
import { resolve as resolvePath } from 'node:path';
import type { ServerSource, ToolDefinition } from '../types.js';
import { fetchToolsOverHttp } from './http.js';
import { extractTools } from './normalize.js';
import { fetchToolsOverStdio } from './stdio.js';

export type ResolveOptions = {
  timeoutMs?: number;
  env?: Record<string, string>;
};

/**
 * Resolve a CLI `<source>` argument into tool definitions.
 *
 * Accepted forms:
 * - `-` or `stdin`         read a JSON payload from stdin
 * - `http://` / `https://` a static JSON schema or a live MCP HTTP endpoint
 * - `npm:<package>`        run `npx -y <package>` as a stdio MCP server
 * - `pypi:<package>`       run `uvx <package>` as a stdio MCP server
 * - `cmd:<command> [args]` run an arbitrary command as a stdio MCP server
 * - anything else          a path to a JSON file
 *
 * @throws {Error} with a message naming the source when resolution fails.
 */
export async function resolveSource(
  source: string,
  options: ResolveOptions = {},
): Promise<ToolDefinition[]> {
  const spec = parseSourceSpec(source);
  return resolveServerSource(spec, options);
}

/** Turn a CLI source string into a structured {@link ServerSource}. */
export function parseSourceSpec(source: string): ServerSource | { type: 'stdin' } {
  const trimmed = source.trim();

  if (trimmed === '-' || trimmed === 'stdin') {
    return { type: 'stdin' };
  }
  if (/^https?:\/\//i.test(trimmed)) {
    return { type: 'url', url: trimmed };
  }
  if (trimmed.startsWith('npm:')) {
    const rest = splitArgs(trimmed.slice(4));
    const pkg = rest.shift();
    if (!pkg) {
      throw new Error('npm: source needs a package name, e.g. npm:@modelcontextprotocol/server-memory');
    }
    return { type: 'npm', package: pkg, args: rest };
  }
  if (trimmed.startsWith('pypi:')) {
    const rest = splitArgs(trimmed.slice(5));
    const pkg = rest.shift();
    if (!pkg) {
      throw new Error('pypi: source needs a package name, e.g. pypi:mcp-server-git');
    }
    return { type: 'pypi', package: pkg, args: rest };
  }
  if (trimmed.startsWith('cmd:')) {
    const parts = splitArgs(trimmed.slice(4));
    const command = parts.shift();
    if (!command) {
      throw new Error('cmd: source needs a command, e.g. cmd:node ./my-server.js');
    }
    return { type: 'command', command, args: parts };
  }
  return { type: 'file', path: trimmed };
}

/** Resolve a structured source (used by both the CLI and the registry loader). */
export async function resolveServerSource(
  spec: ServerSource | { type: 'stdin' },
  options: ResolveOptions = {},
): Promise<ToolDefinition[]> {
  switch (spec.type) {
    case 'stdin': {
      const text = await readStdin();
      if (!text.trim()) {
        throw new Error('No data on stdin. Pipe a JSON tool schema, e.g. cat tools.json | tooltax score -');
      }
      return extractTools(parseJson(text, 'stdin'), 'stdin');
    }
    case 'file': {
      const path = resolvePath(spec.path);
      let text: string;
      try {
        text = await readFile(path, 'utf8');
      } catch (error) {
        const code = (error as NodeJS.ErrnoException).code;
        if (code === 'ENOENT') {
          throw new Error(`No such file: ${path}`);
        }
        if (code === 'EISDIR') {
          throw new Error(`${path} is a directory, not a JSON file.`);
        }
        throw new Error(`Could not read ${path}: ${error instanceof Error ? error.message : String(error)}`);
      }
      return extractTools(parseJson(text, path), path);
    }
    case 'url':
      return fetchToolsOverHttp({ url: spec.url, timeoutMs: options.timeoutMs });
    case 'npm':
      return fetchToolsOverStdio({
        command: npxCommand(),
        args: ['-y', spec.package, ...(spec.args ?? [])],
        env: { ...spec.env, ...options.env },
        timeoutMs: options.timeoutMs,
      });
    case 'pypi':
      return fetchToolsOverStdio({
        command: 'uvx',
        args: [spec.package, ...(spec.args ?? [])],
        env: { ...spec.env, ...options.env },
        timeoutMs: options.timeoutMs,
      });
    case 'command':
      return fetchToolsOverStdio({
        command: spec.command,
        args: spec.args ?? [],
        env: { ...spec.env, ...options.env },
        timeoutMs: options.timeoutMs,
      });
    default: {
      const exhaustive: never = spec;
      throw new Error(`Unsupported source type: ${JSON.stringify(exhaustive)}`);
    }
  }
}

/** A human-readable label for a source, used in reports. */
export function describeSource(spec: ServerSource | { type: 'stdin' }): string {
  switch (spec.type) {
    case 'stdin':
      return 'stdin';
    case 'file':
      return spec.path;
    case 'url':
      return spec.url;
    case 'npm':
      return `npx -y ${spec.package}${formatArgs(spec.args)}`;
    case 'pypi':
      return `uvx ${spec.package}${formatArgs(spec.args)}`;
    case 'command':
      return `${spec.command}${formatArgs(spec.args)}`;
    default:
      return 'unknown';
  }
}

function formatArgs(args?: string[]): string {
  return args && args.length > 0 ? ` ${args.join(' ')}` : '';
}

function npxCommand(): string {
  return process.platform === 'win32' ? 'npx.cmd' : 'npx';
}

function parseJson(text: string, label: string): unknown {
  try {
    return JSON.parse(text);
  } catch (error) {
    throw new Error(`${label} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

/** Split on whitespace, honouring simple single and double quoting. */
function splitArgs(input: string): string[] {
  const matches = input.trim().match(/(?:[^\s"']+|"[^"]*"|'[^']*')+/g);
  if (!matches) {
    return [];
  }
  return matches.map((part) => part.replace(/^["']|["']$/g, ''));
}

async function readStdin(): Promise<string> {
  if (process.stdin.isTTY) {
    return '';
  }
  const chunks: Buffer[] = [];
  for await (const chunk of process.stdin) {
    chunks.push(Buffer.from(chunk));
  }
  return Buffer.concat(chunks).toString('utf8');
}
