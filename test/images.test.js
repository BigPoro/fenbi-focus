'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { normalizeImageUrl, isFormulaImage } = require('../src/contracts');

test('normalizes protocol-relative URL to https', () => {
  assert.equal(
    normalizeImageUrl('//fbstatic.cn/test.png'),
    'https://fbstatic.cn/test.png'
  );
});

test('fixes corrupted double slashes after scheme', () => {
  assert.equal(
    normalizeImageUrl('https:////fbstatic.cn/test.png'),
    'https://fbstatic.cn/test.png'
  );
  assert.equal(
    normalizeImageUrl('http:////fbstatic.cn/test.png'),
    'https://fbstatic.cn/test.png'
  );
});

test('upgrades insecure http to https for non-localhost URLs', () => {
  assert.equal(
    normalizeImageUrl('http://tiku.fenbi.com/question/img123.jpg'),
    'https://tiku.fenbi.com/question/img123.jpg'
  );
});

test('keeps data URIs and blob URIs intact', () => {
  const dataUri = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';
  assert.equal(normalizeImageUrl(dataUri), dataUri);
  assert.equal(normalizeImageUrl('blob:https://tiku.fenbi.com/abc'), 'blob:https://tiku.fenbi.com/abc');
});

test('returns empty string for null, undefined, or empty values', () => {
  assert.equal(normalizeImageUrl(''), '');
  assert.equal(normalizeImageUrl(null), '');
  assert.equal(normalizeImageUrl(undefined), '');
  assert.equal(normalizeImageUrl('   '), '');
});

test('identifies formula images correctly', () => {
  assert.equal(isFormulaImage('https://tiku.fenbi.com/formulas?f=x%5E2'), true);
  assert.equal(isFormulaImage('https://tiku.fenbi.com/formula/123.png'), true);
  assert.equal(isFormulaImage('https://fbstatic.cn/latex/abc.png'), true);
  assert.equal(isFormulaImage('https://fbstatic.cn/math.png', '数学公式'), true);
  assert.equal(isFormulaImage('https://fbstatic.cn/test.png', '', 'custom-formula-item'), true);
  assert.equal(isFormulaImage('https://fbstatic.cn/chart.png', '统计图表', ''), false);
});
