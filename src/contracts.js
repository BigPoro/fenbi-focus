'use strict';

class ContractError extends Error {
  constructor(message, details) {
    super(message);
    this.name = 'ContractError';
    this.details = details;
  }
}

function unwrapData(value) {
  if (value && typeof value === 'object' && Object.prototype.hasOwnProperty.call(value, 'data')) {
    return value.data;
  }
  return value;
}

function requireObject(value, label) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new ContractError(`${label} 返回结构异常`, { receivedType: typeof value });
  }
  return value;
}

function requireArray(value, label) {
  if (!Array.isArray(value)) {
    throw new ContractError(`${label} 返回结构异常：预期数组`, { receivedType: typeof value });
  }
  return value;
}

function normalizeCategories(payload) {
  const data = unwrapData(payload);
  return requireArray(data, '题型目录').map(normalizeCategory);
}

function normalizeCategory(item) {
  const source = requireObject(item, '题型目录项');
  const id = Number(source.id);
  if (!Number.isFinite(id)) {
    throw new ContractError('题型目录项缺少有效 id');
  }
  return {
    id,
    name: String(source.name || `题型 ${id}`),
    count: Number(source.count || 0),
    answerCount: Number(source.answerCount || 0),
    children: Array.isArray(source.children) ? source.children.map(normalizeCategory) : []
  };
}

function normalizeExercise(payload) {
  const data = requireObject(unwrapData(payload), '练习记录');
  return {
    id: Number(data.id || data.exerciseId || 0),
    userAnswers: data.userAnswers && typeof data.userAnswers === 'object' ? data.userAnswers : {},
    correctCount: Number(data.correctCount || 0),
    questionCount: Number(data.questionCount || 0),
    keypointIds: Array.isArray(data.keypointIds) ? data.keypointIds.map(Number) : []
  };
}

function normalizeQuestionSet(payload, mode = 'questions') {
  const data = requireObject(unwrapData(payload), mode === 'solutions' ? '题目解析' : '题目');
  const key = mode === 'solutions' ? 'solutions' : 'questions';
  return {
    items: requireArray(data[key], mode === 'solutions' ? '题目解析' : '题目'),
    materials: Array.isArray(data.materials) ? data.materials : []
  };
}

function normalizeUserInfo(payload) {
  const data = requireObject(unwrapData(payload), '出题设置');
  return {
    questionCount: Number(data.questionCount || 5),
    sheetType: Number(data.sheetType || 0),
    yearScope: Number(data.yearScope || 0),
    correctRatioLow: Number(data.correctRatioLow || 0),
    correctRatioHigh: Number(data.correctRatioHigh || 100)
  };
}

function normalizeCreatedExercise(payload) {
  const data = requireObject(unwrapData(payload), '创建练习');
  const id = Number(data.id || data.exerciseId || 0);
  if (!Number.isFinite(id) || id <= 0) {
    throw new ContractError('创建练习成功但没有返回有效练习 ID');
  }
  return id;
}

function normalizeCreatedExerciseKey(payload) {
  const data = requireObject(unwrapData(payload), '创建练习');
  const key = String(data.key || data.combineKey || '').trim();
  if (!key) {
    throw new ContractError('创建练习成功但没有返回有效练习 key');
  }
  return key;
}

function normalizeUnfinishedExercise(payload) {
  const data = unwrapData(payload);
  if (!data || typeof data !== 'object' || Array.isArray(data)) {
    return null;
  }
  const key = String(data.key || data.combineKey || '').trim();
  if (!key) {
    return null;
  }
  return {
    key,
    id: Number(data.id || data.exerciseId || data.ancientExerciseId?.id || 0),
    keypointIds: Array.isArray(data.keypointIds) ? data.keypointIds.map(Number) : [],
    status: Number(data.status || 0)
  };
}

function normalizeHistory(payload) {
  const source = requireObject(payload, '练习历史');
  return requireArray(source.datas, '练习历史').map((item) => {
    const data = requireObject(item, '练习历史项');
    const sheet = data.sheet && typeof data.sheet === 'object' ? data.sheet : {};
    const rawCreateTime = Number(data.createTime || data.createdTime || 0);
    return {
      id: Number(data.id || 0),
      key: String(data.key || ''),
      status: Number(data.status || 0),
      createTime: rawCreateTime > 0 && rawCreateTime < 1e12 ? rawCreateTime * 1000 : rawCreateTime,
      questionCount: data.questionCount == null ? null : Number(data.questionCount),
      correctCount: data.correctCount == null ? null : Number(data.correctCount),
      name: String(sheet.name || data.name || '练习'),
      sheetType: Number(sheet.type || 0)
    };
  });
}

function collectQuestionIds(value) {
  if (Array.isArray(value)) {
    return value.flatMap(collectQuestionIds);
  }
  if (typeof value === 'number') return [String(value)];
  if (typeof value === 'string') return value.split(',').map((id) => id.trim()).filter(Boolean);
  if (!value || typeof value !== 'object') return [];
  return ['questionIds', 'ids', 'globalIds', 'questionId', 'question_id', 'globalId', 'global_id', 'id', 'records', 'rows', 'items', 'list', 'result', 'values', 'questions', 'data', 'datas']
    .flatMap((key) => Object.prototype.hasOwnProperty.call(value, key) ? collectQuestionIds(value[key]) : []);
}

function findQuestionTotal(value) {
  if (!value || typeof value !== 'object') return undefined;
  for (const key of ['total', 'totalCount', 'count']) {
    if (typeof value[key] === 'number') return Number(value[key]);
  }
  for (const key of ['data', 'datas', 'pagination', 'page']) {
    const total = findQuestionTotal(value[key]);
    if (total !== undefined) return total;
  }
  return undefined;
}

function normalizeErrorQuestionIds(payload) {
  const questionIds = [...new Set(collectQuestionIds(payload))];
  return { questionIds, total: findQuestionTotal(payload) ?? questionIds.length };
}

function directQuestionIds(value) {
  const ids = Array.isArray(value?.questionIds) ? value.questionIds : [];
  return [...new Set(ids.map((id) => String(id || '').trim()).filter(Boolean))];
}

function treeQuestionIds(value) {
  if (!value || typeof value !== 'object') return [];
  const children = Array.isArray(value.childrenLabels)
    ? value.childrenLabels
    : Array.isArray(value.children) ? value.children : [];
  return [...new Set(directQuestionIds(value).concat(children.flatMap(treeQuestionIds)))];
}

function normalizeErrorCategory(item) {
  const source = requireObject(item, '错题目录项');
  const rawId = Number(source.categoryId || source.keypointId || source.id || 0);
  const id = Number.isFinite(rawId) && rawId > 0 ? rawId : 0;
  const childrenSource = Array.isArray(source.childrenLabels)
    ? source.childrenLabels
    : Array.isArray(source.children) ? source.children : [];
  const questionIds = directQuestionIds(source);
  const descendantIds = treeQuestionIds(source);
  const children = childrenSource.map(normalizeErrorCategory);
  return {
    id,
    name: String(source.name || `题型 ${id}`),
    count: Number(source.wrongCount || source.count || questionIds.length || descendantIds.length || children.reduce((sum, child) => sum + child.count, 0)),
    questionIds,
    children
  };
}

function normalizeErrorCategories(payload) {
  return requireArray(unwrapData(payload), '错题目录').map(normalizeErrorCategory);
}

function flattenResponseItems(value) {
  if (!value) return [];
  if (Array.isArray(value)) return value.flatMap(flattenResponseItems);
  if (typeof value !== 'object') return [];
  const containerKeys = ['data', 'datas', 'questions', 'questionList', 'items', 'list', 'solutions', 'children'];
  const nested = containerKeys.flatMap((key) => Object.prototype.hasOwnProperty.call(value, key) ? flattenResponseItems(value[key]) : []);
  if (nested.length) return nested;
  if (['globalId', 'questionId', 'content', 'solution', 'stem', 'answer', 'analysis', 'parse'].some((key) => Object.prototype.hasOwnProperty.call(value, key))) {
    return [value];
  }
  return Object.values(value).flatMap(flattenResponseItems);
}

function normalizeErrorSolutions(payload, questionIds = []) {
  const items = flattenResponseItems(payload);
  const order = new Map(questionIds.map((id, index) => [String(id), index]));
  const sortedItems = items.slice().sort((left, right) => {
    const leftId = String(left?.globalId || left?.questionId || left?.id || '');
    const rightId = String(right?.globalId || right?.questionId || right?.id || '');
    return (order.get(leftId) ?? Number.MAX_SAFE_INTEGER) - (order.get(rightId) ?? Number.MAX_SAFE_INTEGER);
  });
  const data = payload && typeof payload === 'object' && payload.data && typeof payload.data === 'object' ? payload.data : {};
  const materials = Array.isArray(payload?.materials) ? payload.materials : Array.isArray(data.materials) ? data.materials : [];
  const userAnswers = data.userAnswers && typeof data.userAnswers === 'object'
    ? data.userAnswers
    : payload?.userAnswers && typeof payload.userAnswers === 'object' ? payload.userAnswers : {};
  const enrichedItems = sortedItems.map((item) => {
    const id = String(item?.globalId || item?.questionId || item?.id || '');
    const userAnswer = item.userAnswer || userAnswers[id]?.answer || userAnswers[id] || null;
    const indexes = Array.isArray(item.materialIndexes) ? item.materialIndexes : [];
    const material = indexes.length && typeof indexes[0] === 'number' ? materials[indexes[0]] : null;
    if (material) {
      const materialId = material.globalId == null ? null : String(material.globalId);
      return {
        ...item,
        ...(userAnswer ? { userAnswer } : {}),
        materialId,
        materialKeys: materialId ? [materialId] : (item.materialKeys || []),
        materialContent: item.materialContent || material.content || null
      };
    }
    return userAnswer ? { ...item, userAnswer } : item;
  });
  return { items: enrichedItems, materials };
}

function normalizePaperLabels(payload) {
  return requireArray(unwrapData(payload), '真题分类').map((item) => {
    const source = requireObject(item, '真题分类项');
    const meta = requireObject(source.labelMeta, '真题分类信息');
    const id = Number(meta.id);
    if (!Number.isInteger(id) || id <= 0) throw new ContractError('真题分类缺少有效 id');
    return {
      id,
      name: String(source.name || `分类 ${id}`),
      paperCount: Math.max(0, Number(meta.paperCount || 0))
    };
  });
}

function normalizePapers(payload) {
  const source = requireObject(unwrapData(payload), '真题列表');
  return requireArray(source.list, '真题列表').map((item) => {
    const paper = requireObject(item, '真题项');
    const id = Number(paper.id);
    if (!Number.isInteger(id) || id <= 0) throw new ContractError('真题项缺少有效 id');
    return {
      id,
      name: String(paper.name || `试卷 ${id}`),
      exerciseId: Number(paper.exercise?.id || 0)
    };
  });
}

function extractStaticUrl(payload, label = '练习') {
  const source = requireObject(payload, label);
  const url = source.data?.staticUrl?.urls?.[0];
  if (typeof url !== 'string' || !url.startsWith('https://')) {
    throw new ContractError(`${label}没有返回有效题目地址`);
  }
  return url;
}

function questionCardNodes(card) {
  const roots = Array.isArray(card) ? card : Array.isArray(card?.children) ? card.children : [];
  return roots.flatMap((chapter) => Array.isArray(chapter?.children) ? chapter.children : []);
}

function attachMaterialContent(items, card, materials) {
  const contentById = new Map(materials.map((material) => [String(material?.globalId), material?.content || null]));
  const cardNodes = questionCardNodes(card);
  const usedMaterialIds = new Set();
  return items.map((item, index) => {
    const node = cardNodes[index];
    const materialKeys = Array.isArray(node?.materialKeys) ? node.materialKeys : [];
    const materialId = materialKeys.length ? String(materialKeys[0]) : '';
    const isFirstEncounter = materialId && !usedMaterialIds.has(materialId);
    if (materialId) usedMaterialIds.add(materialId);
    return {
      ...item,
      materialId: materialId || null,
      materialKeys: materialKeys.length ? materialKeys : (item.materialKeys || []),
      materialContent: isFirstEncounter ? (contentById.get(materialId) || null) : null
    };
  });
}

function normalizeCombinedQuestionSet(payload, mode = 'questions') {
  const data = requireObject(unwrapData(payload), mode === 'solutions' ? '题目解析' : '题目');
  const key = mode === 'solutions' ? 'solutions' : 'questions';
  const items = requireArray(data[key], mode === 'solutions' ? '题目解析' : '题目');
  const materials = Array.isArray(data.materials) ? data.materials : [];
  return {
    items: attachMaterialContent(items, data.card, materials),
    materials,
    card: data.card || null,
    correctCount: data.correctCount == null ? null : Number(data.correctCount),
    questionCount: data.questionCount == null ? null : Number(data.questionCount)
  };
}

function normalizeCurrentUser(payload) {
  const data = requireObject(unwrapData(payload), '当前用户');
  return {
    id: data.id == null ? '' : String(data.id),
    name: String(data.name || data.nickName || data.nickname || '已登录用户')
  };
}

function isFormulaImage(url, alt = '', className = '') {
  const target = String(url || '');
  return /\/formulas\?/i.test(target) ||
    /\/formula\//i.test(target) ||
    /latex/i.test(target) ||
    String(className || '').includes('formula') ||
    /公式|math/i.test(String(alt || ''));
}

function normalizeImageUrl(value) {
  if (!value) return '';
  let url = String(value).trim();
  if (!url) return '';
  if (url.startsWith('https:////')) {
    return 'https://' + url.slice(10);
  }
  if (url.startsWith('http:////')) {
    return 'https://' + url.slice(9);
  }
  if (url.startsWith('//')) {
    return 'https:' + url;
  }
  if (url.startsWith('http://') && !url.includes('localhost')) {
    return 'https://' + url.slice(7);
  }
  if (/^https?:\/\//i.test(url)) {
    return url;
  }
  if (/^data:image\/(?:png|jpe?g|gif|webp|svg\+xml);base64,/i.test(url) || url.startsWith('blob:')) {
    return url;
  }
  return url;
}

module.exports = {
  ContractError,
  isFormulaImage,
  normalizeImageUrl,
  normalizeCategories,
  normalizeCombinedQuestionSet,
  normalizeCreatedExercise,
  normalizeCreatedExerciseKey,
  normalizeCurrentUser,
  normalizeExercise,
  normalizeErrorCategories,
  normalizeErrorQuestionIds,
  normalizeErrorSolutions,
  normalizeHistory,
  normalizePaperLabels,
  normalizePapers,
  normalizeQuestionSet,
  normalizeUnfinishedExercise,
  normalizeUserInfo,
  extractStaticUrl,
  unwrapData
};


