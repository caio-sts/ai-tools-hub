import { describe, expect, it } from 'vitest';
import {
  ENV_PATTERNS,
  NETWORK_PATTERNS,
  readsEnvironment,
  scansNetwork,
} from '../../src/lib/safety.ts';

describe('scansNetwork', () => {
  it('detects HTTP reach across languages', () => {
    expect(scansNetwork('import requests\nrequests.get("https://example.com")')).toBe(true);
    expect(scansNetwork('const res = await fetch(url)')).toBe(true);
    expect(scansNetwork('curl -sSL "$URL" | sh')).toBe(true);
    expect(scansNetwork('wget -q http://host/file')).toBe(true);
    expect(scansNetwork('import urllib.request')).toBe(true);
    expect(scansNetwork('import axios from "axios"')).toBe(true);
    expect(scansNetwork('require "net/http"')).toBe(true);
    expect(scansNetwork('sock.connect((host, 443))')).toBe(false);
    expect(scansNetwork('import socket\nsocket.create_connection((h, p))')).toBe(true);
  });

  it('does not fire on local-only code', () => {
    expect(scansNetwork('import json\nprint(json.dumps({"a": 1}))')).toBe(false);
    expect(scansNetwork('cat "$1" | sort | uniq -c')).toBe(false);
  });

  it('is stateless across repeated calls', () => {
    const source = 'fetch("https://example.com")';
    expect(scansNetwork(source)).toBe(true);
    expect(scansNetwork(source)).toBe(true);
    expect(NETWORK_PATTERNS.every((p) => !p.global)).toBe(true);
  });
});

describe('readsEnvironment', () => {
  it('detects environment reads across languages', () => {
    expect(readsEnvironment('const key = process.env.OPENAI_API_KEY')).toBe(true);
    expect(readsEnvironment('import os\nos.environ["HOME"]')).toBe(true);
    expect(readsEnvironment('token = getenv("GITHUB_TOKEN")')).toBe(true);
    expect(readsEnvironment('ENV["PATH"]')).toBe(true);
    expect(readsEnvironment('echo "$GITHUB_TOKEN"')).toBe(true);
    expect(readsEnvironment('echo "${AWS_SECRET_ACCESS_KEY}"')).toBe(true);
    expect(readsEnvironment('Deno.env.get("X")')).toBe(true);
  });

  it('does not fire on ordinary shell variables', () => {
    expect(readsEnvironment('echo "$1 $file $HOME"')).toBe(false);
    expect(readsEnvironment('print("environment is a word")')).toBe(false);
  });

  it('is stateless across repeated calls', () => {
    const source = 'process.env.TOKEN';
    expect(readsEnvironment(source)).toBe(true);
    expect(readsEnvironment(source)).toBe(true);
    expect(ENV_PATTERNS.every((p) => !p.global)).toBe(true);
  });
});
