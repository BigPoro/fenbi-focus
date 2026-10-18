'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const { FenbiClient, assertAuthorizedUrl, encodeForm, shouldAttachCookie, summarizeApiFailure } = require('../src/fenbiClient');

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

