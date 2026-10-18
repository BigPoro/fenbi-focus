'use strict';

const SUBJECTS = Object.freeze([
  { id: 'xingce', label: '行测', answerMode: 'objective', apiCategory: 'xingce', courseSetPrefix: 'xingce', categoryKind: 'keypoint', historyCategoryId: 4 },
  { id: 'shenlun', label: '申论', answerMode: 'essay', apiCategory: 'shenlun', courseSetPrefix: 'shenlun', categoryKind: 'pdpg', historyCategoryId: 4 },
  { id: 'gwyms', label: '公务员面试', answerMode: 'interview', apiCategory: 'gwyms', courseSetPrefix: 'gwyms', categoryKind: 'giant', historyCategoryId: 4 },
  { id: 'syzc', label: '事业编笔试', answerMode: 'objective', apiCategory: 'syzc', courseSetPrefix: 'sydw', categoryKind: 'keypoint', historyCategoryId: 4 },
  // 网页端综应按已存在的题目列表浏览；其旧的“按知识点组卷”接口会在部分分类稳定返回 412。
  { id: 'zhyynl', label: '事业单位综应', answerMode: 'essay', apiCategory: 'sydw', courseSetPrefix: 'zhyynl', categoryKind: 'etRuleQuestion', historyCategoryId: 4, practiceMode: 'browser' },
  { id: 'sydwms', label: '事业单位面试', answerMode: 'interview', apiCategory: 'sydwms', courseSetPrefix: 'sydwms', categoryKind: 'giant', historyCategoryId: 4 }
]);

// 综应网页的 etRuleQuestion/question-list 使用题型 ID，不使用 /categories 的知识点 ID。
// 以下 ID 由网页端题型切换后的 URL 与成功的列表请求核对。
const ESSAY_QUESTION_CATEGORIES = Object.freeze([
  { id: 1, name: '案例分析题', children: [
    { id: 59, name: '单一题', children: [] },
    { id: 5, name: '综合题', children: [] }
  ] },
  { id: 108, name: '实务处理题', children: [
    { id: 109, name: '谈话沟通类', children: [] },
    { id: 110, name: '应急应变类', children: [] },
    { id: 111, name: '活动组织类', children: [] }
  ] },
  { id: 112, name: '公文写作题', children: [
    { id: 113, name: '总结类', children: [] },
    { id: 114, name: '发言类', children: [] },
    { id: 115, name: '宣传类', children: [] },
    { id: 118, name: '其他', children: [] },
    { id: 233, name: '权威类', children: [] },
    { id: 234, name: '启事类', children: [] },
    { id: 235, name: '材料类', children: [] },
    { id: 236, name: '文章类', children: [] },
    { id: 237, name: '方案类', children: [] }
  ] }
]);

function listEssayQuestionCategories() {
  return ESSAY_QUESTION_CATEGORIES.map((category) => ({
    ...category,
    children: category.children.map((child) => ({ ...child }))
  }));
}

function listSubjects() {
  return SUBJECTS.map((subject) => ({ ...subject }));
}

function getSubject(subjectId) {
  const subject = SUBJECTS.find(({ id }) => id === subjectId);
  if (!subject) {
    throw new Error(`不支持的科目：${String(subjectId || '')}`);
  }
  return subject;
}

module.exports = { SUBJECTS, getSubject, listSubjects, listEssayQuestionCategories };
