import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Load Utils.gs — .gs files are plain JS with global function declarations.
// new Function() scopes them; the appended return exposes the ones we need.
const utilsCode = readFileSync(
  new URL('../src/Utils.gs', import.meta.url),
  'utf8',
);
const load = new Function(
  utilsCode + '\nreturn { parseFromHeader, stripHtmlToText_ };',
);
const { parseFromHeader, stripHtmlToText_ } = load();

// Load Rules.gs — same pattern. It depends on no external globals.
const rulesCode = readFileSync(
  new URL('../src/Rules.gs', import.meta.url),
  'utf8',
);
const loadRules = new Function(
  rulesCode + '\nreturn { matchRule };',
);
const { matchRule } = loadRules();

// ---------------------------------------------------------------------------
// parseFromHeader
// ---------------------------------------------------------------------------
describe('parseFromHeader', () => {
  it('parses "Name <address>" format', () => {
    const result = parseFromHeader('Alice Smith <alice@example.com>');
    assert.equal(result.name, 'Alice Smith');
    assert.equal(result.address, 'alice@example.com');
  });

  it('parses bare address (no angle brackets)', () => {
    const result = parseFromHeader('bob@example.com');
    assert.equal(result.name, '');
    assert.equal(result.address, 'bob@example.com');
  });

  it('strips surrounding quotes from display name', () => {
    const result = parseFromHeader('"Quoted Name" <quoted@example.com>');
    assert.equal(result.name, 'Quoted Name');
    assert.equal(result.address, 'quoted@example.com');
  });

  it('returns empty fields for null input', () => {
    const result = parseFromHeader(null);
    assert.equal(result.name, '');
    assert.equal(result.address, '');
  });

  it('returns empty fields for undefined input', () => {
    const result = parseFromHeader(undefined);
    assert.equal(result.name, '');
    assert.equal(result.address, '');
  });

  it('returns empty fields for empty string', () => {
    const result = parseFromHeader('');
    assert.equal(result.name, '');
    assert.equal(result.address, '');
  });

  it('handles missing closing angle bracket', () => {
    const result = parseFromHeader('Name <broken@example.com');
    assert.equal(result.name, 'Name');
    assert.equal(result.address, 'broken@example.com');
  });

  it('uses lastIndexOf for multiple angle brackets in name', () => {
    const result = parseFromHeader('Name <weird> <real@example.com>');
    assert.equal(result.address, 'real@example.com');
  });

  it('trims whitespace from address and name', () => {
    const result = parseFromHeader('  Spacey   < space@example.com >');
    assert.equal(result.name, 'Spacey');
    assert.equal(result.address, 'space@example.com');
  });

  it('does not strip single quotes from name', () => {
    const result = parseFromHeader("'Single' <s@example.com>");
    assert.equal(result.name, "'Single'");
  });
});

// ---------------------------------------------------------------------------
// stripHtmlToText_
// ---------------------------------------------------------------------------
describe('stripHtmlToText_', () => {
  it('strips simple HTML tags', () => {
    const result = stripHtmlToText_('<p>Hello</p>');
    assert.match(result, /Hello/);
    assert.doesNotMatch(result, /<p>/);
  });

  it('replaces tags with spaces to preserve word boundaries', () => {
    const result = stripHtmlToText_('<b>Hello</b><i>World</i>');
    assert.match(result, /Hello\s+World/);
  });

  it('decodes &nbsp;', () => {
    const result = stripHtmlToText_('Hello&nbsp;World');
    assert.match(result, /Hello\s+World/);
  });

  it('decodes &amp;', () => {
    const result = stripHtmlToText_('Tom &amp; Jerry');
    assert.match(result, /Tom & Jerry/);
  });

  it('decodes &lt; and &gt;', () => {
    const result = stripHtmlToText_('a &lt; b &gt; c');
    assert.match(result, /a < b > c/);
  });

  it('decodes &quot;', () => {
    const result = stripHtmlToText_('say &quot;hello&quot;');
    assert.match(result, /say "hello"/);
  });

  it('decodes &#39; (numeric apostrophe)', () => {
    const result = stripHtmlToText_("it&#39;s fine");
    assert.match(result, /it's fine/);
  });

  it('decodes &apos; (named apostrophe)', () => {
    const result = stripHtmlToText_("it&apos;s fine");
    assert.match(result, /it's fine/);
  });

  it('decodes decimal numeric entities', () => {
    const result = stripHtmlToText_('&#65;&#66;&#67;');
    assert.match(result, /ABC/);
  });

  it('decodes hex numeric entities', () => {
    const result = stripHtmlToText_('&#x41;&#x42;&#x43;');
    assert.match(result, /ABC/);
  });

  it('handles nested tags', () => {
    const result = stripHtmlToText_('<div><p><b>Deep</b></p></div>');
    assert.match(result, /Deep/);
    assert.doesNotMatch(result, /</);
  });

  it('passes through plain text unchanged', () => {
    const result = stripHtmlToText_('just plain text');
    assert.equal(result, 'just plain text');
  });

  it('handles self-closing tags', () => {
    const result = stripHtmlToText_('line one<br/>line two');
    assert.match(result, /line one\s+line two/);
  });

  it('handles tags with attributes', () => {
    const result = stripHtmlToText_('<a href="http://example.com">click</a>');
    assert.match(result, /click/);
    assert.doesNotMatch(result, /href/);
  });
});

// ---------------------------------------------------------------------------
// matchRule
// ---------------------------------------------------------------------------
describe('matchRule', () => {
  it('matches senderDomain (case-insensitive)', () => {
    const rules = [{ match: { senderDomain: 'Chase.com' }, label: 'Financial' }];
    const result = matchRule({ name: 'Chase', address: 'alerts@chase.COM' }, 'Your statement', rules);
    assert.notEqual(result, null);
    assert.equal(result.label, 'Financial');
    assert.equal(result.action, 'LABEL');
  });

  it('matches senderAddress (case-insensitive)', () => {
    const rules = [{ match: { senderAddress: 'Alerts@Chase.com' }, label: 'Financial' }];
    const result = matchRule({ name: 'Chase', address: 'alerts@chase.com' }, 'Your statement', rules);
    assert.notEqual(result, null);
    assert.equal(result.label, 'Financial');
  });

  it('matches subjectContains (substring, case-insensitive)', () => {
    const rules = [{ match: { subjectContains: 'verification code' }, action: 'INBOX' }];
    const result = matchRule({ name: '', address: 'noreply@example.com' }, 'Your Verification Code is 1234', rules);
    assert.notEqual(result, null);
    assert.equal(result.action, 'INBOX');
  });

  it('matches displayName (case-insensitive)', () => {
    const rules = [{ match: { displayName: 'John Smith' }, label: 'Personal' }];
    const result = matchRule({ name: 'john smith', address: 'john@example.com' }, 'Hello', rules);
    assert.notEqual(result, null);
    assert.equal(result.label, 'Personal');
  });

  it('first-match-wins (earlier rule beats later)', () => {
    const rules = [
      { match: { senderDomain: 'example.com' }, label: 'First' },
      { match: { senderDomain: 'example.com' }, label: 'Second' },
    ];
    const result = matchRule({ name: '', address: 'a@example.com' }, '', rules);
    assert.equal(result.label, 'First');
  });

  it('returns null when no rule matches', () => {
    const rules = [{ match: { senderDomain: 'other.com' }, label: 'X' }];
    const result = matchRule({ name: '', address: 'a@example.com' }, '', rules);
    assert.equal(result, null);
  });

  it('defaults action to LABEL when omitted', () => {
    const rules = [{ match: { senderDomain: 'example.com' }, label: 'Stuff' }];
    const result = matchRule({ name: '', address: 'a@example.com' }, '', rules);
    assert.equal(result.action, 'LABEL');
  });

  it('INBOX action returns label: undefined', () => {
    const rules = [{ match: { senderDomain: 'example.com' }, action: 'INBOX' }];
    const result = matchRule({ name: '', address: 'a@example.com' }, '', rules);
    assert.equal(result.action, 'INBOX');
    assert.equal(result.label, undefined);
  });

  it('returns null for empty rules array', () => {
    const result = matchRule({ name: '', address: 'a@b.com' }, '', []);
    assert.equal(result, null);
  });

  it('returns null for null rules', () => {
    const result = matchRule({ name: '', address: 'a@b.com' }, '', null);
    assert.equal(result, null);
  });

  it('skips malformed rule (no match property)', () => {
    const rules = [
      { label: 'Bad' },
      { match: { senderDomain: 'example.com' }, label: 'Good' },
    ];
    const result = matchRule({ name: '', address: 'a@example.com' }, '', rules);
    assert.equal(result.label, 'Good');
  });

  it('handles null sender fields', () => {
    const rules = [{ match: { senderDomain: 'example.com' }, label: 'X' }];
    const result = matchRule(null, 'subject', rules);
    assert.equal(result, null);
  });

  it('handles null subject', () => {
    const rules = [{ match: { subjectContains: 'hello' }, action: 'INBOX' }];
    const result = matchRule({ name: '', address: 'a@b.com' }, null, rules);
    assert.equal(result, null);
  });
});
