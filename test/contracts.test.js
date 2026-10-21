'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const {
  ContractError,
  normalizeCategories,
  normalizeCurrentExamCategory,
  normalizeCombinedQuestionSet,
  normalizeCurrentUser,
  normalizeExercise,
  normalizeErrorCategories,
  normalizeErrorQuestionIds,
  normalizeErrorSolutions,
  normalizeEssayQuestionList,
  normalizeHistory,
  normalizePaperLabels,
  normalizePapers,
  normalizeQuestionSet,
  normalizeQuestionStatistics
} = require('../src/contracts');

test('validates percentage statistics without converting missing values to zero', () => {
  assert.deepEqual(normalizeQuestionStatistics({ data: { 301: { correctRatio: 0 }, 302: {}, 303: { correctRatio: 52.4 } } }), {
    301: { correctRatio: 0, mostWrongAnswer: null },
    302: { correctRatio: null, mostWrongAnswer: null },
    303: { correctRatio: 52.4, mostWrongAnswer: null }
  });
  for (const ratio of [-1, 101, NaN, Infinity, '', '52', false]) {
    assert.throws(() => normalizeQuestionStatistics({ data: { 301: { correctRatio: ratio } } }), ContractError);
  }
  assert.throws(() => normalizeQuestionStatistics({ data: [] }), ContractError);
});

test('keeps the site mostWrongAnswer choice including the first option', () => {
  const result = normalizeQuestionStatistics({ data: {
    301: { correctRatio: 52, mostWrongAnswer: { choice: '0' } },
    302: { mostWrongAnswer: { choice: '1,3' } }
  } });
  assert.equal(result[301].mostWrongAnswer.choice, '0');
  assert.equal(result[302].mostWrongAnswer.choice, '1,3');
});

test('normalizes nested categories', () => {
  const result = normalizeCategories({ data: [{ id: 1, name: '判断推理', children: [{ id: 2, name: '图形推理' }] }] });
  assert.equal(result[0].children[0].name, '图形推理');
});

test('normalizes the zhyynl category envelope and type ids used by the web list', () => {
  const result = normalizeCategories({ data: { baseKeypointVOS: [{ type: 26, name: '实务处理题', children: [{ type: 261, name: '谈话沟通类' }] }] } });
  assert.deepEqual(result, [{ id: 26, name: '实务处理题', count: 0, answerCount: 0, children: [{ id: 261, name: '谈话沟通类', count: 0, answerCount: 0, children: [] }] }]);
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

test('normalizes the selected exam category for the essay question list', () => {
  assert.deepEqual(normalizeCurrentExamCategory({ data: {
    examCategoryId: 1000011,
    name: '联考A类',
    path: ['事考', '笔试', '海南', '联考A类']
  } }), { id: 1000011, name: '联考A类', path: ['事考', '笔试', '海南', '联考A类'] });
});

test('normalizes browseable essay questions with their existing exercise keys', () => {
  assert.deepEqual(normalizeEssayQuestionList({
    list: [{
      questionId: 18757890,
      exerciseKey: '1_11e_2j4mqpj',
      content: '请归纳概括。',
      source: '江苏事业单位统考第1题',
      sheetMeta: { exerciseCount: 4497 },
      status: 0
    }],
    pageInfo: { currentPage: 0, totalItem: 315, totalPage: 21 }
  }), {
    items: [{ questionId: 18757890, exerciseKey: '1_11e_2j4mqpj', sheetId: 0, content: '请归纳概括。', source: '江苏事业单位统考第1题', completedCount: 4497, status: 0 }],
    page: { current: 0, total: 315, totalPages: 21 }
  });
});

test('skips non-question cards and accepts nested essay exercise keys', () => {
  const result = normalizeEssayQuestionList({
    list: [
      { content: '活动卡片' },
      { id: 8, question: { content: '请作答。' }, exercise: { key: '1_nested_key' } }
    ],
    pageInfo: { currentPage: 0, totalItem: 2, totalPage: 1 }
  });
  assert.deepEqual(result.items, [{ questionId: 8, exerciseKey: '1_nested_key', sheetId: 8, content: '请作答。', source: '', completedCount: 0, status: 0 }]);
});

test('keeps a list item without an exercise key when it can be opened by sheetId', () => {
  const result = normalizeEssayQuestionList({ list: [{ id: 99, questionId: 7, content: '单一题' }], pageInfo: {} });
  assert.deepEqual(result.items, [{ questionId: 7, exerciseKey: '', sheetId: 99, content: '单一题', source: '', completedCount: 0, status: 0 }]);
});

test('accepts a nested list envelope returned by some zhyynl category combinations', () => {
  const result = normalizeEssayQuestionList({ data: { list: [{ id: 21, content: '题目' }], pageInfo: { totalItem: 1 } } });
  assert.equal(result.items[0].sheetId, 21);
  assert.equal(result.page.total, 1);
});

test('accepts essay items returned directly in data while preserving outer page info', () => {
  const result = normalizeEssayQuestionList({
    data: [{ id: 31, questionId: 301, content: '数组题目' }],
    pageInfo: { currentPage: 2, totalItem: 37, totalPage: 3 }
  });
  assert.equal(result.items[0].sheetId, 31);
  assert.deepEqual(result.page, { current: 2, total: 37, totalPages: 3 });
});

test('accepts a direct essay item array', () => {
  const result = normalizeEssayQuestionList([{ id: 41, content: '直接数组题目' }]);
  assert.equal(result.items[0].sheetId, 41);
  assert.deepEqual(result.page, { current: 0, total: 0, totalPages: 0 });
});

test('preserves the service code and message when an essay category has no list payload', () => {
  assert.throws(
    () => normalizeEssayQuestionList({ code: 1, msg: '当前分类暂无题目', data: null }),
    /code=1：当前分类暂无题目/
  );
});

test('keeps every server setting needed when changing question count', () => {
  const { normalizeUserInfo } = require('../src/contracts');
  assert.deepEqual(normalizeUserInfo({ data: {
    questionCount: 15,
    sheetType: 2,
    yearScope: 5,
    correctRatioLow: 30,
    correctRatioHigh: 80
  } }), {
    questionCount: 15,
    sheetType: 2,
    yearScope: 5,
    correctRatioLow: 30,
    correctRatioHigh: 80
  });
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

test('associates an error question material index with a stable material identity', () => {
  const result = normalizeErrorSolutions({
    data: { 301: { globalId: 301, content: '第一小题', materialIndexes: [0] } },
    materials: [{ globalId: 901, content: '共享资料' }]
  }, ['301']);
  assert.deepEqual(result.items[0], {
    globalId: 301,
    content: '第一小题',
    materialIndexes: [0],
    materialId: '901',
    materialKeys: ['901'],
    materialContent: '共享资料'
  });
});

test('keeps the historical answer returned alongside an error solution', () => {
  const result = normalizeErrorSolutions({
    data: {
      userAnswers: { 301: { answer: { type: 201, choice: '2' } } },
      solutions: [{ globalId: 301, content: '第一题', solution: '解析' }]
    }
  }, ['301']);
  assert.deepEqual(result.items[0].userAnswer, { type: 201, choice: '2' });
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

test('normalizes and merges overlapping highlight ranges', () => {
  const { normalizeHighlightRanges } = require('../src/contracts');
  assert.deepEqual(normalizeHighlightRanges([
    { start: 10, end: 20 },
    { start: 5, end: 12 },
    { start: 30, end: 40 },
    { start: 20, end: 25 },
    { start: 'bad', end: 99 },
    { start: 50, end: 50 }
  ]), [
    { start: 5, end: 25 },
    { start: 30, end: 40 }
  ]);
});


