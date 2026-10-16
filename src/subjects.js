'use strict';

const SUBJECTS = Object.freeze([
  { id: 'xingce', label: '行测', answerMode: 'objective', apiCategory: 'xingce', courseSetPrefix: 'xingce', categoryKind: 'keypoint', historyCategoryId: 4 },
  { id: 'shenlun', label: '申论', answerMode: 'essay', apiCategory: 'shenlun', courseSetPrefix: 'shenlun', categoryKind: 'pdpg', historyCategoryId: 4 },
  { id: 'gwyms', label: '公务员面试', answerMode: 'interview', apiCategory: 'gwyms', courseSetPrefix: 'gwyms', categoryKind: 'giant', historyCategoryId: 4 },
  { id: 'syzc', label: '事业编笔试', answerMode: 'objective', apiCategory: 'syzc', courseSetPrefix: 'sydw', categoryKind: 'keypoint', historyCategoryId: 4 },
  { id: 'zhyynl', label: '事业单位综应', answerMode: 'essay', apiCategory: 'sydw', courseSetPrefix: 'zhyynl', categoryKind: 'etRuleQuestion', historyCategoryId: 4 },
  { id: 'sydwms', label: '事业单位面试', answerMode: 'interview', apiCategory: 'sydwms', courseSetPrefix: 'sydwms', categoryKind: 'giant', historyCategoryId: 4 }
]);

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

module.exports = { SUBJECTS, getSubject, listSubjects };
