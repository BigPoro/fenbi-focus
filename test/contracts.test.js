'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ContractError,
  normalizeCategories,
  normalizeCombinedQuestionSet,
  normalizeCurrentUser,
  normalizeExercise,
  normalizeErrorCategories,
  normalizeErrorQuestionIds,
  normalizeErrorSolutions,
  normalizeHistory,
  normalizePaperLabels,
  normalizePapers,
  normalizeQuestionSet
} = require('../src/contracts');

test('normalizes nested categories', () => {
  const result = normalizeCategories({ data: [{ id: 1, name: '判断推理', children: [{ id: 2, name: '图形推理' }] }] });
  assert.equal(result[0].children[0].name, '图形推理');
});

test('rejects category payload without an array', () => {
  assert.throws(() => normalizeCategories({ data: {} }), ContractError);
});

test('normalizes exercise answers without inventing values', () => {
  const result = normalizeExercise({ data: { id: 99, userAnswers: { 0: { answer: { choice: '2' } } } } });
  assert.equal(result.id, 99);
  assert.equal(result.userAnswers[0].answer.choice, '2');
});

test('requires the expected question collection', () => {
  assert.throws(() => normalizeQuestionSet({ data: { materials: [] } }, 'questions'), ContractError);
});

test('normalizes current user display name', () => {
  assert.deepEqual(normalizeCurrentUser({ id: 1, nickname: '测试用户' }), { id: '1', name: '测试用户' });
});

test('normalizes recent practice history without inventing missing scores', () => {
  const [item] = normalizeHistory({ datas: [{
    id: 88,
    key: 'exercise-key',
    status: 3,
    createTime: 1792108800000,
    questionCount: 10,
    correctCount: 7,
    sheet: { name: '专项智能练习', type: 0 }
  }] });
  assert.deepEqual(item, {
    id: 88,
    key: 'exercise-key',
    status: 3,
    createTime: 1792108800000,
    questionCount: 10,
    correctCount: 7,
    name: '专项智能练习',
    sheetType: 0
  });
});

test('requires history to contain a datas array', () => {
  assert.throws(() => normalizeHistory({ data: {} }), ContractError);
});

test('converts second-based history timestamps to milliseconds', () => {
  const [item] = normalizeHistory({ datas: [{ key: 'k', createTime: 1792108800 }] });
  assert.equal(item.createTime, 1792108800000);
});

test('maps card material keys onto essay questions', () => {
  const result = normalizeCombinedQuestionSet({
    questions: [{ globalId: 501, content: '请作答' }],
    card: {
      children: [{ children: [{ globalId: 501, materialKeys: [9001] }] }]
    },
    materials: [{ globalId: 9001, content: '<p>给定资料内容</p>' }]
  });
  assert.equal(result.items[0].materialContent, '<p>给定资料内容</p>');
});

test('does not repeat the same shared material on later questions', () => {
  const result = normalizeCombinedQuestionSet({
    questions: [{ globalId: 1 }, { globalId: 2 }],
    card: {
      children: [{ children: [
        { globalId: 1, materialKeys: [9] },
        { globalId: 2, materialKeys: [9] }
      ] }]
    },
    materials: [{ globalId: 9, content: '共享材料' }]
  });
  assert.equal(result.items[0].materialContent, '共享材料');
  assert.equal(result.items[1].materialContent, null);
});

test('normalizes nested wrong-question ids and keeps the server total', () => {
  const result = normalizeErrorQuestionIds({
    data: { questionIds: [101, '102', 101], pagination: { total: 9 } }
  });
  assert.deepEqual(result, { questionIds: ['101', '102'], total: 9 });
});

test('accepts wrong-question id records returned as objects', () => {
  assert.deepEqual(normalizeErrorQuestionIds({ records: [{ id: 401 }, { questionId: 402 }] }).questionIds, ['401', '402']);
});

test('normalizes Fenbi wrong-question tree fields without losing counts or fallback ids', () => {
  const result = normalizeErrorCategories([{
    categoryId: 11,
    name: '资料分析',
    wrongCount: 3,
    questionIds: [301, 302, 303],
    childrenLabels: [{ keypointId: 12, name: '增长率', questionIds: [301, 302] }]
  }]);
  assert.deepEqual(result, [{
    id: 11,
    name: '资料分析',
    count: 3,
    questionIds: ['301', '302', '303'],
    children: [{ id: 12, name: '增长率', count: 2, questionIds: ['301', '302'], children: [] }]
  }]);
});

test('keeps id-less wrong-question nodes as non-actionable groups', () => {
  const result = normalizeErrorCategories([{
    name: '分组节点',
    childrenLabels: [{ categoryId: 99, name: '可练习节点', wrongCount: 1 }]
  }]);
  assert.equal(result[0].id, 0);
  assert.equal(result[0].children[0].id, 99);
  assert.equal(result[0].count, 1);
});

test('flattens wrong-question solutions grouped by question id and keeps requested order', () => {
  const result = normalizeErrorSolutions({
    data: {
      302: { globalId: 302, content: '第二题', solution: '解析二' },
      301: { globalId: 301, content: '第一题', solution: '解析一' }
    },
    materials: [{ content: '材料' }]
  }, ['301', '302']);
  assert.deepEqual(result.items.map((item) => item.globalId), [301, 302]);
  assert.equal(result.materials.length, 1);
});

test('normalizes paper labels exposed by Fenbi', () => {
  const result = normalizePaperLabels([{
    name: '安徽',
    labelMeta: { id: 34, paperCount: 120 }
  }]);
  assert.deepEqual(result, [{ id: 34, name: '安徽', paperCount: 120 }]);
});

test('normalizes downloadable papers with an optional existing exercise', () => {
  const result = normalizePapers({ list: [{ id: 7, name: '2025年安徽省考行测', exercise: { id: 88 } }] });
  assert.deepEqual(result, [{ id: 7, name: '2025年安徽省考行测', exerciseId: 88 }]);
});

