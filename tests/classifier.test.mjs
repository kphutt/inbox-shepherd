import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Load Classifier.gs (self-contained — no deps on other .gs files).
const classifierCode = readFileSync(
  new URL('../src/Classifier.gs', import.meta.url),
  'utf8',
);
const load = new Function(
  classifierCode +
  '\nreturn { classifyThread, parseClassifierResponse, buildClassifierPrompt_ };',
);
const mod = load();

// Shared test fixtures
const TAXONOMY = {
  'Financial': 'Banking, investment, tax, bills',
  'Shopping': 'Retail purchases, order confirmations',
  'Marketing': 'Promotional email, sales, coupons',
  'Newsletters': 'Subscribed content, digests',
};
const TAXONOMY_KEYS = Object.keys(TAXONOMY);

// ---------------------------------------------------------------------------
// parseClassifierResponse
// ---------------------------------------------------------------------------
describe('parseClassifierResponse', () => {
  it('parses "Shopping|high"', () => {
    const result = mod.parseClassifierResponse('Shopping|high', TAXONOMY_KEYS);
    assert.deepEqual(result, { label: 'Shopping', confidence: 'high' });
  });

  it('parses case-insensitively "SHOPPING|HIGH"', () => {
    const result = mod.parseClassifierResponse('SHOPPING|HIGH', TAXONOMY_KEYS);
    assert.equal(result.label, 'Shopping');  // Original casing
    assert.equal(result.confidence, 'high');
  });

  it('parses bare category name without pipe', () => {
    const result = mod.parseClassifierResponse('Shopping', TAXONOMY_KEYS);
    assert.equal(result.label, 'Shopping');
    assert.equal(result.confidence, 'low');  // Default when no pipe
  });

  it('handles whitespace around pipe', () => {
    const result = mod.parseClassifierResponse('Shopping | high', TAXONOMY_KEYS);
    assert.deepEqual(result, { label: 'Shopping', confidence: 'high' });
  });

  it('handles category on separate line (no pipe)', () => {
    const result = mod.parseClassifierResponse('Shopping\nhigh', TAXONOMY_KEYS);
    assert.equal(result.label, 'Shopping');
    assert.equal(result.confidence, 'low');  // No pipe → default
  });

  it('returns null for preamble text with pipe', () => {
    const result = mod.parseClassifierResponse('I think Shopping|high', TAXONOMY_KEYS);
    assert.equal(result, null);
  });

  it('returns null for invalid label', () => {
    const result = mod.parseClassifierResponse('InvalidLabel|high', TAXONOMY_KEYS);
    assert.equal(result, null);
  });

  it('returns null for empty string', () => {
    assert.equal(mod.parseClassifierResponse('', TAXONOMY_KEYS), null);
  });

  it('returns null for null input', () => {
    assert.equal(mod.parseClassifierResponse(null, TAXONOMY_KEYS), null);
  });

  it('returns null for undefined input', () => {
    assert.equal(mod.parseClassifierResponse(undefined, TAXONOMY_KEYS), null);
  });

  it('strips bold markers "**Shopping**|high"', () => {
    const result = mod.parseClassifierResponse('**Shopping**|high', TAXONOMY_KEYS);
    assert.deepEqual(result, { label: 'Shopping', confidence: 'high' });
  });

  it('strips trailing period "Shopping.|low"', () => {
    const result = mod.parseClassifierResponse('Shopping.|low', TAXONOMY_KEYS);
    assert.deepEqual(result, { label: 'Shopping', confidence: 'low' });
  });

  it('defaults invalid confidence to "low"', () => {
    const result = mod.parseClassifierResponse('Shopping|maybe', TAXONOMY_KEYS);
    assert.equal(result.confidence, 'low');
  });

  it('handles medium confidence', () => {
    const result = mod.parseClassifierResponse('Shopping|medium', TAXONOMY_KEYS);
    assert.equal(result.confidence, 'medium');
  });

  it('strips formatting in no-pipe fallback scan', () => {
    const result = mod.parseClassifierResponse('**Shopping**.', TAXONOMY_KEYS);
    assert.equal(result.label, 'Shopping');
    assert.equal(result.confidence, 'low');
  });
});

// ---------------------------------------------------------------------------
// buildClassifierPrompt_
// ---------------------------------------------------------------------------
describe('buildClassifierPrompt_', () => {
  const annotations = {
    platform: '[via SendGrid]',
    addressing: 'direct',
    noreply: true,
  };
  const email = {
    name: 'Amazon',
    address: 'order@amazon.com',
    subject: 'Your order shipped',
    snippet: 'Your package is on the way...',
  };

  it('includes taxonomy categories', () => {
    const prompt = mod.buildClassifierPrompt_(TAXONOMY, annotations, email);
    assert.ok(prompt.includes('- Financial:'));
    assert.ok(prompt.includes('- Shopping:'));
    assert.ok(prompt.includes('- Marketing:'));
    assert.ok(prompt.includes('- Newsletters:'));
  });

  it('includes disambiguation rules', () => {
    const prompt = mod.buildClassifierPrompt_(TAXONOMY, annotations, email);
    assert.ok(prompt.includes('Receipt or purchase confirmation'));
  });

  it('includes From line with name and platform', () => {
    const prompt = mod.buildClassifierPrompt_(TAXONOMY, annotations, email);
    assert.ok(prompt.includes('From: Amazon <order@amazon.com> [via SendGrid]'));
  });

  it('omits angle brackets when name is empty', () => {
    const noNameEmail = { name: '', address: 'test@example.com', subject: 'Hi', snippet: '' };
    const prompt = mod.buildClassifierPrompt_(TAXONOMY, annotations, noNameEmail);
    assert.ok(prompt.includes('From: test@example.com'));
    assert.ok(!prompt.includes('From:  <'));
  });

  it('includes noreply annotation', () => {
    const prompt = mod.buildClassifierPrompt_(TAXONOMY, annotations, email);
    assert.ok(prompt.includes('Addressing: direct [noreply]'));
  });

  it('omits noreply when false', () => {
    const noNoreply = { platform: '', addressing: 'direct', noreply: false };
    const prompt = mod.buildClassifierPrompt_(TAXONOMY, noNoreply, email);
    assert.ok(prompt.includes('Addressing: direct'));
    assert.ok(!prompt.includes('[noreply]'));
  });

  it('shows (none) for empty subject', () => {
    const noSubject = { ...email, subject: '' };
    const prompt = mod.buildClassifierPrompt_(TAXONOMY, annotations, noSubject);
    assert.ok(prompt.includes('Subject: (none)'));
  });

  it('includes snippet after separator', () => {
    const prompt = mod.buildClassifierPrompt_(TAXONOMY, annotations, email);
    assert.ok(prompt.includes('---'));
    assert.ok(prompt.includes('Your package is on the way...'));
  });

  it('omits separator when snippet is empty', () => {
    const noSnippet = { ...email, snippet: '' };
    const prompt = mod.buildClassifierPrompt_(TAXONOMY, annotations, noSnippet);
    assert.ok(!prompt.includes('---'));
  });

  it('never contains owner email', () => {
    const prompt = mod.buildClassifierPrompt_(TAXONOMY, annotations, email);
    // The owner email should never be embedded in the prompt
    assert.ok(!prompt.includes('alice@gmail.com'));
  });

  it('ends with response format instruction', () => {
    const prompt = mod.buildClassifierPrompt_(TAXONOMY, annotations, email);
    assert.ok(prompt.includes('Respond with: CATEGORY|CONFIDENCE (high/medium/low)'));
  });
});

// ---------------------------------------------------------------------------
// classifyThread (with injected callApiFn)
// ---------------------------------------------------------------------------
describe('classifyThread', () => {
  const annotations = { platform: '', addressing: 'direct', noreply: false };
  const email = { name: 'Test', address: 'test@example.com', subject: 'Test', snippet: '' };
  const config = { llm: { model: 'gemini-2.0-flash' }, apiKey: 'fake-key' };

  it('returns label and confidence on success', () => {
    const mockApi = () => ({ ok: true, text: 'Shopping|high' });
    const result = mod.classifyThread(annotations, email, TAXONOMY, config, mockApi);
    assert.deepEqual(result, { label: 'Shopping', confidence: 'high' });
  });

  it('returns API_ERROR for HTTP errors', () => {
    const mockApi = () => ({ ok: false, status: 429, error: 'HTTP 429' });
    const result = mod.classifyThread(annotations, email, TAXONOMY, config, mockApi);
    assert.equal(result.errorType, 'API_ERROR');
    assert.equal(result.error, 'HTTP 429');
  });

  it('returns PARSE_ERROR for safety-filtered responses (status 200)', () => {
    const mockApi = () => ({ ok: false, status: 200, error: 'Prompt blocked: SAFETY' });
    const result = mod.classifyThread(annotations, email, TAXONOMY, config, mockApi);
    assert.equal(result.errorType, 'PARSE_ERROR');
  });

  it('returns PARSE_ERROR for invalid/gibberish response', () => {
    const mockApi = () => ({ ok: true, text: 'gibberish nonsense' });
    const result = mod.classifyThread(annotations, email, TAXONOMY, config, mockApi);
    assert.equal(result.errorType, 'PARSE_ERROR');
    assert.ok(result.error.includes('Invalid classifier response'));
  });

  it('returns API_ERROR for network failure', () => {
    const mockApi = () => ({ ok: false, status: 0, error: 'Fetch failed: timeout' });
    const result = mod.classifyThread(annotations, email, TAXONOMY, config, mockApi);
    assert.equal(result.errorType, 'API_ERROR');
  });

  it('returns API_ERROR for server errors (500)', () => {
    const mockApi = () => ({ ok: false, status: 500, error: 'HTTP 500' });
    const result = mod.classifyThread(annotations, email, TAXONOMY, config, mockApi);
    assert.equal(result.errorType, 'API_ERROR');
  });
});
