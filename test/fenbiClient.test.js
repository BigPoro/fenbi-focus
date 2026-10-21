'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FenbiClient, assertAuthorizedUrl, encodeForm, shouldAttachCookie, summarizeApiFailure } = require('../src/fenbiClient');

test('solution document joins site statistics by globalId instead of response order', async () => {
  const requests = [];
  const client = new FenbiClient(async () => 'cookie');
  client.request = async (method, url) => {
    requests.push(url);
    if (url.includes('/exercise/getSolution')) return { data: {
      staticUrl: { urls: ['https://tiku.fenbi.com/combine/static/solution'] },
      switchVO: { requestKey: 'stats+key' }, userAnswers: {}
    } };
    if (url.includes('/question/getMeta')) return { data: { 302: { correctRatio: 52.4, mostWrongAnswer: { choice: '0' } }, 301: { correctRatio: 0 } } };
    return { solutions: [{ globalId: 301 }, { globalId: 302 }, { globalId: 303 }] };
  };
  const result = await client.solutionDocument('xingce', 'exercise-key');
  assert.match(requests[2], /\/combine\/question\/getMeta\?requestKey=stats%2Bkey&routecs=xingce&/);
  assert.equal(result.items[0].questionStatistics.correctRatio, 0);
  assert.equal(result.items[1].questionStatistics.correctRatio, 52.4);
  assert.equal(result.items[1].questionStatistics.mostWrongAnswer.choice, '0');
  assert.equal(result.items[2].questionStatistics, null);
});

test('statistics failure or missing request key keeps the solution available without inventing a rate', async () => {
  const client = new FenbiClient(async () => 'cookie');
  client.request = async () => { throw new Error('统计接口不可用'); };
  const items = [{ globalId: 301, solution: '解析内容' }];
  const failed = await client.solutionStatistics('xingce', items, 'stats-key');
  assert.equal(failed[0].statisticsStatus, 'failed');
  assert.equal(failed[0].solution, '解析内容');
  assert.equal(failed[0].questionStatistics, undefined);
  const missing = await client.solutionStatistics('xingce', items);
  assert.equal(missing[0].statisticsStatus, 'unavailable');
});

test('wrong-question solutions also load site statistics using the official request key', async () => {
  const requests = [];
  const client = new FenbiClient(async () => 'cookie');
  client.request = async (method, url) => {
    requests.push(url);
    if (url.includes('/questionIds?')) return [301];
    if (url.includes('/universal/auth/solutions?')) return { solutions: [{ globalId: 301, solution: '错题解析' }] };
    if (url.includes('/question/auth/getSolution?')) return { data: { switchVO: { requestKey: 'error-key' } } };
    return { data: { 301: { correctRatio: 65 } } };
  };
  const result = await client.errorSolutions('xingce', 10);
  assert.match(requests[2], /\/combine\/question\/auth\/getSolution\?questionIds=301&routecs=xingce&type=1&format=html&/);
  assert.match(requests[3], /requestKey=error-key&routecs=xingce&/);
  assert.equal(result.items[0].questionStatistics.correctRatio, 65);
});

test('allows only explicit authenticated Fenbi hosts', () => {
  assert.equal(assertAuthorizedUrl('https://tiku.fenbi.com/api/x').hostname, 'tiku.fenbi.com');
  assert.equal(assertAuthorizedUrl('https://login.fenbi.com/api/x').hostname, 'login.fenbi.com');
  assert.throws(() => assertAuthorizedUrl('https://example.com/api/x'), /拒绝访问/);
  assert.throws(() => assertAuthorizedUrl('http://tiku.fenbi.com/api/x'), /拒绝访问/);
  assert.throws(() => assertAuthorizedUrl('https://tiku.fenbi.com.evil.test/api/x'), /拒绝访问/);
});

test('permits returned Fenbi static resources without leaking the cookie', () => {
  const url = assertAuthorizedUrl('https://example.fbstatic.cn/question.json');
  assert.equal(url.hostname, 'example.fbstatic.cn');
  assert.equal(shouldAttachCookie(url), false);
  assert.equal(shouldAttachCookie(new URL('https://tiku.fenbi.com/api/x')), true);
  assert.equal(shouldAttachCookie(new URL('https://urlimg.fenbi.com/api/pdf/tiku/xingce/exercise/1')), true);
});

test('encodes form values deterministically', () => {
  assert.equal(encodeForm({ type: 3, keypointId: 12 }), 'type=3&keypointId=12');
});

test('summarizes API failures without exposing credential-like values', () => {
  assert.equal(summarizeApiFailure({ code: 412, msg: '会话校验失败' }), 'code=412；会话校验失败');
  assert.equal(summarizeApiFailure({ message: 'token=abc123' }), 'token=[已隐藏]');
});

test('restores zhyynl course context before reading the essay question list', async () => {
  const requests = [];
  const client = new FenbiClient(async () => 'cookie');
  client.request = async (method, url) => {
    requests.push({ method, url });
    if (url.includes('courseSetChange')) return {};
    if (url.includes('userexamcategory/getCurrent')) {
      return { data: { examCategoryId: 1000011, name: '联考A类' } };
    }
    return { list: [{ id: 31, content: '题目' }], pageInfo: { totalItem: 1, totalPage: 1 } };
  };

  const result = await client.essayQuestionList(59, 0);

  assert.match(requests[0].url, /courseSetChange\?courseSetPrefix=zhyynl/);
  assert.match(requests[1].url, /userexamcategory\/getCurrent/);
  assert.match(requests[2].url, /question-list\?questionType=59&toPage=0/);
  assert.equal(result.items[0].sheetId, 31);
});

test('reports safe request context when essay list has no list', async () => {
  const client = new FenbiClient(async () => 'cookie');
  client.request = async (method, url, options) => {
    if (url.includes('courseSetChange')) return {};
    if (url.includes('userexamcategory/getCurrent')) {
      return { data: { examCategoryId: 1000011, name: '联考A类' } };
    }
    Object.assign(options.responseMetadata, { statusCode: 200, contentType: 'application/json', byteLength: 4 });
    return null;
  };

  await assert.rejects(client.essayQuestionList(5, 0), /questionType=5，examcatid=1000011，page=0；HTTP 200，application\/json，4 字节；响应类型=null/);
});

test('restores zhyynl course context before creating a single-question exercise', async () => {
  const requests = [];
  const client = new FenbiClient(async () => 'cookie');
  client.request = async (method, url, options) => {
    requests.push({ method, url, options });
    if (url.includes('courseSetChange')) return {};
    return { key: 'essay-key' };
  };

  const key = await client.createEssayQuestionExercise(31);

  assert.match(requests[0].url, /courseSetChange\?courseSetPrefix=zhyynl/);
  assert.match(requests[1].url, /\/api\/zhyynl\/exercises\?/);
  assert.deepEqual(requests[1].options.form, { type: 26, sheetId: 31 });
  assert.equal(key, 'essay-key');
});

