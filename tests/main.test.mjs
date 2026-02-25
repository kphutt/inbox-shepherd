import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

// Load Main.gs — extract only the pure helper functions.
// processInbox depends on Apps Script globals and can't be tested locally.
const mainCode = readFileSync(
  new URL('../src/Main.gs', import.meta.url),
  'utf8',
);
const load = new Function(
  mainCode + '\nreturn { computeTaxonomyHash, computeMode };',
);
const { computeTaxonomyHash, computeMode } = load();

// ---------------------------------------------------------------------------
// computeTaxonomyHash
// ---------------------------------------------------------------------------
describe('computeTaxonomyHash', () => {
  it('returns an 8-character hex string', () => {
    const hash = computeTaxonomyHash({ A: 'desc A', B: 'desc B' });
    assert.equal(hash.length, 8);
    assert.match(hash, /^[0-9a-f]{8}$/);
  });

  it('is deterministic across calls', () => {
    const taxonomy = { Financial: 'Banking', Shopping: 'Retail' };
    const hash1 = computeTaxonomyHash(taxonomy);
    const hash2 = computeTaxonomyHash(taxonomy);
    assert.equal(hash1, hash2);
  });

  it('produces the same hash regardless of key insertion order', () => {
    const tax1 = { A: 'first', B: 'second', C: 'third' };
    const tax2 = { C: 'third', A: 'first', B: 'second' };
    assert.equal(computeTaxonomyHash(tax1), computeTaxonomyHash(tax2));
  });

  it('produces different hashes for different taxonomies', () => {
    const tax1 = { Financial: 'Banking' };
    const tax2 = { Shopping: 'Retail' };
    assert.notEqual(computeTaxonomyHash(tax1), computeTaxonomyHash(tax2));
  });

  it('produces different hashes when values differ', () => {
    const tax1 = { Financial: 'Banking' };
    const tax2 = { Financial: 'Investment' };
    assert.notEqual(computeTaxonomyHash(tax1), computeTaxonomyHash(tax2));
  });

  it('handles single-entry taxonomy', () => {
    const hash = computeTaxonomyHash({ X: 'only' });
    assert.equal(hash.length, 8);
    assert.match(hash, /^[0-9a-f]{8}$/);
  });
});

// ---------------------------------------------------------------------------
// computeMode
// ---------------------------------------------------------------------------
describe('computeMode', () => {
  const config = {
    operator: {
      backlogThreshold: 200,
      batchSize: { cleanup: 100, maintenance: 50 },
    },
  };

  it('returns CLEANUP when threadCount > backlogThreshold', () => {
    const result = computeMode(201, config);
    assert.equal(result.mode, 'CLEANUP');
    assert.equal(result.batchSize, 100);
  });

  it('returns MAINTENANCE when threadCount <= backlogThreshold', () => {
    const result = computeMode(150, config);
    assert.equal(result.mode, 'MAINTENANCE');
    assert.equal(result.batchSize, 50);
  });

  it('returns MAINTENANCE at exactly backlogThreshold (not strictly greater)', () => {
    const result = computeMode(200, config);
    assert.equal(result.mode, 'MAINTENANCE');
    assert.equal(result.batchSize, 50);
  });

  it('returns CLEANUP at backlogThreshold + 1', () => {
    const result = computeMode(201, config);
    assert.equal(result.mode, 'CLEANUP');
    assert.equal(result.batchSize, 100);
  });

  it('returns MAINTENANCE for zero threads', () => {
    const result = computeMode(0, config);
    assert.equal(result.mode, 'MAINTENANCE');
    assert.equal(result.batchSize, 50);
  });

  it('returns CLEANUP for very large thread counts', () => {
    const result = computeMode(10000, config);
    assert.equal(result.mode, 'CLEANUP');
    assert.equal(result.batchSize, 100);
  });
});
