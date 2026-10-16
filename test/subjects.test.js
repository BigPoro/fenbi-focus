'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getSubject, listSubjects } = require('../src/subjects');

test('exposes the six Fenbi subject routes with their answer modes', () => {
  assert.deepEqual(listSubjects().map(({ id, label }) => [id, label]), [
    ['xingce', '行测'],
    ['shenlun', '申论'],
    ['gwyms', '公务员面试'],
    ['syzc', '事业编笔试'],
    ['zhyynl', '事业单位综应'],
    ['sydwms', '事业单位面试']
  ]);
  assert.equal(getSubject('shenlun').answerMode, 'essay');
  assert.equal(getSubject('xingce').answerMode, 'objective');
});

test('rejects an unknown subject instead of falling back silently', () => {
  assert.throws(() => getSubject('unknown'), /不支持的科目/);
});
