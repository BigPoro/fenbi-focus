'use strict';

const https = require('node:https');
const {
  extractStaticUrl,
  normalizeCategories,
  normalizeCombinedQuestionSet,
  normalizeCreatedExercise,
  normalizeCreatedExerciseKey,
  normalizeCurrentUser,
  normalizeErrorCategories,
  normalizeErrorQuestionIds,
  normalizeErrorSolutions,
  normalizeExercise,
  normalizeHistory,
  normalizePaperLabels,
  normalizePapers,
  normalizeQuestionSet,
  normalizeUnfinishedExercise,
  normalizeUserInfo,
  unwrapData
} = require('./contracts');
const { getSubject } = require('./subjects');

const API_QUERY = 'app=web&kav=100&av=100&hav=100&version=3.0.0.0';
const CURRENT_API_QUERY = 'app=web&kav=125&av=127&hav=125&version=3.0.0.0';
const AUTHORIZED_HOSTS = new Set(['tiku.fenbi.com', 'login.fenbi.com', 'urlimg.fenbi.com']);
const STATIC_HOST_SUFFIXES = ['.fbstatic.cn', '.fenbi.com'];
const MAX_RESPONSE_BYTES = 12 * 1024 * 1024;

class FenbiHttpError extends Error {
  constructor(message, statusCode, responseBody) {
    super(message);
    this.name = 'FenbiHttpError';
    this.statusCode = statusCode;
    this.responseBody = responseBody;
  }
}

function assertAuthorizedUrl(input) {
  const url = input instanceof URL ? input : new URL(input);
  const isStaticHost = STATIC_HOST_SUFFIXES.some((suffix) => url.hostname.endsWith(suffix));
  if (url.protocol !== 'https:' || (!AUTHORIZED_HOSTS.has(url.hostname) && !isStaticHost)) {
    throw new Error(`拒绝访问未授权的粉笔接口主机：${url.hostname || 'unknown'}`);
  }
  return url;
}

function shouldAttachCookie(url) {
  return AUTHORIZED_HOSTS.has(url.hostname);
}

function withQuery(input, values) {
  const url = new URL(input);
  for (const [key, value] of Object.entries(values)) {
    url.searchParams.set(key, String(value));
  }
  return url.toString();
}

function responseItems(payload, label) {
  const value = unwrapData(payload);
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === 'object') {
    for (const key of ['solutions', 'questions', 'datas', 'items']) {
      if (Array.isArray(value[key])) {
        return value[key];
      }
    }
  }
  throw new Error(`${label}返回结构异常`);
}

function encodeForm(values) {
  const form = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value !== undefined && value !== null) {
      form.set(key, String(value));
    }
  }
  return form.toString();
}

class FenbiClient {
  constructor(cookieProvider) {
    this.cookieProvider = cookieProvider;
  }

  async request(method, input, options = {}) {
    const url = assertAuthorizedUrl(input);
    const cookie = String(await this.cookieProvider() || '').trim();
    if (!cookie) {
      throw new Error('尚未设置粉笔 Cookie');
    }

    let body = '';
    const headers = {
      Accept: 'application/json, text/plain, */*',
      'User-Agent': 'FenbiFocus/0.1 VSCode'
    };
    if (shouldAttachCookie(url)) {
      headers.Cookie = cookie;
    }

    if (options.form) {
      body = encodeForm(options.form);
      headers['Content-Type'] = 'application/x-www-form-urlencoded;charset=UTF-8';
    } else if (options.json !== undefined) {
      body = JSON.stringify(options.json);
      headers['Content-Type'] = 'application/json;charset=UTF-8';
    }
    if (body) {
      headers['Content-Length'] = Buffer.byteLength(body);
    }

    return new Promise((resolve, reject) => {
      const request = https.request({
        protocol: 'https:',
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method,
        headers,
        timeout: 15000
      }, (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > MAX_RESPONSE_BYTES) {
            request.destroy(new Error('粉笔接口响应超过安全大小限制'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let parsed;
          try {
            parsed = text ? JSON.parse(text) : null;
          } catch {
            reject(new FenbiHttpError('粉笔接口返回了无法解析的数据', response.statusCode || 0));
            return;
          }
          const statusCode = response.statusCode || 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new FenbiHttpError(`粉笔接口请求失败：HTTP ${statusCode}`, statusCode, parsed));
            return;
          }
          resolve(parsed);
        });
      });
      request.on('timeout', () => request.destroy(new Error('粉笔接口请求超时')));
      request.on('error', reject);
      if (body) {
        request.write(body);
      }
      request.end();
    });
  }

  async requestBuffer(input) {
    const url = assertAuthorizedUrl(input);
    const cookie = String(await this.cookieProvider() || '').trim();
    if (!cookie) throw new Error('尚未设置粉笔 Cookie');
    return new Promise((resolve, reject) => {
      const request = https.request({
        protocol: 'https:',
        hostname: url.hostname,
        port: 443,
        path: `${url.pathname}${url.search}`,
        method: 'GET',
        headers: {
          Accept: 'application/pdf,*/*',
          Cookie: cookie,
          'User-Agent': 'FenbiFocus/0.3 VSCode'
        },
        timeout: 30000
      }, (response) => {
        const chunks = [];
        let size = 0;
        response.on('data', (chunk) => {
          size += chunk.length;
          if (size > 80 * 1024 * 1024) {
            request.destroy(new Error('真题 PDF 超过 80 MB 安全限制'));
            return;
          }
          chunks.push(chunk);
        });
        response.on('end', () => {
          const body = Buffer.concat(chunks);
          const statusCode = response.statusCode || 0;
          if (statusCode < 200 || statusCode >= 300) {
            reject(new FenbiHttpError(`真题下载失败：HTTP ${statusCode}`, statusCode));
            return;
          }
          if (body.subarray(0, 4).toString('ascii') !== '%PDF') {
            reject(new FenbiHttpError('粉笔没有返回有效的 PDF 文件', statusCode));
            return;
          }
          resolve(body);
        });
      });
      request.on('timeout', () => request.destroy(new Error('真题下载超时')));
      request.on('error', reject);
      request.end();
    });
  }

  async currentUser() {
    const payload = await this.request('GET', `https://login.fenbi.com/api/users/current?${API_QUERY}`);
    return normalizeCurrentUser(payload);
  }

  async categories() {
    const payload = await this.request('GET', `https://tiku.fenbi.com/api/xingce/categories?filter=keypoint&${API_QUERY}`);
    return normalizeCategories(payload);
  }

  async subjectCategories(subjectId) {
    const subject = getSubject(subjectId);
    let path = `/api/${subject.id}/categories?filter=keypoint&${API_QUERY}`;
    if (subject.categoryKind === 'pdpg') {
      path = `/api/shenlun/pdpg/categories?${API_QUERY}`;
    } else if (subject.categoryKind === 'etRuleQuestion') {
      path = `/api/zhyynl/etRuleQuestion/categories?${API_QUERY}`;
    } else if (subject.categoryKind === 'giant') {
      path = `/api/${subject.id}/categories?filter=giant&${API_QUERY}`;
    }
    const payload = await this.request('GET', `https://tiku.fenbi.com${path}`);
    return normalizeCategories(payload);
  }

  async subjectUnfinishedExercise(subjectId) {
    const subject = getSubject(subjectId);
    const payload = await this.request('GET', `https://tiku.fenbi.com/api/${subject.apiCategory}/category-exercises-unfinished?noCacheTag=${Date.now()}&${API_QUERY}`);
    return normalizeUnfinishedExercise(payload);
  }

  async history(subjectId, count = 15) {
    const subject = getSubject(subjectId);
    const safeCount = Math.max(1, Math.min(50, Number(count) || 15));
    const payload = await this.request('GET', `https://tiku.fenbi.com/api/${subject.apiCategory}/category-exercises?categoryId=${subject.historyCategoryId}&cursor=0&count=${safeCount}&noCacheTag=${Date.now()}&${API_QUERY}`);
    return normalizeHistory(payload);
  }

  async changeSubject(subjectId) {
    const subject = getSubject(subjectId);
    await this.request('PUT', `https://tiku.fenbi.com/activity/userquiz/courseSetChange?courseSetPrefix=${subject.courseSetPrefix}&${API_QUERY}`, { json: {} });
  }

  async createSubjectExercise(subjectId, keypointId) {
    const subject = getSubject(subjectId);
    if (subject.answerMode === 'interview') {
      throw new Error('面试题不使用交卷练习模式');
    }
    const settings = await this.userQuestionInfo();
    const payload = await this.request('POST', `https://tiku.fenbi.com/api/${subject.id}/exercises?${API_QUERY}`, {
      form: {
        type: 3,
        exerciseTimeMode: 2,
        keypointId,
        limit: subject.answerMode === 'essay' ? 1 : settings.questionCount,
        yearScope: settings.yearScope,
        correctRatioLow: settings.correctRatioLow,
        correctRatioHigh: settings.correctRatioHigh
      }
    });
    return normalizeCreatedExerciseKey(payload);
  }

  async createQuickExercise(subjectId) {
    const subject = getSubject(subjectId);
    if (subject.answerMode === 'interview') throw new Error('面试科目暂不支持快速练习');
    const payload = await this.request('POST', `https://tiku.fenbi.com/api/${subject.id}/exercises?${API_QUERY}`, {
      form: { type: 3, exerciseTimeMode: 2 }
    });
    return normalizeCreatedExerciseKey(payload);
  }

  async createSmartExercise(subjectId, yearScope = 0) {
    const subject = getSubject(subjectId);
    if (subject.answerMode === 'interview') throw new Error('面试科目暂不支持智能组卷');
    const normalizedYearScope = [0, 5, 10].includes(Number(yearScope)) ? Number(yearScope) : 0;
    await this.request('POST', `https://tiku.fenbi.com/activity/userquiz/updateUserTemplateInfo?yearScope=${normalizedYearScope}&${CURRENT_API_QUERY}`, { json: {} });
    const payload = await this.request('POST', `https://tiku.fenbi.com/api/${subject.id}/exercises?${CURRENT_API_QUERY}`, {
      form: { type: 2, exerciseTimeMode: 2, yearScope: normalizedYearScope }
    });
    return normalizeCreatedExerciseKey(payload);
  }

  async errorKeypointTree(subjectId) {
    const subject = getSubject(subjectId);
    if (subject.answerMode === 'interview') throw new Error('面试科目没有错题本');
    const payload = await this.request('GET', `https://tiku.fenbi.com/api/${subject.id}/errors/keypoint-tree?timeRange=0&order=desc&${CURRENT_API_QUERY}`);
    return normalizeErrorCategories(payload);
  }

  async errorSolutions(subjectId, categoryId, limit = 15, fallbackQuestionIds = []) {
    const subject = getSubject(subjectId);
    const safeLimit = Math.max(1, Math.min(50, Number(limit) || 15));
    const idPayload = await this.request('GET', `https://tiku.fenbi.com/api/${subject.id}/questionIds?type=errors&categoryId=${Number(categoryId)}&offset=0&limit=${safeLimit}&order=desc&timeRange=0&${CURRENT_API_QUERY}`);
    const normalized = normalizeErrorQuestionIds(idPayload);
    const fallbackIds = [...new Set((Array.isArray(fallbackQuestionIds) ? fallbackQuestionIds : []).map(String).filter(Boolean))];
    const questionIds = normalized.questionIds.length ? normalized.questionIds : fallbackIds.slice(0, safeLimit);
    const total = normalized.total || fallbackIds.length;
    if (!questionIds.length) return { items: [], materials: [], total: 0 };
    const payload = await this.request('GET', `https://tiku.fenbi.com/api/${subject.id}/universal/auth/solutions?type=1&questionIds=${encodeURIComponent(questionIds.join(','))}&${CURRENT_API_QUERY}`);
    return { ...normalizeErrorSolutions(payload, questionIds), total };
  }

  async paperLabels() {
    const payload = await this.request('GET', `https://tiku.fenbi.com/api/xingce/subLabels?${API_QUERY}`);
    return normalizePaperLabels(payload);
  }

  async papers(labelId, paperCount = 50) {
    const pageSize = Math.max(1, Math.min(300, Number(paperCount) || 50));
    const payload = await this.request('GET', `https://tiku.fenbi.com/api/xingce/papers/?toPage=0&pageSize=${pageSize}&labelId=${Number(labelId)}&${API_QUERY}`);
    return normalizePapers(payload);
  }

  async createPaperExercise(paperId) {
    const payload = await this.request('POST', `https://tiku.fenbi.com/api/xingce/exercises?${API_QUERY}`, {
      form: { type: 1, paperId: Number(paperId), exerciseTimeMode: 2 }
    });
    return normalizeCreatedExercise(payload);
  }

  async paperPdf(exerciseId) {
    return this.requestBuffer(`https://urlimg.fenbi.com/api/pdf/tiku/xingce/exercise/${Number(exerciseId)}?${API_QUERY}`);
  }

  async exerciseDocument(subjectId, combineKey) {
    const subject = getSubject(subjectId);
    const metadata = await this.request('GET', `https://tiku.fenbi.com/combine/exercise/getExercise?format=html&key=${encodeURIComponent(combineKey)}&routecs=${subject.id}&${API_QUERY}`);
    const staticUrl = extractStaticUrl(metadata, '练习');
    const document = await this.request('GET', withQuery(staticUrl, {
      routecs: subject.id,
      type: 1,
      app: 'web',
      kav: 121,
      av: 121,
      hav: 121
    }));
    const questionSet = normalizeCombinedQuestionSet(document, 'questions');
    return {
      ...questionSet,
      combineKey,
      exerciseId: Number(metadata.data?.ancientExerciseId?.id || metadata.data?.exerciseId || 0),
      userAnswers: metadata.data?.userAnswers && typeof metadata.data.userAnswers === 'object' ? metadata.data.userAnswers : {}
    };
  }

  async answerSubject({ subjectId, combineKey, globalId, answer, time }) {
    const subject = getSubject(subjectId);
    const answerPayload = subject.answerMode === 'essay'
      ? { type: 204, answer: String(answer || '') }
      : { type: 201, choice: String(answer) };
    await this.request('POST', `https://tiku.fenbi.com/combine/exercise/incrUpdate?key=${encodeURIComponent(combineKey)}&routecs=${subject.id}&${API_QUERY}`, {
      json: [{ answer: answerPayload, key: String(globalId), time: Math.max(0, Number(time || 0)) }]
    });
  }

  async submitSubject(subjectId, combineKey) {
    const subject = getSubject(subjectId);
    return this.request('POST', `https://tiku.fenbi.com/combine/exercise/submit?key=${encodeURIComponent(combineKey)}&routecs=${subject.id}&${API_QUERY}`, { json: {} });
  }

  async solutionDocument(subjectId, combineKey) {
    const subject = getSubject(subjectId);
    const metadata = await this.request('GET', `https://tiku.fenbi.com/combine/exercise/getSolution?format=html&key=${encodeURIComponent(combineKey)}&routecs=${subject.id}&${API_QUERY}`);
    const staticUrl = extractStaticUrl(metadata, '题目解析');
    const document = await this.request('GET', withQuery(staticUrl, {
      routecs: subject.id,
      type: 1,
      app: 'web',
      kav: 121,
      av: 121,
      hav: 121
    }));
    const solutionSet = normalizeCombinedQuestionSet(document, 'solutions');
    return {
      ...solutionSet,
      combineKey,
      exerciseId: Number(metadata.data?.ancientExerciseId?.id || metadata.data?.exerciseId || 0),
      userAnswers: metadata.data?.userAnswers && typeof metadata.data.userAnswers === 'object' ? metadata.data.userAnswers : {}
    };
  }

  async interviewDocument(subjectId, keypointId) {
    const subject = getSubject(subjectId);
    if (subject.answerMode !== 'interview') {
      throw new Error('当前科目不是面试题');
    }
    const idsPayload = await this.request('GET', `https://tiku.fenbi.com/api/${subject.id}/giants?keypointId=${Number(keypointId)}&${API_QUERY}`);
    const questionIds = responseItems(idsPayload, '面试题列表').map(String).filter(Boolean);
    if (questionIds.length === 0) {
      throw new Error('当前分类暂时没有面试题');
    }
    const questionId = questionIds[0];
    const payload = await this.request('GET', `https://tiku.fenbi.com/api/${subject.id}/universal/auth/solutions?type=9&questionIds=${encodeURIComponent(questionId)}&${API_QUERY}`);
    const items = responseItems(payload, '面试题内容');
    return {
      items,
      materials: Array.isArray(payload?.materials) ? payload.materials : Array.isArray(payload?.data?.materials) ? payload.data.materials : [],
      questionIds,
      keypointId: Number(keypointId)
    };
  }

  async unfinishedExercise() {
    const payload = await this.request('GET', `https://tiku.fenbi.com/api/xingce/category-exercises-unfinished?noCacheTag=${Date.now()}&${API_QUERY}`);
    const data = unwrapData(payload);
    if (!data || typeof data !== 'object' || Array.isArray(data)) {
      return null;
    }
    const exercise = normalizeExercise(data);
    return exercise.id > 0 ? exercise : null;
  }

  async userQuestionInfo() {
    const payload = await this.request('GET', `https://tiku.fenbi.com/activity/userquiz/getUserQuestionInfo?${API_QUERY}`);
    return normalizeUserInfo(payload);
  }

  async updateQuestionCount(questionCount) {
    const count = Number(questionCount);
    if (!Number.isInteger(count) || count < 1 || count > 100) {
      throw new Error('每组题数应为 1 到 100 的整数');
    }
    const settings = await this.userQuestionInfo();
    await this.request('POST', `https://tiku.fenbi.com/activity/userquiz/updateUserQuestionInfo?sheetType=${settings.sheetType}&questionCount=${count}&yearScope=${settings.yearScope}&correctRatioLow=${settings.correctRatioLow}&correctRatioHigh=${settings.correctRatioHigh}&${API_QUERY}`, { json: {} });
    return count;
  }

  async createExercise(keypointId) {
    const settings = await this.userQuestionInfo();
    const payload = await this.request('POST', `https://tiku.fenbi.com/api/xingce/exercises?${API_QUERY}`, {
      form: {
        type: 3,
        exerciseTimeMode: 2,
        keypointId,
        limit: settings.questionCount,
        yearScope: settings.yearScope,
        correctRatioLow: settings.correctRatioLow,
        correctRatioHigh: settings.correctRatioHigh
      }
    });
    return normalizeCreatedExercise(payload);
  }

  async exercise(exerciseId) {
    const payload = await this.request('GET', `https://tiku.fenbi.com/api/xingce/exercises/${exerciseId}?${API_QUERY}`);
    return normalizeExercise(payload);
  }

  async questions(exerciseId) {
    const payload = await this.request('GET', `https://tiku.fenbi.com/api/xingce/universal/auth/questions?type=0&id=${exerciseId}&${API_QUERY}`);
    return normalizeQuestionSet(payload, 'questions');
  }

  async answer({ exerciseId, questionId, questionIndex, answerChoice, time }) {
    const choice = String(answerChoice);
    if (!/^\d+$/.test(choice)) {
      throw new Error('答案选项格式无效');
    }
    await this.request('POST', `https://tiku.fenbi.com/api/xingce/async/exercises/${exerciseId}/incr?${API_QUERY}`, {
      json: [{
        answer: { type: 201, choice },
        flag: 0,
        questionId,
        questionIndex,
        time: Math.max(0, Number(time || 0))
      }]
    });
  }

  async submit(exerciseId) {
    await this.request('POST', `https://tiku.fenbi.com/api/xingce/async/exercises/${exerciseId}/submit?${API_QUERY}`, {
      form: { status: 3 }
    });
  }

  async solutions(exerciseId) {
    const payload = await this.request('GET', `https://tiku.fenbi.com/api/xingce/universal/auth/solutions?type=0&id=${exerciseId}&${API_QUERY}`);
    return normalizeQuestionSet(payload, 'solutions');
  }
}

module.exports = {
  API_QUERY,
  AUTHORIZED_HOSTS,
  FenbiClient,
  FenbiHttpError,
  assertAuthorizedUrl,
  encodeForm,
  shouldAttachCookie
};

