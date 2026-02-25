import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Load Utils.gs + Annotations.gs together (mimics Apps Script flat namespace).
const utilsCode = readFileSync(
  new URL('../src/Utils.gs', import.meta.url),
  'utf8',
);
const annotationsCode = readFileSync(
  new URL('../src/Annotations.gs', import.meta.url),
  'utf8',
);
const load = new Function(
  utilsCode + '\n' + annotationsCode +
  '\nreturn { buildAnnotations, isNoreply, detectPlatform_, detectAddressing_, containsAddress_, getHeader };',
);
const mod = load();

// Mock message helper — builds an object with getFrom() and getRawContent().
function mockMessage(headers, fromValue) {
  const rawLines = Object.keys(headers).map(function (k) {
    return k + ': ' + headers[k];
  });
  return {
    getFrom: function () { return fromValue || ''; },
    getRawContent: function () { return rawLines.join('\r\n') + '\r\n\r\nBody text'; },
  };
}

// ---------------------------------------------------------------------------
// isNoreply
// ---------------------------------------------------------------------------
describe('isNoreply', () => {
  it('matches noreply@', () => {
    assert.equal(mod.isNoreply('noreply@example.com'), true);
  });

  it('matches no-reply@', () => {
    assert.equal(mod.isNoreply('no-reply@example.com'), true);
  });

  it('matches donotreply@', () => {
    assert.equal(mod.isNoreply('donotreply@example.com'), true);
  });

  it('matches case-insensitively', () => {
    assert.equal(mod.isNoreply('NOREPLY@example.com'), true);
    assert.equal(mod.isNoreply('No-Reply@example.com'), true);
  });

  it('rejects normal addresses', () => {
    assert.equal(mod.isNoreply('hello@example.com'), false);
  });

  it('handles null/undefined', () => {
    assert.equal(mod.isNoreply(null), false);
    assert.equal(mod.isNoreply(undefined), false);
  });

  it('handles empty string', () => {
    assert.equal(mod.isNoreply(''), false);
  });
});

// ---------------------------------------------------------------------------
// getHeader
// ---------------------------------------------------------------------------
describe('getHeader', () => {
  it('extracts a basic header value', () => {
    const msg = mockMessage({ 'Subject': 'Hello world' });
    assert.equal(mod.getHeader(msg, 'Subject'), 'Hello world');
  });

  it('is case-insensitive for header name lookup', () => {
    const msg = mockMessage({ 'Content-Type': 'text/html' });
    assert.equal(mod.getHeader(msg, 'content-type'), 'text/html');
  });

  it('returns empty string for missing header', () => {
    const msg = mockMessage({ 'Subject': 'Hi' });
    assert.equal(mod.getHeader(msg, 'X-Missing'), '');
  });

  it('handles header continuation (folded lines)', () => {
    // Simulate a folded header: "Received: first\r\n  continuation"
    const raw = 'Received: first\r\n  continuation\r\n\r\nBody';
    const msg = {
      getFrom: function () { return ''; },
      getRawContent: function () { return raw; },
    };
    assert.equal(mod.getHeader(msg, 'Received'), 'first continuation');
  });

  it('caches parsed headers on the message object', () => {
    const msg = mockMessage({ 'X-Test': 'value' });
    mod.getHeader(msg, 'X-Test');
    assert.ok(msg._parsedHeaders);
    assert.equal(msg._parsedHeaders['x-test'], 'value');
  });
});

// ---------------------------------------------------------------------------
// detectPlatform_
// ---------------------------------------------------------------------------
describe('detectPlatform_', () => {
  it('detects known ESP from exact domain', () => {
    const msg = mockMessage({ 'Return-Path': '<bounce@sendgrid.net>' }, 'test@example.com');
    assert.equal(mod.detectPlatform_(msg), '[via SendGrid]');
  });

  it('detects known ESP from subdomain', () => {
    const msg = mockMessage({ 'Return-Path': '<bounce@em123.sendgrid.net>' }, 'test@example.com');
    assert.equal(mod.detectPlatform_(msg), '[via SendGrid]');
  });

  it('detects Campaign Monitor cmail pattern', () => {
    const msg = mockMessage({ 'Return-Path': '<bounce@cmail20.com>' }, 'test@example.com');
    assert.equal(mod.detectPlatform_(msg), '[via Campaign Monitor]');
  });

  it('returns empty string for unknown domain', () => {
    const msg = mockMessage({ 'Return-Path': '<bounce@unknown-esp.com>' }, 'test@example.com');
    assert.equal(mod.detectPlatform_(msg), '');
  });

  it('returns empty string for missing Return-Path', () => {
    const msg = mockMessage({}, 'test@example.com');
    assert.equal(mod.detectPlatform_(msg), '');
  });

  it('does not false-positive on notamazonses.com', () => {
    const msg = mockMessage({ 'Return-Path': '<bounce@notamazonses.com>' }, 'test@example.com');
    assert.equal(mod.detectPlatform_(msg), '');
  });

  it('detects Mailchimp from mcsv.net', () => {
    const msg = mockMessage({ 'Return-Path': '<bounce@mail.mcsv.net>' }, 'test@example.com');
    assert.equal(mod.detectPlatform_(msg), '[via Mailchimp]');
  });

  it('handles Return-Path without angle brackets', () => {
    const msg = mockMessage({ 'Return-Path': 'bounce@mailgun.org' }, 'test@example.com');
    assert.equal(mod.detectPlatform_(msg), '[via Mailgun]');
  });
});

// ---------------------------------------------------------------------------
// detectAddressing_
// ---------------------------------------------------------------------------
describe('detectAddressing_', () => {
  it('returns "direct" when owner is in To header', () => {
    const msg = mockMessage({
      'To': 'owner@example.com',
      'Cc': '',
    }, 'sender@example.com');
    assert.equal(mod.detectAddressing_(msg, 'owner@example.com'), 'direct');
  });

  it('returns "CC" when owner is in Cc header', () => {
    const msg = mockMessage({
      'To': 'someone@example.com',
      'Cc': 'owner@example.com',
    }, 'sender@example.com');
    assert.equal(mod.detectAddressing_(msg, 'owner@example.com'), 'CC');
  });

  it('returns "BCC/undisclosed" when owner is in neither', () => {
    const msg = mockMessage({
      'To': 'someone@example.com',
      'Cc': 'other@example.com',
    }, 'sender@example.com');
    assert.equal(mod.detectAddressing_(msg, 'owner@example.com'), 'BCC/undisclosed');
  });

  it('handles missing To and Cc headers', () => {
    const msg = mockMessage({}, 'sender@example.com');
    assert.equal(mod.detectAddressing_(msg, 'owner@example.com'), 'BCC/undisclosed');
  });

  it('is case-insensitive for owner email', () => {
    const msg = mockMessage({
      'To': 'OWNER@Example.COM',
    }, 'sender@example.com');
    assert.equal(mod.detectAddressing_(msg, 'owner@example.com'), 'direct');
  });

  it('avoids substring collision (bob@gmail.com vs bob@gmail.company.com)', () => {
    const msg = mockMessage({
      'To': 'bob@gmail.company.com',
    }, 'sender@example.com');
    assert.equal(mod.detectAddressing_(msg, 'bob@gmail.com'), 'BCC/undisclosed');
  });

  it('handles multiple recipients in To', () => {
    const msg = mockMessage({
      'To': 'first@example.com, owner@example.com, third@example.com',
    }, 'sender@example.com');
    assert.equal(mod.detectAddressing_(msg, 'owner@example.com'), 'direct');
  });

  it('handles display-name format in To', () => {
    const msg = mockMessage({
      'To': 'Owner Name <owner@example.com>',
    }, 'sender@example.com');
    assert.equal(mod.detectAddressing_(msg, 'owner@example.com'), 'direct');
  });
});

// ---------------------------------------------------------------------------
// buildAnnotations (end-to-end)
// ---------------------------------------------------------------------------
describe('buildAnnotations', () => {
  it('returns all three fields', () => {
    const msg = mockMessage({
      'Return-Path': '<bounce@sendgrid.net>',
      'To': 'owner@example.com',
    }, 'noreply@shop.com');

    const result = mod.buildAnnotations(msg, 'owner@example.com');
    assert.equal(result.platform, '[via SendGrid]');
    assert.equal(result.addressing, 'direct');
    assert.equal(result.noreply, true);
  });

  it('returns defaults for minimal message', () => {
    const msg = mockMessage({}, 'person@example.com');

    const result = mod.buildAnnotations(msg, 'owner@example.com');
    assert.equal(result.platform, '');
    assert.equal(result.addressing, 'BCC/undisclosed');
    assert.equal(result.noreply, false);
  });
});
