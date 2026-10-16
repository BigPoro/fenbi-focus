'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { assertAuthorizedUrl, encodeForm, shouldAttachCookie } = require('../src/fenbiClient');

test('allows only explicit authenticated Fenbi hosts', () => {
  assert.equal(assertAuthorizedUrl('https://tiku.fenbi.com/api/x').hostname, 'tiku.fenbi.com');
  assert.equal(assertAuthorizedUrl('https://login.fenbi.com/api/x').hostname, 'login.fenbi.com');
  assert.throws(() => assertAuthorizedUrl('https://example.com/api/x'), /拒绝访问/);
  assert.throws(() => assertAuthorizedUrl('http://tiku.fenbi.com/api/x'), /拒绝访问/);
  assert.throws(() => assertAuthorizedUrl('https://tiku.fenbi.com.evil.test/api/x'), /拒绝访问/);
});

test('permits returned Fenbi static resources without leaking the cookie', () => {
  const url = assertAuthorizedUrl('https://example.fbstatic.cn/question.json');
  assert.equal(url.hostname, 'example.fbstatic.cn');
  assert.equal(shouldAttachCookie(url), false);
  assert.equal(shouldAttachCookie(new URL('https://tiku.fenbi.com/api/x')), true);
  assert.equal(shouldAttachCookie(new URL('https://urlimg.fenbi.com/api/pdf/tiku/xingce/exercise/1')), true);
});

test('encodes form values deterministically', () => {
  assert.equal(encodeForm({ type: 3, keypointId: 12 }), 'type=3&keypointId=12');
});

