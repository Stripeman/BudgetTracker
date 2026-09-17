'use strict';
// BT-013 Design Gallery — the 15-concept manifest (originally 20; Terry cut 5 on 2026-09-17, see
// api/_shared/layouts.js) is well-formed metadata: stable, unique ids and every field the Gallery UI
// and comparison matrix depend on, so a missing field fails a test rather than rendering blank in
// front of Terry.
const { test, describe } = require('node:test');
const assert = require('node:assert/strict');
const { CONCEPTS, CONCEPT_IDS, REQUIRED_PAGES, REAL_LAYOUT_OPTIONS, REAL_DEFAULT_LAYOUT_ID, NAV_STYLES, DENSITIES, DASHBOARD_PATTERNS, CARD_STYLES, CHART_EMPHASES } = require('../_shared/layouts');

describe('BT-013 layout manifests', () => {
  test('exactly 15 concepts, unique ids', () => {
    assert.equal(CONCEPTS.length, 15);
    assert.equal(new Set(CONCEPT_IDS).size, 15);
  });

  test('every concept has the fields the Gallery and comparison matrix render', () => {
    for (const c of CONCEPTS) {
      assert.match(c.id, /^[a-z][a-z0-9-]+$/, `${c.id} id shape`);
      assert.ok(c.name.length > 3, `${c.id} name`);
      assert.ok(c.tagline.length > 10, `${c.id} tagline`);
      assert.ok(c.direction.length > 40, `${c.id} direction`);
      assert.ok(c.distinct.length > 40, `${c.id} distinct`);
      assert.ok(c.audience.length > 20, `${c.id} audience`);
      assert.ok(Array.isArray(c.strengths) && c.strengths.length >= 2, `${c.id} strengths`);
      assert.ok(Array.isArray(c.tradeoffs) && c.tradeoffs.length >= 1, `${c.id} tradeoffs`);
      assert.ok(Array.isArray(c.accessibilityNotes) && c.accessibilityNotes.length >= 1, `${c.id} accessibilityNotes`);
      assert.ok(NAV_STYLES.includes(c.navStyle), `${c.id} navStyle ${c.navStyle}`);
      assert.ok(DENSITIES.includes(c.density), `${c.id} density ${c.density}`);
      assert.ok(DASHBOARD_PATTERNS.includes(c.dashboardPattern), `${c.id} dashboardPattern ${c.dashboardPattern}`);
      assert.ok(CARD_STYLES.includes(c.cardStyle), `${c.id} cardStyle ${c.cardStyle}`);
      assert.ok(CHART_EMPHASES.includes(c.chartEmphasis), `${c.id} chartEmphasis ${c.chartEmphasis}`);
      assert.ok(['flagship', 'standard'].includes(c.fidelity), `${c.id} fidelity`);
      assert.equal(typeof c.recommended, 'boolean', `${c.id} recommended`);
    }
  });

  test('at least 8 distinct dashboard patterns are actually used (genuine structural variety, not one hero recoloured 20 times)', () => {
    assert.ok(new Set(CONCEPTS.map((c) => c.dashboardPattern)).size >= 8);
  });

  test('at least 4 distinct nav styles and all 4 densities appear', () => {
    assert.ok(new Set(CONCEPTS.map((c) => c.navStyle)).size >= 4);
    assert.ok(new Set(CONCEPTS.map((c) => c.density)).size === 4);
  });

  test('exactly 8 of the remaining 15 concepts are marked recommended (2 of the original top-10 were among the 5 Terry cut)', () => {
    assert.equal(CONCEPTS.filter((c) => c.recommended).length, 8);
  });

  test('the 7 pages Terry\'s brief names as the minimum review deliverable', () => {
    assert.deepEqual(REQUIRED_PAGES, ['dashboard', 'transactions', 'bills', 'budget', 'shared', 'trips', 'settings']);
  });

  test('today\'s one real, selectable layout is "classic" and nothing else — none of the 15 concepts are live-selectable yet', () => {
    assert.deepEqual(REAL_LAYOUT_OPTIONS, [{ value: 'classic', label: 'Classic (current)' }]);
    assert.equal(REAL_DEFAULT_LAYOUT_ID, 'classic');
    assert.ok(!CONCEPT_IDS.includes('classic'));
  });
});
