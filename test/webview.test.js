'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadWebview() {
  const listeners = {};
  const windowListeners = {};
  const messages = [];
  const timers = new Map();
  let nextTimerId = 1;
  let now = 100000;
  const timerElement = { textContent: '' };
  const app = {
    addEventListener: (name, handler) => { listeners[name] = handler; },
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const context = vm.createContext({
    Date: class extends Date { static now() { return now; } },
    setInterval: (callback) => {
      const id = nextTimerId++;
      timers.set(id, callback);
      return id;
    },
    clearInterval: (id) => timers.delete(id),
    acquireVsCodeApi: () => ({ postMessage: (message) => messages.push(message) }),
    document: {
      getElementById: (id) => id === 'app' ? app : id === 'practice-timer' && app.innerHTML?.includes('id="practice-timer"') ? timerElement : null,
      addEventListener: () => {},
      documentElement: { style: { setProperty: () => {} } },
      body: { classList: { toggle: () => {} } }
    },
    window: {
      addEventListener: (name, handler) => { windowListeners[name] = handler; },
      getSelection: () => null,
      scrollTo: () => {}
    }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../media/main.js'), 'utf8'), context);
  return {
    context, listeners, windowListeners, messages, app, timers, timerElement,
    advance: (milliseconds) => {
      now += milliseconds;
      for (const callback of [...timers.values()]) callback();
    }
  };
}

const category = {
  id: 10, name: '言语理解与表达', answerCount: 37, count: 6940,
  children: [{
    id: 11, name: '逻辑填空', answerCount: 14, count: 3023,
    children: [{ id: 12, name: '实词填空', answerCount: 2, count: 100, children: [] }]
  }]
};

test('each category group starts with an all entry using its own ID and counts', () => {
  const { context } = loadWebview();
  context.category = category;
  const html = vm.runInContext('renderCategory(category)', context);
  assert.equal((html.match(/>全部<\/span>/g) || []).length, 2);
  assert.match(html, /<ul><li[^>]*>\s*<button[^>]*data-id="10" data-question-type="言语理解与表达">\s*<span[^>]*>全部<\/span>\s*<span[^>]*>37\/6940/);
  assert.match(html, /<ul><li[^>]*>\s*<button[^>]*data-id="11" data-question-type="言语理解与表达 \/ 逻辑填空">\s*<span[^>]*>全部<\/span>\s*<span[^>]*>14\/3023/);
  assert.match(html, /data-id="12" data-question-type="言语理解与表达 \/ 逻辑填空 \/ 实词填空"/);
  assert.doesNotMatch(vm.runInContext('renderCategory(category.children[0].children[0])', context), />全部<\/span>/);
});

test('all entry starts practice with the parent category and keeps the subject and type path', () => {
  const { listeners, messages } = loadWebview();
  listeners.click({ target: { closest: () => ({ dataset: {
    action: 'start', id: '10', questionType: '言语理解与表达'
  } }) } });
  assert.deepEqual(JSON.parse(JSON.stringify(messages.at(-1))), {
    command: 'startExercise', subjectId: 'xingce', keypointId: 10, questionType: '言语理解与表达'
  });
});

test('solution statistics show the site percentage including zero and explicit missing/failure states', () => {
  const { context } = loadWebview();
  for (const [ratio, label] of [[52.4, '52%'], [0, '0%'], [100, '100%'], [0.5, '1%'], [null, '暂无数据']]) {
    context.solution = { questionStatistics: { correctRatio: ratio } };
    const html = vm.runInContext('renderSolutionStatistics(solution)', context);
    assert.match(html, new RegExp(`全站正确率：${label}`));
  }
  context.solution = { statisticsStatus: 'failed' };
  assert.match(vm.runInContext('renderSolutionStatistics(solution)', context), /全站正确率：获取失败/);
});

test('solution statistics show returned wrong choices as letters without dropping option A', () => {
  const { context } = loadWebview();
  for (const [choice, label] of [['0', 'A'], [0, 'A'], ['3', 'D'], ['0,2', 'A、C'], ['<script>', '数据异常'], ['26', '数据异常']]) {
    context.solution = { questionStatistics: { correctRatio: 52, mostWrongAnswer: { choice } } };
    assert.match(vm.runInContext('renderSolutionStatistics(solution)', context), new RegExp(`全站正确率：52% · 易错选项：${label}`));
  }
  for (const mostWrongAnswer of [null, {}, { choice: '' }]) {
    context.solution = { questionStatistics: { correctRatio: 52, mostWrongAnswer } };
    assert.doesNotMatch(vm.runInContext('renderSolutionStatistics(solution)', context), /易错选项/);
  }
});

test('practice timer keeps total time across question navigation without rerendering every second', () => {
  const { context, windowListeners, listeners, app, timers, timerElement, advance } = loadWebview();
  // These fixtures contain plain text; the timer test does not exercise rich-text parsing.
  vm.runInContext('sanitizeHtml = (value) => String(value || "")', context);
  windowListeners.message({ data: { command: 'exercise', data: {
    startedAt: 100000, answerMode: 'objective', questions: [{ content: '第一题' }, { content: '第二题' }]
  } } });
  assert.match(app.innerHTML, /id="practice-timer"/);
  assert.equal(timerElement.textContent, '用时 00:00');
  assert.equal(timers.size, 1);
  const html = app.innerHTML;
  advance(65000);
  assert.equal(timerElement.textContent, '用时 01:05');
  assert.equal(app.innerHTML, html);
  listeners.click({ target: { closest: () => ({ dataset: { action: 'next' } }) } });
  assert.equal(timerElement.textContent, '用时 01:05');
  assert.equal(timers.size, 1);
  advance(3600000);
  assert.equal(timerElement.textContent, '用时 01:01:05');
  listeners.click({ target: { closest: () => ({ dataset: { action: 'home' } }) } });
  assert.doesNotMatch(app.innerHTML, /id="practice-timer"/);
  assert.equal(timers.size, 0);
});

test('practice timer disappears for solutions and restarts for a new exercise', () => {
  const { context, windowListeners, app, timers, timerElement, advance } = loadWebview();
  vm.runInContext('sanitizeHtml = (value) => String(value || "")', context);
  const exercise = { startedAt: 100000, answerMode: 'objective', questions: [{ content: '题目' }] };
  windowListeners.message({ data: { command: 'exercise', data: exercise } });
  advance(10000);
  windowListeners.message({ data: { command: 'solution', data: {
    ...exercise, readOnly: true, solutions: [{ content: '题目', solution: '解析' }]
  } } });
  assert.doesNotMatch(app.innerHTML, /id="practice-timer"/);
  assert.equal(timers.size, 0);
  windowListeners.message({ data: { command: 'exercise', data: { ...exercise, startedAt: 110000 } } });
  assert.equal(timerElement.textContent, '用时 00:00');
  assert.equal(timers.size, 1);
  windowListeners.message({ data: { command: 'exercise', data: { ...exercise, readOnly: true } } });
  assert.doesNotMatch(app.innerHTML, /id="practice-timer"/);
  assert.equal(timers.size, 0);
});

test('solution answer card distinguishes correct, wrong, unanswered and unknown results', () => {
  const { context } = loadWebview();
  context.solutions = [
    { globalId: 1, correctAnswer: { choice: '0' } },
    { globalId: 2, correctAnswer: { choice: '1' } },
    { globalId: 3, correctAnswer: { choice: '2' } },
    { globalId: 4 }
  ];
  vm.runInContext(`
    state.exercise = { answerMode: 'objective', userAnswers: {
      1: { answer: { choice: '0' } }, 2: { answer: { choice: '0' } }, 4: { answer: { choice: '0' } }
    } };
    state.solutions = { solutions };
  `, context);
  const html = vm.runInContext('renderQuestionNav(4)', context);
  assert.match(html, /第 1 题 · 回答正确[^>]*aria-current="step"[^>]*class="dot correct current"/);
  assert.match(html, /第 2 题 · 回答错误[^>]*class="dot wrong /);
  assert.match(html, /第 3 题 · 未作答[^>]*class="dot unanswered /);
  assert.match(html, /第 4 题 · 已作答[^>]*class="dot answered /);
  vm.runInContext('state.questionIndex = 1', context);
  assert.match(vm.runInContext('renderQuestionNav(4)', context), /class="dot wrong current"/);
});

test('answer card keeps progress-only states during practice and for subjective solutions', () => {
  const { context } = loadWebview();
  vm.runInContext(`
    state.exercise = { answerMode: 'objective', questions: [{ correctAnswer: { choice: '1' } }, {}] };
    state.answers = { 0: '0' };
  `, context);
  const practice = vm.runInContext('renderQuestionNav(2)', context);
  assert.match(practice, /class="dot answered current"/);
  assert.doesNotMatch(practice, /dot (correct|wrong) /);
  for (const mode of ['essay', 'interview']) {
    context.mode = mode;
    vm.runInContext('state.exercise.answerMode = mode; state.solutions = { solutions: state.exercise.questions }', context);
    assert.doesNotMatch(vm.runInContext('renderQuestionNav(2)', context), /dot (correct|wrong) /);
  }
});
