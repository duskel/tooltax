import { describe, expect, it } from 'vitest';
import { extractTools } from '../src/sources/normalize.js';
import { describeSource, parseSourceSpec } from '../src/sources/resolve.js';

describe('extractTools', () => {
  const tool = { name: 'echo', description: 'Echo input.' };

  it('accepts a bare array', () => {
    expect(extractTools([tool], 'test')).toEqual([tool]);
  });

  it('accepts a tools/list result', () => {
    expect(extractTools({ tools: [tool] }, 'test')).toEqual([tool]);
  });

  it('accepts a full JSON-RPC envelope', () => {
    expect(extractTools({ jsonrpc: '2.0', id: 1, result: { tools: [tool] } }, 'test')).toEqual([tool]);
  });

  it('accepts an empty tool list', () => {
    expect(extractTools({ tools: [] }, 'test')).toEqual([]);
  });

  it('finds tools nested inside a wrapper object', () => {
    expect(extractTools({ data: { result: { tools: [tool] } } }, 'test')).toEqual([tool]);
  });

  it('rejects JSON with no tool array', () => {
    expect(() => extractTools({ nope: 1 }, 'test')).toThrowError(/Could not find a tool array/);
  });

  it('rejects a tool missing a name', () => {
    expect(() => extractTools({ tools: [{ description: 'no name' }] }, 'test')).toThrowError(
      /not a valid tool definition/,
    );
  });

  it('names the offending index', () => {
    expect(() => extractTools({ tools: [tool, { description: 'x' }] }, 'test')).toThrowError(
      /index 1/,
    );
  });
});

describe('parseSourceSpec', () => {
  it('recognises stdin', () => {
    expect(parseSourceSpec('-')).toEqual({ type: 'stdin' });
    expect(parseSourceSpec('stdin')).toEqual({ type: 'stdin' });
  });

  it('recognises http and https urls', () => {
    expect(parseSourceSpec('https://example.com/tools.json')).toEqual({
      type: 'url',
      url: 'https://example.com/tools.json',
    });
    expect(parseSourceSpec('http://localhost:3000/mcp').type).toBe('url');
  });

  it('recognises npm packages with arguments', () => {
    expect(parseSourceSpec('npm:@modelcontextprotocol/server-filesystem /tmp')).toEqual({
      type: 'npm',
      package: '@modelcontextprotocol/server-filesystem',
      args: ['/tmp'],
    });
  });

  it('recognises pypi packages', () => {
    expect(parseSourceSpec('pypi:mcp-server-git')).toEqual({
      type: 'pypi',
      package: 'mcp-server-git',
      args: [],
    });
  });

  it('recognises raw commands and preserves quoted arguments', () => {
    expect(parseSourceSpec('cmd:node ./server.js --root "/tmp/my dir"')).toEqual({
      type: 'command',
      command: 'node',
      args: ['./server.js', '--root', '/tmp/my dir'],
    });
  });

  it('treats anything else as a file path', () => {
    expect(parseSourceSpec('./tools.json')).toEqual({ type: 'file', path: './tools.json' });
  });

  it('rejects an npm source with no package', () => {
    expect(() => parseSourceSpec('npm:')).toThrowError(/needs a package name/);
  });

  it('rejects a cmd source with no command', () => {
    expect(() => parseSourceSpec('cmd:')).toThrowError(/needs a command/);
  });
});

describe('describeSource', () => {
  it('renders each source type as the command a human would run', () => {
    expect(describeSource({ type: 'stdin' })).toBe('stdin');
    expect(describeSource({ type: 'file', path: 'a.json' })).toBe('a.json');
    expect(describeSource({ type: 'url', url: 'https://x/y' })).toBe('https://x/y');
    expect(describeSource({ type: 'npm', package: 'p', args: ['a'] })).toBe('npx -y p a');
    expect(describeSource({ type: 'pypi', package: 'p' })).toBe('uvx p');
    expect(describeSource({ type: 'command', command: 'node', args: ['s.js'] })).toBe('node s.js');
  });
});
