import { describe, expect, it } from 'vitest';
import { parseFrontmatter } from '../../scripts/harvest/enumerate.ts';

describe('parseFrontmatter', () => {
  it('parses the common name/description pair and returns the body', () => {
    const result = parseFrontmatter(
      '---\nname: pdf-processing\ndescription: Extract text from PDF files.\n---\n\n# PDF\n\nUse it.\n',
    );
    expect(result.frontmatter).toEqual({
      name: 'pdf-processing',
      description: 'Extract text from PDF files.',
    });
    expect(result.body).toBe('# PDF\n\nUse it.');
  });

  it('keeps colons inside an unquoted value and strips quotes from a quoted one', () => {
    const result = parseFrontmatter(
      '---\ndescription: Use this: it scans lockfiles\nname: "supply, chain"\n---\nx',
    );
    expect(result.frontmatter.description).toBe('Use this: it scans lockfiles');
    expect(result.frontmatter.name).toBe('supply, chain');
  });

  it('parses inline and block sequences', () => {
    const result = parseFrontmatter(
      '---\nallowed-tools: [Read, Write, Bash]\ncompatibility:\n  - claude-code\n  - openclaw\nempty: []\n---\nbody',
    );
    expect(result.frontmatter['allowed-tools']).toEqual(['Read', 'Write', 'Bash']);
    expect(result.frontmatter.compatibility).toEqual(['claude-code', 'openclaw']);
    expect(result.frontmatter.empty).toEqual([]);
  });

  it('parses a one-level nested map', () => {
    const result = parseFrontmatter(
      '---\nname: x\nmetadata:\n  author: someone\n  version: 2\n  stable: true\n---\nbody',
    );
    expect(result.frontmatter.metadata).toEqual({
      author: 'someone',
      version: 2,
      stable: true,
    });
  });

  it('parses literal and folded block scalars', () => {
    const literal = parseFrontmatter('---\ndescription: |\n  line one\n  line two\n---\nbody');
    expect(literal.frontmatter.description).toBe('line one\nline two');
    const folded = parseFrontmatter('---\ndescription: >-\n  line one\n  line two\n---\nbody');
    expect(folded.frontmatter.description).toBe('line one line two');
  });

  it('ignores comments and blank lines', () => {
    const result = parseFrontmatter('---\n# a comment\n\nname: x\n---\nbody');
    expect(result.frontmatter).toEqual({ name: 'x' });
  });

  it('handles CRLF, a BOM, and an empty frontmatter block', () => {
    const crlf = parseFrontmatter('---\r\nname: x\r\n---\r\nbody\r\n');
    expect(crlf.frontmatter).toEqual({ name: 'x' });
    expect(crlf.body).toBe('body');
    const bom = parseFrontmatter('﻿---\nname: y\n---\nbody');
    expect(bom.frontmatter).toEqual({ name: 'y' });
    const none = parseFrontmatter('---\n---\nbody');
    expect(none.frontmatter).toEqual({});
    expect(none.body).toBe('body');
  });

  it('returns an empty map when there is no frontmatter at all', () => {
    const result = parseFrontmatter('# Just a heading\n\ntext');
    expect(result.frontmatter).toEqual({});
    expect(result.body).toBe('# Just a heading\n\ntext');
    const unterminated = parseFrontmatter('---\nname: x\nstill going');
    expect(unterminated.frontmatter).toEqual({});
  });

  it('coerces booleans, numbers and null', () => {
    const result = parseFrontmatter(
      '---\na: true\nb: false\nc: 42\nd: 1.5\ne: null\nf: 1.2.3\n---\nx',
    );
    expect(result.frontmatter).toEqual({
      a: true,
      b: false,
      c: 42,
      d: 1.5,
      e: null,
      f: '1.2.3',
    });
  });
});
