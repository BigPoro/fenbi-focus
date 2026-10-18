'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { getSubject, listSubjects, listEssayQuestionCategories } = require('../src/subjects');

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
  assert.equal(getSubject('zhyynl').practiceMode, 'browser');
  assert.equal(getSubject('xingce').answerMode, 'objective');
});

test('rejects an unknown subject instead of falling back silently', () => {
  assert.throws(() => getSubject('unknown'), /不支持的科目/);
});

test('uses browser question types instead of knowledge-point IDs for the essay list', () => {
  assert.deepEqual(listEssayQuestionCategories().map(({ id, children }) => [id, children.map((child) => child.id)]), [
    [1, [59, 5]],
    [108, [109, 110, 111]],
    [112, [113, 114, 115, 118, 233, 234, 235, 236, 237]]
  ]);
});
