'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadWebview() {
  const listeners = {};
  const messages = [];
  const app = {
    addEventListener: (name, handler) => { listeners[name] = handler; },
    querySelectorAll: () => [],
    querySelector: () => null
  };
  const context = vm.createContext({
    acquireVsCodeApi: () => ({ postMessage: (message) => messages.push(message) }),
    document: {
      getElementById: (id) => id === 'app' ? app : null,
      addEventListener: () => {},
      documentElement: { style: { setProperty: () => {} } },
      body: { classList: { toggle: () => {} } }
    },
    window: { addEventListener: () => {}, getSelection: () => null }
  });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '../media/main.js'), 'utf8'), context);
  return { context, listeners, messages };
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
