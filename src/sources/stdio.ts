import { spawn } from 'node:child_process';
import type { ToolDefinition } from '../types.js';

const PROTOCOL_VERSION = '2024-11-05';
const CLIENT_INFO = { name: 'tooltax', version: '0.1.0' };

export type StdioOptions = {
  command: string;
  args?: string[];
  env?: Record<string, string>;
  timeoutMs?: number;
  cwd?: string;
};

type JsonRpcMessage = {
  jsonrpc?: string;
  id?: number | string;
  method?: string;
  result?: { tools?: ToolDefinition[]; serverInfo?: { name?: string } };
  error?: { code?: number; message?: string };
};

/**
 * Launch an MCP server over stdio, perform the initialize handshake, and return
 * its `tools/list` response.
 *
 * The child is always killed before this resolves or rejects. Servers that write
 * banners to stdout instead of stdout-JSON are tolerated: non-JSON lines are
 * skipped rather than treated as protocol errors.
 *
 * @throws {Error} on spawn failure, protocol error, or timeout, with the
 *   server's stderr tail included so the cause is visible.
 */
export async function fetchToolsOverStdio(options: StdioOptions): Promise<ToolDefinition[]> {
  const timeoutMs = options.timeoutMs ?? 90_000;

  return new Promise<ToolDefinition[]>((resolve, reject) => {
    let child: ReturnType<typeof spawn>;
    try {
      child = spawn(options.command, options.args ?? [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, ...options.env },
        cwd: options.cwd,
      });
    } catch (error) {
      reject(new Error(`Failed to spawn "${options.command}": ${errorMessage(error)}`));
      return;
    }

    let settled = false;
    let stdoutBuffer = '';
    const stderrChunks: string[] = [];

    const cleanup = (): void => {
      clearTimeout(timer);
      child.stdout?.removeAllListeners();
      child.stderr?.removeAllListeners();
      child.removeAllListeners();
      if (child.exitCode === null && child.signalCode === null) {
        child.kill('SIGKILL');
      }
    };

    const finish = (error: Error | null, tools?: ToolDefinition[]): void => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      if (error) {
        reject(error);
      } else {
        resolve(tools ?? []);
      }
    };

    const stderrTail = (): string => {
      const text = stderrChunks.join('').trim();
      if (!text) {
        return '';
      }
      const tail = text.slice(-500);
      return `\n  server stderr: ${tail}`;
    };

    const timer = setTimeout(() => {
      finish(
        new Error(
          `Timed out after ${timeoutMs}ms waiting for "${options.command}" to list its tools.` +
            stderrTail(),
        ),
      );
    }, timeoutMs);

    const send = (message: Record<string, unknown>): void => {
      if (child.stdin?.writable) {
        child.stdin.write(`${JSON.stringify(message)}\n`);
      }
    };

    child.on('error', (error) => {
      finish(new Error(`Failed to run "${options.command}": ${errorMessage(error)}${stderrTail()}`));
    });

    child.on('exit', (code, signal) => {
      if (settled) {
        return;
      }
      finish(
        new Error(
          `"${options.command}" exited (code ${code ?? 'null'}, signal ${signal ?? 'null'}) ` +
            `before returning its tool list.${stderrTail()}`,
        ),
      );
    });

    child.stderr?.on('data', (chunk: Buffer) => {
      stderrChunks.push(chunk.toString());
      if (stderrChunks.length > 200) {
        stderrChunks.splice(0, stderrChunks.length - 200);
      }
    });

    child.stdout?.on('data', (chunk: Buffer) => {
      stdoutBuffer += chunk.toString();
      let newlineIndex: number;
      while ((newlineIndex = stdoutBuffer.indexOf('\n')) !== -1) {
        const line = stdoutBuffer.slice(0, newlineIndex).trim();
        stdoutBuffer = stdoutBuffer.slice(newlineIndex + 1);
        if (!line) {
          continue;
        }

        let message: JsonRpcMessage;
        try {
          message = JSON.parse(line) as JsonRpcMessage;
        } catch {
          continue;
        }

        if (message.error && (message.id === 1 || message.id === 2)) {
          finish(
            new Error(
              `MCP server returned an error: ${message.error.message ?? 'unknown error'}` +
                `${message.error.code !== undefined ? ` (code ${message.error.code})` : ''}${stderrTail()}`,
            ),
          );
          return;
        }

        if (message.id === 1) {
          send({ jsonrpc: '2.0', method: 'notifications/initialized' });
          send({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} });
          continue;
        }

        if (message.id === 2) {
          const tools = message.result?.tools;
          if (!Array.isArray(tools)) {
            finish(new Error(`MCP server returned a tools/list response with no tools array.${stderrTail()}`));
            return;
          }
          finish(null, tools);
          return;
        }
      }
    });

    send({
      jsonrpc: '2.0',
      id: 1,
      method: 'initialize',
      params: {
        protocolVersion: PROTOCOL_VERSION,
        capabilities: {},
        clientInfo: CLIENT_INFO,
      },
    });
  });
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
