'use strict';

const vscode = acquireVsCodeApi();
const app = document.getElementById('app');
const state = {
  authenticated: false,
  subjects: [],
  subjectId: 'xingce',
  subject: null,
  categories: [],
  history: [],
  cache: null,
  toolView: '',
  wrongCategories: [],
  paperLabels: [],
  papers: [],
  selectedLabelId: null,
  essayQuestions: [],
  essayQuestionPage: null,
  essayExamCategory: null,
  essayQuestionCategoryId: null,
  exercise: null,
  solutions: null,
  questionIndex: 0,
  answers: {},
  drafts: {},
  highlights: {},
  loading: '',
  error: '',
  compact: true,
  fontSize: 14
};

const ALLOWED_TAGS = new Set(['P', 'DIV', 'SPAN', 'BR', 'STRONG', 'B', 'EM', 'I', 'U', 'SUB', 'SUP', 'UL', 'OL', 'LI', 'TABLE', 'THEAD', 'TBODY', 'TR', 'TD', 'TH', 'IMG']);
const OPTION_LABELS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

function post(command, payload = {}) {
  vscode.postMessage({ command, ...payload });
}

function escapeText(value) {
  return String(value ?? '')
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function isFormulaImage(url, alt = '', className = '') {
  const target = String(url || '');
  return /\/formulas\?/i.test(target) ||
    /\/formula\//i.test(target) ||
    /latex/i.test(target) ||
    String(className || '').includes('formula') ||
    /公式|math/i.test(String(alt || ''));
}

function sanitizeHtml(input) {
  const parser = new DOMParser();
  const documentValue = parser.parseFromString(`<body>${String(input || '')}</body>`, 'text/html');
  for (const node of [...documentValue.body.querySelectorAll('*')]) {
    if (!ALLOWED_TAGS.has(node.tagName)) {
      node.replaceWith(...node.childNodes);
      continue;
    }
    if (node.tagName === 'IMG') {
      const rawSrc = node.getAttribute('src') ||
        node.getAttribute('data-src') ||
        node.getAttribute('data-original') ||
        node.getAttribute('data-url') ||
        node.getAttribute('_src') ||
        '';
      const normalizedImageSource = normalizeImageUrl(rawSrc);
      const alt = node.getAttribute('alt') || '';
      const title = node.getAttribute('title') || '';
      const isFormula = isFormulaImage(normalizedImageSource, alt, node.className);

      for (const attribute of [...node.attributes]) {
        node.removeAttribute(attribute.name);
      }

      if (normalizedImageSource) {
        node.setAttribute('src', normalizedImageSource);
      }
      if (alt) node.setAttribute('alt', alt);
      if (title) node.setAttribute('title', title);
      node.setAttribute('referrerpolicy', 'no-referrer');
      node.className = isFormula ? 'fenbi-formula-image' : 'fenbi-content-image';
      continue;
    }

    for (const attribute of [...node.attributes]) {
      const keepTableSpan = ['TD', 'TH'].includes(node.tagName) && ['colspan', 'rowspan'].includes(attribute.name);
      if (!keepTableSpan) {
        node.removeAttribute(attribute.name);
      }
    }
  }
  return documentValue.body.innerHTML;
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

function plainText(html) {
  const documentValue = new DOMParser().parseFromString(String(html || ''), 'text/html');
  return (documentValue.body.textContent || '').replace(/\s+/g, ' ').trim();
}

function questionHighlightKey(question) {
  const id = question?.globalId ?? question?.questionId ?? question?.id;
  return String(id == null || id === '' ? `index:${state.questionIndex}` : id);
}

function normalizeHighlightRanges(ranges) {
  const sorted = (Array.isArray(ranges) ? ranges : [])
    .map((range) => ({ start: Number(range?.start), end: Number(range?.end) }))
    .filter((range) => Number.isInteger(range.start) && Number.isInteger(range.end) && range.end > range.start)
    .sort((left, right) => left.start - right.start || left.end - right.end);
  return sorted.reduce((merged, range) => {
    const previous = merged[merged.length - 1];
    if (previous && range.start <= previous.end) {
      previous.end = Math.max(previous.end, range.end);
    } else {
      merged.push(range);
    }
    return merged;
  }, []);
}

function textOffsetFromRoot(root, container, offset) {
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  let total = 0;
  let node;

  if (container.nodeType === Node.TEXT_NODE) {
    while ((node = walker.nextNode())) {
      if (node === container) {
        return total + Math.min(Math.max(0, offset), node.nodeValue.length);
      }
      total += node.nodeValue.length;
    }
    return total;
  }

  const boundaryNode = offset < container.childNodes.length ? container.childNodes[offset] : null;
  while ((node = walker.nextNode())) {
    if (boundaryNode) {
      if (node === boundaryNode || (boundaryNode.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        break;
      }
    } else {
      if (!container.contains(node) && (container.compareDocumentPosition(node) & Node.DOCUMENT_POSITION_FOLLOWING)) {
        break;
      }
    }
    total += node.nodeValue.length;
  }
  return total;
}

function getSelectionRangeWithin(root) {
  const selection = window.getSelection();
  if (!root || !selection || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed || !root.contains(range.startContainer) || !root.contains(range.endContainer)) return null;
  try {
    const start = textOffsetFromRoot(root, range.startContainer, range.startOffset);
    const end = textOffsetFromRoot(root, range.endContainer, range.endOffset);
    return end > start ? { start, end } : null;
  } catch {
    return null;
  }
}

function getActiveHighlightTarget() {
  const selection = window.getSelection();
  if (!selection || selection.rangeCount !== 1) return null;
  const range = selection.getRangeAt(0);
  if (range.collapsed) return null;

  const questionRoot = app.querySelector('.question-content');
  if (questionRoot && questionRoot.contains(range.startContainer) && questionRoot.contains(range.endContainer)) {
    const textRange = getSelectionRangeWithin(questionRoot);
    if (textRange) {
      return { target: 'question', root: questionRoot, range: textRange };
    }
  }

  const materialRoot = app.querySelector('.material-content');
  if (materialRoot && materialRoot.contains(range.startContainer) && materialRoot.contains(range.endContainer)) {
    const textRange = getSelectionRangeWithin(materialRoot);
    if (textRange) {
      return { target: 'material', root: materialRoot, range: textRange };
    }
  }

  return null;
}

function selectedQuestionTextRange() {
  return getActiveHighlightTarget()?.range || null;
}

function materialHighlightKey(question) {
  const material = materialForQuestion(question);
  if (!material) return '';
  const identity = material.identity || questionHighlightKey(question) || `index:${state.questionIndex}`;
  return `material:${identity}`;
}

function highlightRangesFor(question) {
  return normalizeHighlightRanges(state.highlights[questionHighlightKey(question)]);
}

function materialHighlightRangesFor(question) {
  const key = materialHighlightKey(question);
  return key ? normalizeHighlightRanges(state.highlights[key]) : [];
}

function applyHighlights(root, ranges) {
  const normalized = normalizeHighlightRanges(ranges);
  if (!normalized.length) return;
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
  const textNodes = [];
  let textNode;
  while ((textNode = walker.nextNode())) textNodes.push(textNode);
  let nodeStart = 0;
  textNodes.forEach((node) => {
    const value = node.nodeValue || '';
    const nodeEnd = nodeStart + value.length;
    const overlaps = normalized.filter((range) => range.start < nodeEnd && range.end > nodeStart);
    if (overlaps.length) {
      const fragment = document.createDocumentFragment();
      let cursor = 0;
      overlaps.forEach((range) => {
        const start = Math.max(0, range.start - nodeStart);
        const end = Math.min(value.length, range.end - nodeStart);
        if (start > cursor) fragment.append(value.slice(cursor, start));
        const mark = document.createElement('mark');
        mark.className = 'question-highlight';
        mark.textContent = value.slice(start, end);
        fragment.append(mark);
        cursor = end;
      });
      if (cursor < value.length) fragment.append(value.slice(cursor));
      node.replaceWith(fragment);
    }
    nodeStart = nodeEnd;
  });
}

function restoreQuestionHighlights() {
  const question = currentQuestion();
  if (!question) return;
  const questionRoot = app.querySelector('.question-content');
  if (questionRoot) applyHighlights(questionRoot, highlightRangesFor(question));
  const materialRoot = app.querySelector('.material-content');
  if (materialRoot) applyHighlights(materialRoot, materialHighlightRangesFor(question));
}

function renderHighlightControls(question) {
  const hasQuestionHighlights = highlightRangesFor(question).length > 0;
  const hasMaterialHighlights = materialHighlightRangesFor(question).length > 0;
  const hasHighlights = hasQuestionHighlights || hasMaterialHighlights;
  return `<div class="question-highlight-controls" aria-label="标注操作">
    <button class="text-button question-highlight-clear" type="button" data-action="clear-highlights" ${hasHighlights ? '' : 'disabled'}>清除本题标注</button>
  </div>`;
}

function updateHighlightControls() {
  const menu = app.querySelector('#highlight-float-menu');
  const selection = window.getSelection();
  const activeTarget = getActiveHighlightTarget();
  if (!menu || !selection || !activeTarget) {
    if (menu) menu.hidden = true;
    return;
  }
  const rect = selection.getRangeAt(0).getBoundingClientRect();
  if (rect.width === 0 && rect.height === 0) {
    menu.hidden = true;
    return;
  }
  menu.hidden = false;
  const halfWidth = menu.offsetWidth / 2;
  const left = Math.min(Math.max(rect.left + rect.width / 2, halfWidth + 8), window.innerWidth - halfWidth - 8);
  menu.style.left = `${left}px`;
  menu.style.top = `${Math.max(8, rect.top - menu.offsetHeight - 8)}px`;
}

function imageMarkdown(html) {
  const documentValue = new DOMParser().parseFromString(String(html || ''), 'text/html');
  const urls = [...documentValue.images]
    .map((image) => normalizeImageUrl(
      image.getAttribute('src') ||
      image.getAttribute('data-src') ||
      image.getAttribute('data-original') ||
      image.getAttribute('data-url') ||
      image.getAttribute('_src') ||
      ''
    ))
    .filter((url) => /^https?:\/\//i.test(url));
  return [...new Set(urls)].map((url, index) => `![题图 ${index + 1}](${url})`);
}

function currentItems() {
  return state.solutions?.solutions || state.exercise?.questions || [];
}

function currentQuestion() {
  return currentItems()[state.questionIndex];
}

function remoteAnswer(index) {
  const question = currentItems()[index];
  const answerMap = state.exercise?.userAnswers || {};
  const answer = answerMap[String(question?.globalId || question?.id || '')]?.answer
    || answerMap[index]?.answer
    || question?.userAnswer;
  if (typeof answer === 'string' || typeof answer === 'number') return String(answer);
  if (!answer || typeof answer !== 'object') return '';
  const nested = answer.answer;
  if (typeof nested === 'string' || typeof nested === 'number') return String(nested);
  return answer.choice ?? nested?.choice ?? nested?.answer ?? '';
}

function getUserAnswer(index) {
  if (state.answers[index] !== undefined) return String(state.answers[index]);
  return String(remoteAnswer(index) ?? '');
}

function formatDate(timestamp) {
  const date = new Date(Number(timestamp));
  if (Number.isNaN(date.getTime())) return '时间未知';
  return new Intl.DateTimeFormat('zh-CN', { year: 'numeric', month: '2-digit', day: '2-digit' }).format(date);
}

function materialForQuestion(question, questions = currentItems()) {
  const materials = state.solutions?.materials || state.exercise?.materials || [];
  const indexes = Array.isArray(question?.materialIndexes) ? question.materialIndexes : [];
  const keys = [question?.materialId, ...(Array.isArray(question?.materialKeys) ? question.materialKeys : [])]
    .filter((value) => value != null && value !== '')
    .map(String);
  const indexedMaterials = indexes.map((index) => materials[index]).filter(Boolean);
  const keyedMaterials = materials.filter((item) => keys.includes(String(item?.globalId)));
  const linkedMaterials = indexedMaterials.length ? indexedMaterials : keyedMaterials;
  const content = question?.materialContent || linkedMaterials.map((item) => item.content || '').filter(Boolean).join('');
  if (!content) return null;

  const identity = keys[0]
    || (linkedMaterials[0]?.globalId == null ? '' : String(linkedMaterials[0].globalId))
    || (indexes.length ? `index:${indexes[0]}` : 'inline');
  const related = questions.filter((item) => {
    const itemIndexes = Array.isArray(item?.materialIndexes) ? item.materialIndexes : [];
    const itemKeys = [item?.materialId, ...(Array.isArray(item?.materialKeys) ? item.materialKeys : [])]
      .filter((value) => value != null && value !== '')
      .map(String);
    const itemIdentity = itemKeys[0]
      || (itemIndexes.length && materials[itemIndexes[0]]?.globalId != null ? String(materials[itemIndexes[0]].globalId) : '')
      || (itemIndexes.length ? `index:${itemIndexes[0]}` : '');
    return itemIdentity === identity;
  });
  const position = Math.max(0, related.indexOf(question));
  return { content, shared: related.length > 1, position, total: related.length, identity };
}

function renderMaterial(question, questions) {
  const material = materialForQuestion(question, questions);
  if (!material) return '';
  const summary = material.shared ? `共享材料 · 第 ${material.position + 1}/${material.total} 题` : '题目材料';
  return `<details class="material-card" open><summary>${summary}</summary><div class="rich-text material-content">${sanitizeHtml(material.content)}</div></details>`;
}

function optionItems(question) {
  const accessories = Array.isArray(question?.accessories) ? question.accessories : [];
  const options = accessories[0]?.options || question?.options;
  return Array.isArray(options) ? options : [];
}

function renderCategory(category, depth = 0, parentNames = []) {
  const children = Array.isArray(category.children) ? category.children : [];
  const typeName = [...parentNames, category.name].filter(Boolean).join(' / ');
  if (children.length === 0) {
    return `<li class="category-item category-level-${Math.min(depth, 3)}">
      <button class="category-row" data-action="start" data-id="${Number(category.id)}" data-question-type="${escapeText(typeName)}">
        <span class="category-name">${escapeText(category.name)}</span>
        <span class="category-meta">${Number(category.answerCount || 0)}/${Number(category.count || 0)} <i>›</i></span>
      </button>
    </li>`;
  }
  return `<li class="category-group category-level-${Math.min(depth, 3)}">
    <details ${depth === 0 ? 'open' : ''}>
      <summary><span class="category-name">${escapeText(category.name)}</span><small>${children.length} 项</small></summary>
      <ul>${children.map((item) => renderCategory(item, depth + 1, [...parentNames, category.name])).join('')}</ul>
    </details>
  </li>`;
}

function renderWrongCategory(category, depth = 0, parentNames = []) {
  const children = Array.isArray(category.children) ? category.children : [];
  const typeName = [...parentNames, category.name].filter(Boolean).join(' / ');
  if (!children.length) {
    return `<li class="category-item category-level-${Math.min(depth, 3)}"><button class="category-row" data-action="open-wrong-category" data-id="${Number(category.id)}" data-question-ids="${escapeText((category.questionIds || []).join(','))}" data-question-type="${escapeText(typeName)}" ${Number(category.id) > 0 && Number(category.count || 0) ? '' : 'disabled'}>
      <span class="category-name">${escapeText(category.name)}</span>
      <span class="category-meta">${Number(category.count || 0)} 题 <i>›</i></span>
    </button></li>`;
  }
  return `<li class="category-group category-level-${Math.min(depth, 3)}"><details ${depth === 0 ? 'open' : ''}>
    <summary><span class="category-name">${escapeText(category.name)}</span><small>${Number(category.count || 0)} 题</small></summary>
    <ul>${children.map((item) => renderWrongCategory(item, depth + 1, [...parentNames, category.name])).join('')}</ul>
  </details></li>`;
}

function renderWrongBook() {
  return `<header class="practice-header"><button class="text-button" data-action="home">‹ 目录</button><strong>我的错题</strong><span></span></header>
    <section class="section-card category-card">
      <div class="section-title"><h2>按题型复盘</h2><small>最近错题优先</small></div>
      ${state.wrongCategories.length
        ? `<ul class="category-list">${state.wrongCategories.map((item) => renderWrongCategory(item)).join('')}</ul>`
        : '<p class="muted compact-copy">当前科目没有可复盘的错题。</p>'}
    </section>`;
}

function renderPaperCatalog() {
  return `<header class="practice-header"><button class="text-button" data-action="home">‹ 目录</button><strong>往年真题</strong><span></span></header>
    <section class="section-card paper-filter">
      <div class="section-title"><h2>行测真题 PDF</h2><small>单份下载</small></div>
      <div class="paper-controls">
        <select id="paper-label-select" aria-label="选择真题地区">
          <option value="">选择地区或考试分类</option>
          ${state.paperLabels.map((item) => `<option value="${item.id}" ${Number(state.selectedLabelId) === Number(item.id) ? 'selected' : ''}>${escapeText(item.name)}（${item.paperCount}）</option>`).join('')}
        </select>
        <p class="muted">若粉笔尚未生成对应练习，下载前会再次确认创建练习记录。</p>
      </div>
      ${state.selectedLabelId && !state.papers.length ? '<p class="muted compact-copy">该分类暂无可下载试卷。</p>' : ''}
      <div class="paper-list">${state.papers.map((paper, index) => `<div class="paper-row">
        <span title="${escapeText(paper.name)}">${escapeText(paper.name)}</span>
        <button data-action="download-paper" data-index="${index}">下载</button>
      </div>`).join('')}</div>
    </section>`;
}

function renderHistory() {
  if (state.subject?.answerMode === 'interview') {
    return '<p class="muted compact-copy">面试题以分类浏览为主，不显示交卷历史。</p>';
  }
  if (!state.history.length) {
    return '<p class="muted compact-copy">最近没有练习记录。</p>';
  }
  return `<div class="history-list">${state.history.map((item, index) => {
    const completed = Number(item.status) === 1;
    const score = completed && item.questionCount != null
      ? `${item.correctCount ?? '—'}/${item.questionCount}`
      : '未完成';
    return `<button class="history-row" data-action="open-history" data-index="${index}">
      <span class="history-main">
        <strong>${escapeText(item.name)}</strong>
        <small>${formatDate(item.createTime)} · ${score}</small>
      </span>
      <span class="history-action">${completed ? '复盘' : '继续'} ›</span>
    </button>`;
  }).join('')}</div>`;
}

function renderHome() {
  if (!state.authenticated) {
    return `<section class="empty-card">
      <div class="empty-icon">◎</div>
      <h2>连接个人粉笔账号</h2>
      <p>Cookie 仅保存在 VS Code SecretStorage，不进入设置文件或题目页面。</p>
      <button class="primary" data-action="set-cookie">设置 Cookie</button>
    </section>`;
  }
  const isEssayBrowser = state.subject?.practiceMode === 'browser';
  return `<header class="app-header">
      <div class="identity"><strong>专注刷题</strong><small>${escapeText(state.user?.name || '已登录')}</small></div>
      <div class="icon-actions">
        <button title="刷新" aria-label="刷新" data-action="refresh">↻</button>
        <button title="账号设置" aria-label="账号设置" data-action="clear-cookie">⋯</button>
      </div>
    </header>
    <section class="subject-panel">
      <label for="subject-select">科目</label>
      <select id="subject-select" aria-label="选择科目">
        ${state.subjects.map((item) => `<option value="${escapeText(item.id)}" ${item.id === state.subjectId ? 'selected' : ''}>${escapeText(item.label)}</option>`).join('')}
      </select>
    </section>
    ${isEssayBrowser ? renderEssayQuestionSection() : renderObjectiveHomeContent()}`;
}

function renderObjectiveHomeContent() {
  return `${state.subject?.id === 'shenlun' ? `<section class="section-card">
      <div class="section-title"><h2>申论功能提示</h2><small>粉笔官网限制</small></div>
      <p class="muted compact-copy">主观题交卷及官方解析受粉笔官网会员和练习提交状态限制；未开通对应权限时，交卷与解析无法使用。</p>
    </section>` : ''}
    ${state.subject?.answerMode !== 'interview' ? `<section class="question-count-panel">
      <label for="question-count-select">每组题数</label>
      <select id="question-count-select" aria-label="设置每组题数">
        ${[5, 10, 15, 20, 25, 30, 40, 50].map((count) => `<option value="${count}" ${Number(state.questionCount) === count ? 'selected' : ''}>${count} 题</option>`).join('')}
      </select>
    </section>` : ''}
    <section class="quick-actions" aria-label="常用练习">
      <button data-action="open-wrong-book" ${state.subject?.answerMode === 'interview' ? 'disabled' : ''}><strong>我的错题</strong><small>按题型复盘</small></button>
      <button data-action="quick-exercise" ${state.subject?.answerMode === 'interview' ? 'disabled' : ''}><strong>快速练习</strong><small>直接开始</small></button>
      <button data-action="smart-exercise" ${state.subject?.answerMode === 'interview' ? 'disabled' : ''}><strong>智能组卷</strong><small>全部年份</small></button>
      <button data-action="open-papers"><strong>往年真题</strong><small>行测 PDF</small></button>
    </section>
    ${state.cache ? `<button class="resume-card" data-action="open-cache">
      <span><small>未完成练习</small><strong>继续上次进度</strong></span><i>›</i>
    </button>` : ''}
    <details class="section-card history-card">
      <summary><span>练习历史</span><small>最近 ${state.history.length} 条</small></summary>
      ${renderHistory()}
    </details>
    <section class="section-card category-card">
      <div class="section-title"><h2>专项练习</h2><small>${escapeText(state.subject?.label || '')}</small></div>
      <ul class="category-list">${state.categories.map((item) => renderCategory(item)).join('')}</ul>
    </section>`;
}

function renderEssayQuestionSection() {
  const page = state.essayQuestionPage || { current: 0, total: 0, totalPages: 0 };
  const category = state.essayExamCategory;
  const categories = state.categories || [];
  const selectedId = Number(state.essayQuestionCategoryId || categories[0]?.id || 1);
  const root = categories.find((item) => Number(item.id) === selectedId || (item.children || []).some((child) => Number(child.id) === selectedId)) || categories[0];
  const subcategories = root?.children || [];
  const items = state.essayQuestions || [];

  return `<section class="section-card category-card">
    <div class="section-title">
      <h2>综应题库${category?.name ? ` · ${escapeText(category.name)}` : ''}</h2>
      <small>共 ${page.total} 题</small>
    </div>
    ${categories.length ? `<div class="essay-filter" aria-label="综应题型">
      ${categories.map((item) => `<button class="${Number(item.id) === Number(root?.id) ? 'active' : ''}" data-action="essay-category" data-category-id="${item.id}">${escapeText(item.name)}</button>`).join('')}
    </div>` : ''}
    ${subcategories.length ? `<div class="essay-filter essay-subfilter" aria-label="综应细分题型">
      <button class="${selectedId === Number(root?.id) ? 'active' : ''}" data-action="essay-category" data-category-id="${root.id}">全部</button>
      ${subcategories.map((item) => `<button class="${selectedId === Number(item.id) ? 'active' : ''}" data-action="essay-category" data-category-id="${item.id}">${escapeText(item.name)}</button>`).join('')}
    </div>` : ''}
    <div class="history-list">${items.length ? items.map((item, index) => `<button class="history-row" data-action="open-essay-question" data-index="${index}">
      <span class="history-main"><strong>${escapeText(item.content || '未提供题干')}</strong><small>${escapeText(item.source || '来源未提供')}${item.completedCount ? ` · ${item.completedCount} 人完成` : ''}</small></span><span class="history-action">查看 ›</span>
    </button>`).join('') : '<p class="muted">当前分类暂无题目，或正在读取中…</p>'}</div>
    ${page.totalPages > 1 ? `<nav class="question-nav"><button data-action="essay-page" data-page="${page.current - 1}" ${page.current <= 0 ? 'disabled' : ''}>上一页</button><span>${page.current + 1} / ${Math.max(1, page.totalPages)}</span><button data-action="essay-page" data-page="${page.current + 1}" ${page.current + 1 >= page.totalPages ? 'disabled' : ''}>下一页</button></nav>` : ''}
  </section>`;
}

function renderEssayQuestionList() {
  return renderHome();
}

function renderObjectiveAnswer(question, selected) {
  const options = optionItems(question);
  return `<div class="options">
    ${options.map((option, index) => `<button class="option ${selected === String(index) ? 'selected' : ''}" data-action="answer" data-choice="${index}">
      <b>${OPTION_LABELS[index] || index + 1}</b><span class="rich-text">${sanitizeHtml(option)}</span>
    </button>`).join('')}
  </div>`;
}

function renderReviewOptions(question, selected, correctAnswer) {
  const options = optionItems(question);
  if (!options.length) return '';
  return `<div class="options review-options">
    ${options.map((option, index) => `<div class="option ${selected === String(index) ? 'selected' : ''} ${correctAnswer === String(index) ? 'correct-option' : ''}">
      <b>${OPTION_LABELS[index] || index + 1}</b><span class="rich-text">${sanitizeHtml(option)}</span>
    </div>`).join('')}
  </div>`;
}

function renderEssayAnswer() {
  const saved = getUserAnswer(state.questionIndex);
  const draft = state.drafts[state.questionIndex] ?? saved;
  const isZhyynl = state.subjectId === 'zhyynl' || state.exercise?.subjectId === 'zhyynl';
  const wordCount = String(draft || '').length;
  return `<div class="essay-answer">
    <div style="display:flex;justify-content:space-between;align-items:center;">
      <label for="essay-input">我的作答</label>
      <small class="muted">${wordCount} 字</small>
    </div>
    <textarea id="essay-input" rows="10" placeholder="${isZhyynl ? '在这里整理综应作答…' : '在这里整理申论作答…'}">${escapeText(draft)}</textarea>
    <button class="primary" data-action="save-essay" ${String(draft).trim() ? '' : 'disabled'}>保存本题作答</button>
  </div>`;
}

function renderQuestion() {
  const questions = state.exercise?.questions || [];
  const question = questions[state.questionIndex];
  if (!question) {
    return '<section class="empty-card"><p>没有可展示的题目。</p><button data-action="home">返回目录</button></section>';
  }
  const selected = getUserAnswer(state.questionIndex);
  const isEssay = state.exercise.answerMode === 'essay';
  const showSubmit = !state.exercise.readOnly && !isEssay && state.exercise.practiceKind !== 'essay-browser';
  return `<header class="practice-header">
      <button class="text-button" data-action="home">‹ 目录</button>
      <span><strong>${state.questionIndex + 1}</strong> / ${questions.length}</span>
      ${showSubmit ? '<button class="primary compact-button" data-action="submit">交卷</button>' : (state.exercise.readOnly ? '<small>只读查看</small>' : '<span></span>')}
    </header>
    ${renderMaterial(question, questions)}
    <article class="question-card">
      <div class="rich-text question-content">${sanitizeHtml(question.content)}</div>
      ${renderHighlightControls(question)}
      ${isEssay ? renderEssayAnswer() : (state.exercise.readOnly ? '' : renderObjectiveAnswer(question, selected))}
    </article>
    ${renderQuestionNav(questions.length)}`;
}

function solutionAnswer(solution) {
  return solution?.correctAnswer?.choice == null ? '' : String(solution.correctAnswer.choice);
}

function renderSolution() {
  const solutions = state.solutions?.solutions || [];
  const solution = solutions[state.questionIndex];
  if (!solution) {
    return '<section class="empty-card"><p>解析数据为空。</p><button data-action="home">返回目录</button></section>';
  }
  const userAnswer = getUserAnswer(state.questionIndex);
  const correctAnswer = solutionAnswer(solution);
  const isInterview = state.exercise?.answerMode === 'interview';
  const isEssay = state.exercise?.answerMode === 'essay';
  const isCorrect = !isEssay && !isInterview && userAnswer !== '' && userAnswer === correctAnswer;
  return `<header class="practice-header">
      <button class="text-button" data-action="home">‹ 目录</button>
      <span><strong>${state.questionIndex + 1}</strong> / ${solutions.length}</span>
      <span></span>
    </header>
    ${!isEssay && !isInterview ? `<section class="result-strip ${isCorrect ? 'correct' : 'wrong'}">
      <strong>${isCorrect ? '回答正确' : '需要复盘'}</strong>
      <span>我的答案 ${userAnswer === '' ? '—' : OPTION_LABELS[Number(userAnswer)] || userAnswer} · 正确答案 ${OPTION_LABELS[Number(correctAnswer)] || correctAnswer}</span>
    </section>` : ''}
    ${renderMaterial(solution, solutions)}
    <article class="question-card">
      <div class="rich-text question-content">${sanitizeHtml(solution.content)}</div>
      ${renderHighlightControls(solution)}
      ${!isEssay && !isInterview ? renderReviewOptions(solution, userAnswer, correctAnswer) : ''}
      ${isEssay && userAnswer ? `<section class="my-essay"><h3>我的作答</h3><p>${escapeText(userAnswer)}</p></section>` : ''}
      <section class="solution-block"><h3>${isInterview ? '参考思路' : '解析'}</h3><div class="rich-text">${sanitizeHtml(solution.solution)}</div></section>
      <button class="secondary full" data-action="copy-note">复制题干，稍后存飞书</button>
    </article>
    ${renderQuestionNav(solutions.length)}`;
}

function renderQuestionNav(total) {
  return `<nav class="question-nav">
    <button data-action="previous" ${state.questionIndex === 0 ? 'disabled' : ''}>上一题</button>
    <div class="progress-dots">${Array.from({ length: total }, (_, index) => `<button title="第 ${index + 1} 题" data-action="goto" data-index="${index}" class="dot ${getUserAnswer(index) !== '' ? 'answered' : ''} ${index === state.questionIndex ? 'current' : ''}">${index + 1}</button>`).join('')}</div>
    <button data-action="next" ${state.questionIndex >= total - 1 ? 'disabled' : ''}>下一题</button>
  </nav>`;
}

function enhanceRenderedImages() {
  const images = app.querySelectorAll('img');
  images.forEach((img) => {
    if (img.dataset.fenbiEnhanced === 'true') return;
    img.dataset.fenbiEnhanced = 'true';

    img.removeAttribute('width');
    img.removeAttribute('height');

    const rawSrc = img.getAttribute('src') || '';
    const normalized = normalizeImageUrl(rawSrc);
    if (normalized && normalized !== rawSrc) {
      img.setAttribute('src', normalized);
    }

    const isFormula = isFormulaImage(normalized, img.alt, img.className);
    if (isFormula) {
      img.classList.add('fenbi-formula-image');
    } else {
      img.classList.add('fenbi-content-image');
    }

    const handleError = () => {
      let errorBadge = img.nextElementSibling;
      if (!errorBadge || !errorBadge.classList.contains('fenbi-img-error-badge')) {
        errorBadge = document.createElement('span');
        errorBadge.className = 'fenbi-img-error-badge';
        errorBadge.innerHTML = `
          <span>⚠️ 图片加载失败</span>
          <span class="error-url" title="${escapeText(img.src)}">${escapeText(img.src)}</span>
        `;
        img.parentNode && img.parentNode.insertBefore(errorBadge, img.nextSibling);
      }
    };

    const handleLoad = () => {
      const errorBadge = img.nextElementSibling;
      if (errorBadge && errorBadge.classList.contains('fenbi-img-error-badge')) {
        errorBadge.remove();
      }
    };

    img.addEventListener('error', handleError);
    img.addEventListener('load', handleLoad);

    if (img.complete && img.naturalWidth === 0 && img.src) {
      handleError();
    }
  });
}

function render() {
  document.documentElement.style.setProperty('--question-font-size', `${Number(state.fontSize || 14)}px`);
  document.body.classList.toggle('compact', Boolean(state.compact));
  const content = state.solutions
    ? renderSolution()
    : state.exercise
      ? renderQuestion()
      : state.toolView === 'wrongBook'
        ? renderWrongBook()
        : state.toolView === 'papers'
          ? renderPaperCatalog()
        : state.toolView === 'essayQuestions'
          ? renderEssayQuestionList()
          : renderHome();
  const floatingHighlightMenu = state.exercise || state.solutions
    ? '<div id="highlight-float-menu" class="highlight-float-menu" role="toolbar" aria-label="选中文字操作" hidden><button class="primary compact-button" type="button" data-action="highlight-selection">高亮</button></div>'
    : '';
  app.innerHTML = `${state.loading ? `<div class="status-banner loading"><span></span>${escapeText(state.loading)}</div>` : ''}${state.error ? `<div class="status-banner error">${escapeText(state.error)}</div>` : ''}${content}${floatingHighlightMenu}`;
  document.body.classList.toggle('has-question-nav', Boolean(state.exercise || state.solutions));
  enhanceRenderedImages();
  restoreQuestionHighlights();
  updateHighlightControls();
}

function buildNote() {
  const solution = currentQuestion();
  if (!solution) return '';
  const questionType = questionTypeFor(solution);
  const material = materialForQuestion(solution);
  const options = optionItems(solution);
  const userAnswer = getUserAnswer(state.questionIndex);
  const correctAnswer = solutionAnswer(solution);
  const optionLines = options.map((option, index) => `${OPTION_LABELS[index] || index + 1}. ${plainText(option)}`);
  const images = [
    ...(material ? imageMarkdown(material.content) : []),
    ...imageMarkdown(solution.content),
    ...options.flatMap(imageMarkdown)
  ];
  return [
    `题目类型：${questionType}`,
    material ? `材料：${plainText(material.content)}` : '',
    `关键题干：${plainText(solution.content)}`,
    optionLines.length ? `选项：\n${optionLines.join('\n')}` : '',
    userAnswer ? `我的答案：${OPTION_LABELS[Number(userAnswer)] || userAnswer}` : '',
    correctAnswer ? `正确答案：${OPTION_LABELS[Number(correctAnswer)] || correctAnswer}` : '',
    ...[...new Set(images)]
  ].filter(Boolean).join('\n');
}

function questionTypeFor(question) {
  const rawType = [
    question?.questionTypeName,
    question?.categoryName,
    question?.keypointName,
    question?.category?.name,
    question?.keypoint?.name,
    state.exercise?.questionType
  ].find((value) => typeof value === 'string' && value.trim());
  return rawType ? rawType.trim() : '待分类';
}

app.addEventListener('change', (event) => {
  if (event.target.id === 'subject-select') {
    post('changeSubject', { subjectId: event.target.value });
  }
  if (event.target.id === 'question-count-select') {
    post('setQuestionCount', { questionCount: Number(event.target.value) });
  }
  if (event.target.id === 'paper-label-select' && event.target.value) {
    const label = state.paperLabels.find((item) => Number(item.id) === Number(event.target.value));
    post('loadPapers', { labelId: Number(event.target.value), paperCount: label?.paperCount || 50 });
  }
});

app.addEventListener('input', (event) => {
  if (event.target.id === 'essay-input') {
    state.drafts[state.questionIndex] = event.target.value;
    const saveButton = app.querySelector('button[data-action="save-essay"]');
    if (saveButton) saveButton.disabled = !event.target.value.trim();
    const countBadge = app.querySelector('.essay-answer small');
    if (countBadge) countBadge.textContent = `${event.target.value.length} 字`;
  }
});

document.addEventListener('selectionchange', updateHighlightControls);
window.addEventListener('scroll', updateHighlightControls, true);

app.addEventListener('mousedown', (event) => {
  if (event.target.closest('button[data-action="highlight-selection"]')) event.preventDefault();
});

app.addEventListener('click', (event) => {
  const button = event.target.closest('button[data-action]');
  if (!button) return;
  const action = button.dataset.action;
  state.error = '';
  if (action === 'set-cookie') post('setCookie');
  if (action === 'clear-cookie') post('clearCookie');
  if (action === 'refresh') post('refresh', { subjectId: state.subjectId });
  if (action === 'open-wrong-book') post('openWrongBook', { subjectId: state.subjectId });
  if (action === 'open-wrong-category') post('openWrongCategory', {
    subjectId: state.subjectId,
    categoryId: Number(button.dataset.id),
    questionIds: String(button.dataset.questionIds || '').split(',').filter(Boolean),
    questionType: String(button.dataset.questionType || '')
  });
  if (action === 'quick-exercise') post('startQuickExercise', { subjectId: state.subjectId });
  if (action === 'smart-exercise') post('startSmartExercise', { subjectId: state.subjectId });
  if (action === 'open-papers') post('openPaperCatalog');
  if (action === 'open-essay-question-list') post('openEssayQuestionList', { page: 0 });
  if (action === 'essay-page') post('openEssayQuestionList', { page: Number(button.dataset.page || 0), categoryId: state.essayQuestionCategoryId });
  if (action === 'essay-category') post('openEssayQuestionList', { page: 0, categoryId: Number(button.dataset.categoryId || 0) });
  if (action === 'open-essay-question') {
    const item = state.essayQuestions[Number(button.dataset.index)];
    if (item) post('openEssayQuestion', { exerciseKey: item.exerciseKey, sheetId: item.sheetId });
  }
  if (action === 'download-paper') {
    const paper = state.papers[Number(button.dataset.index)];
    if (paper) post('downloadPaper', { paper });
  }
  if (action === 'start') post('startExercise', {
    subjectId: state.subjectId,
    keypointId: Number(button.dataset.id),
    questionType: String(button.dataset.questionType || '')
  });
  if (action === 'open-cache' && state.cache?.key) {
    post('openHistory', { subjectId: state.subjectId, item: { key: state.cache.key, id: state.cache.id, status: state.cache.status } });
  }
  if (action === 'open-history') {
    const item = state.history[Number(button.dataset.index)];
    if (item) post('openHistory', { subjectId: state.subjectId, item });
  }
  if (action === 'home') {
    const fromEssayBrowser = state.exercise?.practiceKind === 'essay-browser';
    state.exercise = null;
    state.solutions = null;
    state.answers = {};
    state.drafts = {};
    state.highlights = {};
    state.questionIndex = 0;
    if (fromEssayBrowser && Array.isArray(state.essayQuestions) && state.essayQuestions.length) {
      state.toolView = 'essayQuestions';
    } else {
      state.toolView = '';
    }
    render();
  }
  if (action === 'answer') {
    const answer = String(button.dataset.choice);
    state.answers[state.questionIndex] = answer;
    post('answer', { questionIndex: state.questionIndex, answer });
    render();
  }
  if (action === 'save-essay') {
    const answer = String(state.drafts[state.questionIndex] || '').trim();
    if (answer) {
      state.answers[state.questionIndex] = answer;
      post('answer', { questionIndex: state.questionIndex, answer });
      render();
    }
  }
  if (action === 'highlight-selection') {
    const activeTarget = getActiveHighlightTarget();
    const question = currentQuestion();
    if (activeTarget && question) {
      const key = activeTarget.target === 'material'
        ? materialHighlightKey(question)
        : questionHighlightKey(question);
      if (key) {
        state.highlights[key] = normalizeHighlightRanges([...(state.highlights[key] || []), activeTarget.range]);
        window.getSelection()?.removeAllRanges();
        render();
      }
    }
  }
  if (action === 'clear-highlights') {
    const question = currentQuestion();
    if (question) {
      delete state.highlights[questionHighlightKey(question)];
      const matKey = materialHighlightKey(question);
      if (matKey) delete state.highlights[matKey];
      window.getSelection()?.removeAllRanges();
      render();
    }
  }
  if (action === 'submit') post('submit');
  if (action === 'previous') {
    state.questionIndex = Math.max(0, state.questionIndex - 1);
    render();
  }
  if (action === 'next') {
    state.questionIndex = Math.min(currentItems().length - 1, state.questionIndex + 1);
    render();
  }
  if (action === 'goto') {
    state.questionIndex = Number(button.dataset.index || 0);
    render();
  }
  if (action === 'copy-note') post('copyNote', { text: buildNote() });
});

window.addEventListener('message', (event) => {
  const message = event.data || {};
  if (message.command === 'loading') {
    state.loading = String(message.data?.message || '处理中…');
    state.error = '';
  }
  if (message.command === 'error') {
    state.loading = '';
    state.error = String(message.data?.message || '操作失败');
  }
  if (message.command === 'state') {
    Object.assign(state, message.data || {});
    state.loading = '';
    state.error = '';
    state.exercise = null;
    state.solutions = null;
    state.toolView = '';
    state.answers = {};
    state.drafts = {};
    state.highlights = {};
  }
  if (message.command === 'exercise') {
    state.exercise = message.data;
    state.solutions = null;
    state.answers = {};
    state.drafts = {};
    state.highlights = {};
    state.questionIndex = 0;
    state.toolView = '';
    state.loading = '';
  }
  if (message.command === 'answerSaved') {
    state.loading = '';
  }
  if (message.command === 'solution') {
    const keepHighlights = Boolean(
      state.exercise?.combineKey &&
      message.data?.combineKey &&
      state.exercise.combineKey === message.data.combineKey
    );
    if (!keepHighlights) state.highlights = {};
    state.exercise = message.data;
    state.solutions = { solutions: message.data.solutions || [] };
    state.questionIndex = 0;
    state.toolView = '';
    state.loading = '';
  }
  if (message.command === 'questionCount') {
    state.questionCount = Number(message.data?.questionCount || 0);
    state.loading = '';
  }
  if (message.command === 'wrongBook') {
    state.toolView = 'wrongBook';
    state.wrongCategories = message.data?.categories || [];
    state.exercise = null;
    state.solutions = null;
    state.loading = '';
  }
  if (message.command === 'paperCatalog') {
    state.toolView = 'papers';
    if (Array.isArray(message.data?.labels)) state.paperLabels = message.data.labels;
    if (Array.isArray(message.data?.papers)) state.papers = message.data.papers;
    if (Object.prototype.hasOwnProperty.call(message.data || {}, 'selectedLabelId')) {
      state.selectedLabelId = message.data.selectedLabelId;
    }
    state.exercise = null;
    state.solutions = null;
    state.loading = '';
  }
  if (message.command === 'essayQuestionList') {
    state.toolView = 'essayQuestions';
    state.essayQuestions = message.data?.items || [];
    state.essayQuestionPage = message.data?.page || null;
    state.essayExamCategory = message.data?.examCategory || null;
    state.essayQuestionCategoryId = Number(message.data?.categoryId || 0) || null;
    state.exercise = null;
    state.solutions = null;
    state.loading = '';
  }
  if (message.command === 'paperDownloaded') state.loading = '';
  render();
});

render();
post('ready');
