'use strict';

const path = require('node:path');
const crypto = require('node:crypto');
const vscode = require('vscode');
const { FenbiClient } = require('./src/fenbiClient');
const { getSubject, listSubjects, listEssayQuestionCategories } = require('./src/subjects');

const COOKIE_SECRET_KEY = 'fenbiFocus.cookie';
const SUBJECT_STATE_KEY = 'fenbiFocus.subject';

function safeMessage(error) {
  if (error instanceof Error) {
    return error.message.replace(/cookie\s*[:=]\s*[^\s,;]+/gi, 'cookie=[已隐藏]');
  }
  return '未知错误';
}

function asPositiveInteger(value, label) {
  const number = Number(value);
  if (!Number.isInteger(number) || number <= 0) {
    throw new Error(`${label}无效`);
  }
  return number;
}

function asCombineKey(value) {
  const key = String(value || '').trim();
  if (!key || key.length > 300) {
    throw new Error('练习 key 无效');
  }
  return key;
}

class PracticeViewProvider {
  constructor(context) {
    this.context = context;
    this.view = undefined;
    this.current = undefined;
    this.essayQuestionRequestId = 0;
    this.client = new FenbiClient(() => context.secrets.get(COOKIE_SECRET_KEY));
  }

  resolveWebviewView(view) {
    this.view = view;
    view.webview.options = {
      enableScripts: true,
      localResourceRoots: [vscode.Uri.file(path.join(this.context.extensionPath, 'media'))]
    };
    view.webview.html = this.getHtml(view.webview);
    view.webview.onDidReceiveMessage((message) => this.handleMessage(message), undefined, this.context.subscriptions);
    void this.refresh();
  }

  post(command, data = {}) {
    if (this.view) {
      void this.view.webview.postMessage({ command, data });
    }
  }

  async handleMessage(message) {
    const command = typeof message?.command === 'string' ? message.command : '';
    try {
      switch (command) {
        case 'ready':
        case 'refresh':
          await this.refresh(message.subjectId);
          break;
        case 'changeSubject':
          await this.changeSubject(message.subjectId);
          break;
        case 'setCookie':
          await this.setCookie();
          break;
        case 'clearCookie':
          await this.clearCookie();
          break;
        case 'startExercise':
          await this.startExercise(message.subjectId, asPositiveInteger(message.keypointId, '知识点 ID'), message.questionType);
          break;
        case 'openEssayQuestionList':
          await this.openEssayQuestionList(message.page, message.categoryId);
          break;
        case 'openEssayQuestion':
          await this.openEssayQuestion({ exerciseKey: message.exerciseKey, sheetId: message.sheetId });
          break;
        case 'setQuestionCount':
          await this.setQuestionCount(message.questionCount);
          break;
        case 'startQuickExercise':
          await this.startQuickExercise(message.subjectId);
          break;
        case 'startSmartExercise':
          await this.startSmartExercise(message.subjectId, message.yearScope);
          break;
        case 'openWrongBook':
          await this.openWrongBook(message.subjectId);
          break;
        case 'openWrongCategory':
          await this.openWrongCategory(message.subjectId, asPositiveInteger(message.categoryId, '错题分类 ID'), message.questionIds, message.questionType);
          break;
        case 'openPaperCatalog':
          await this.openPaperCatalog();
          break;
        case 'loadPapers':
          await this.loadPapers(asPositiveInteger(message.labelId, '真题分类 ID'), message.paperCount);
          break;
        case 'downloadPaper':
          await this.downloadPaper(message.paper);
          break;
        case 'openHistory':
          await this.openHistory(message.subjectId, message.item);
          break;
        case 'answer':
          await this.answer(message);
          break;
        case 'submit':
          await this.submit();
          break;
        case 'copyNote':
          await this.copyNote(message.text);
          break;
        default:
          break;
      }
    } catch (error) {
      this.post('error', { message: safeMessage(error) });
    }
  }

  currentSubject(subjectId) {
    const candidate = typeof subjectId === 'string' && subjectId ? subjectId : this.context.workspaceState.get(SUBJECT_STATE_KEY, 'xingce');
    return getSubject(candidate);
  }

  async refresh(subjectId) {
    const cookie = await this.context.secrets.get(COOKIE_SECRET_KEY);
    const config = vscode.workspace.getConfiguration('fenbiFocus');
    const subject = this.currentSubject(subjectId);
    const settings = {
      fontSize: config.get('fontSize', 14),
      compact: config.get('compact', true)
    };
    if (!cookie) {
      this.post('state', { authenticated: false, subjects: listSubjects(), subjectId: subject.id, settings });
      return;
    }
    this.post('loading', { message: `正在读取${subject.label}…` });
    // 本地记住的科目不会自动恢复粉笔服务端课程集；先同步，再读取依赖课程上下文的数据。
    await this.client.changeSubject(subject.id);
    if (subject.id === 'zhyynl') {
      const categories = listEssayQuestionCategories();
      const selectedCategoryId = categories.some((category) =>
        category.id === this.essayQuestionCategoryId || category.children.some((child) => child.id === this.essayQuestionCategoryId))
        ? this.essayQuestionCategoryId
        : categories[0].id;
      this.essayQuestionCategoryId = selectedCategoryId;
      const [user, essayList] = await Promise.all([
        this.client.currentUser(),
        this.client.essayQuestionList(selectedCategoryId, 0)
      ]);
      this.post('state', {
        authenticated: true,
        user,
        subjects: listSubjects(),
        subjectId: subject.id,
        subject,
        categories,
        cache: null,
        history: [],
        essayQuestions: essayList.items,
        essayQuestionPage: essayList.page,
        essayExamCategory: essayList.examCategory,
        essayQuestionCategoryId: selectedCategoryId,
        questionCount: 0,
        settings
      });
      return;
    }
    const baseRequests = [
      this.client.currentUser(),
      this.client.subjectCategories(subject.id)
    ];
    if (subject.answerMode === 'interview') {
      const [user, categories] = await Promise.all(baseRequests);
      this.post('state', {
        authenticated: true,
        user,
        subjects: listSubjects(),
        subjectId: subject.id,
        subject,
        categories,
        cache: null,
        history: [],
        settings
      });
      return;
    }
    const [user, categories, cache, history, questionSettings] = await Promise.all([
      ...baseRequests,
      this.client.subjectUnfinishedExercise(subject.id),
      this.client.history(subject.id, 15),
      this.client.userQuestionInfo()
    ]);
    this.post('state', {
      authenticated: true,
      user,
      subjects: listSubjects(),
      subjectId: subject.id,
      subject,
      categories,
      cache,
      history,
      questionCount: questionSettings.questionCount,
      settings
    });
  }

  async changeSubject(subjectId) {
    const subject = getSubject(String(subjectId || ''));
    this.essayQuestionRequestId += 1;
    this.post('loading', { message: `正在切换到${subject.label}…` });
    await this.context.workspaceState.update(SUBJECT_STATE_KEY, subject.id);
    this.current = undefined;
    await this.refresh(subject.id);
  }

  async setQuestionCount(questionCount) {
    this.post('loading', { message: '正在保存每组题数…' });
    const count = await this.client.updateQuestionCount(questionCount);
    this.post('questionCount', { questionCount: count });
  }

  async setCookie() {
    const cookie = await vscode.window.showInputBox({
      title: '设置粉笔 Cookie',
      prompt: 'Cookie 只写入 VS Code SecretStorage，不写入 settings.json 或工作区文件。',
      password: true,
      ignoreFocusOut: true,
      validateInput: (value) => value.trim().length < 20 ? 'Cookie 内容过短' : undefined
    });
    if (!cookie) return;
    this.post('loading', { message: '正在验证 Cookie…' });
    const candidate = new FenbiClient(async () => cookie.trim());
    const user = await candidate.currentUser();
    await this.context.secrets.store(COOKIE_SECRET_KEY, cookie.trim());
    void vscode.window.showInformationMessage(`粉笔账号已连接：${user.name}`);
    await this.refresh();
  }

  async clearCookie() {
    const choice = await vscode.window.showWarningMessage('确定清除本机保存的粉笔 Cookie？', { modal: true }, '清除');
    if (choice !== '清除') return;
    await this.context.secrets.delete(COOKIE_SECRET_KEY);
    this.current = undefined;
    await this.refresh();
  }

  async startExercise(subjectId, keypointId, questionType) {
    const subject = getSubject(String(subjectId || ''));
    if (subject.practiceMode === 'browser') {
      // 综应网页端并不通过 /api/zhyynl/exercises 生成知识点练习；改为打开已有题目列表。
      await this.openEssayQuestionList(0);
      return;
    }
    if (subject.answerMode === 'interview') {
      this.post('loading', { message: '正在读取面试题…' });
      const document = await this.client.interviewDocument(subject.id, keypointId);
      this.current = {
        subjectId: subject.id,
        subject,
        answerMode: 'interview',
        solutions: document.items,
        materials: document.materials,
        userAnswers: {},
        readOnly: true,
        questionType: String(questionType || '').trim(),
        startedAt: Date.now()
      };
      this.post('solution', this.current);
      return;
    }
    this.post('loading', { message: '正在生成练习…' });
    const cache = await this.client.subjectUnfinishedExercise(subject.id);
    const canResume = cache && cache.keypointIds.includes(keypointId);
    const combineKey = canResume ? cache.key : await this.client.createSubjectExercise(subject.id, keypointId);
    await this.loadExercise(subject, combineKey, questionType);
  }

  async openEssayQuestionList(page, categoryId) {
    const selectedCategoryId = Number(categoryId || this.essayQuestionCategoryId || 1);
    if (!Number.isInteger(selectedCategoryId) || selectedCategoryId <= 0) {
      throw new Error('综应题型无效');
    }
    this.essayQuestionCategoryId = selectedCategoryId;
    const requestId = ++this.essayQuestionRequestId;
    this.post('loading', { message: '正在读取综应题目列表…' });
    try {
      const result = await this.client.essayQuestionList(selectedCategoryId, page);
      if (requestId === this.essayQuestionRequestId) {
        this.post('essayQuestionList', { ...result, categoryId: selectedCategoryId });
      }
    } catch (error) {
      if (requestId === this.essayQuestionRequestId) throw error;
    }
  }

  async openEssayQuestion(value) {
    this.essayQuestionRequestId += 1;
    const subject = getSubject('zhyynl');
    this.post('loading', { message: '正在读取综应题目…' });
    const existingKey = String(value?.exerciseKey || '').trim();
    const combineKey = existingKey
      ? asCombineKey(existingKey)
      : await this.client.createEssayQuestionExercise(value?.sheetId);
    const document = await this.client.exerciseDocument(subject.id, combineKey);
    this.current = {
      subjectId: subject.id,
      subject,
      answerMode: subject.answerMode,
      combineKey,
      questions: document.items,
      materials: document.materials,
      userAnswers: document.userAnswers,
      readOnly: false,
      practiceKind: 'essay-browser',
      startedAt: Date.now()
    };
    this.post('exercise', this.current);
  }

  async startQuickExercise(subjectId) {
    const subject = getSubject(String(subjectId || ''));
    if (subject.practiceMode === 'browser') {
      await this.openEssayQuestionList(0);
      return;
    }
    this.post('loading', { message: '正在生成快速练习…' });
    const combineKey = await this.client.createQuickExercise(subject.id);
    await this.loadExercise(subject, combineKey);
  }

  async startSmartExercise(subjectId, yearScope) {
    const subject = getSubject(String(subjectId || ''));
    if (subject.practiceMode === 'browser') {
      await this.openEssayQuestionList(0);
      return;
    }
    let selectedYearScope = Number(yearScope);
    if (![0, 5, 10].includes(selectedYearScope)) {
      const choice = await vscode.window.showQuickPick([
        { label: '全部年份', value: 0, description: '题量最充足' },
        { label: '近 5 年', value: 5, description: '侧重新题' },
        { label: '近 10 年', value: 10, description: '兼顾题量与时效' }
      ], { title: '智能组卷年份范围', placeHolder: '选择本次组卷范围' });
      if (!choice) return;
      selectedYearScope = choice.value;
    }
    this.post('loading', { message: '正在智能组卷…' });
    const combineKey = await this.client.createSmartExercise(subject.id, selectedYearScope);
    await this.loadExercise(subject, combineKey);
  }

  async openWrongBook(subjectId) {
    const subject = getSubject(String(subjectId || ''));
    this.post('loading', { message: '正在读取我的错题…' });
    const categories = await this.client.errorKeypointTree(subject.id);
    this.post('wrongBook', { subjectId: subject.id, categories });
  }

  async openWrongCategory(subjectId, categoryId, fallbackQuestionIds, questionType) {
    const subject = getSubject(String(subjectId || ''));
    this.post('loading', { message: '正在读取错题解析…' });
    const document = await this.client.errorSolutions(subject.id, categoryId, 15, fallbackQuestionIds);
    this.current = {
      subjectId: subject.id,
      subject,
      answerMode: subject.answerMode,
      solutions: document.items,
      materials: document.materials,
      userAnswers: {},
      questionCount: document.total,
      practiceKind: 'errors',
      readOnly: true,
      questionType: String(questionType || '').trim(),
      startedAt: Date.now()
    };
    this.post('solution', this.current);
  }

  async openPaperCatalog() {
    this.post('loading', { message: '正在读取历年真题分类…' });
    const labels = await this.client.paperLabels();
    this.post('paperCatalog', { labels, papers: [], selectedLabelId: null });
  }

  async loadPapers(labelId, paperCount) {
    this.post('loading', { message: '正在读取真题列表…' });
    const papers = await this.client.papers(labelId, paperCount);
    this.post('paperCatalog', { papers, selectedLabelId: labelId });
  }

  async downloadPaper(paperValue) {
    const paper = paperValue && typeof paperValue === 'object' ? paperValue : {};
    const paperId = asPositiveInteger(paper.id, '试卷 ID');
    const name = String(paper.name || `粉笔真题-${paperId}`).replace(/[\\/:*?"<>|]/g, '_').slice(0, 120);
    const destination = await vscode.window.showSaveDialog({
      title: '保存往年真题 PDF',
      defaultUri: vscode.Uri.file(path.join(require('node:os').homedir(), `${name}.pdf`)),
      filters: { PDF: ['pdf'] },
      saveLabel: '下载'
    });
    if (!destination) return;
    if (Number(paper.exerciseId) <= 0) {
      const choice = await vscode.window.showInformationMessage(
        '粉笔尚未为这份试卷生成练习。继续下载会先在你的粉笔账号创建对应真题练习记录。',
        { modal: true },
        '创建并下载'
      );
      if (choice !== '创建并下载') return;
    }
    this.post('loading', { message: `正在下载《${name}》…` });
    const exerciseId = Number(paper.exerciseId) > 0
      ? Number(paper.exerciseId)
      : await this.client.createPaperExercise(paperId);
    const pdf = await this.client.paperPdf(exerciseId);
    await vscode.workspace.fs.writeFile(destination, pdf);
    this.post('paperDownloaded', { name, path: destination.fsPath });
    void vscode.window.showInformationMessage(`真题已保存：${destination.fsPath}`);
  }

  async loadExercise(subject, combineKey, questionType = '') {
    const document = await this.client.exerciseDocument(subject.id, combineKey);
    this.current = {
      subjectId: subject.id,
      subject,
      answerMode: subject.answerMode,
      combineKey,
      questions: document.items,
      materials: document.materials,
      userAnswers: document.userAnswers,
      questionType: String(questionType || '').trim(),
      startedAt: Date.now()
    };
    this.post('exercise', this.current);
  }

  async openHistory(subjectId, item) {
    const subject = getSubject(String(subjectId || ''));
    const combineKey = asCombineKey(item?.key);
    if (Number(item?.status) === 1) {
      this.post('loading', { message: '正在读取历史解析…' });
      const document = await this.client.solutionDocument(subject.id, combineKey);
      this.current = {
        subjectId: subject.id,
        subject,
        answerMode: subject.answerMode,
        combineKey,
        solutions: document.items,
        materials: document.materials,
        userAnswers: document.userAnswers,
        readOnly: true,
        startedAt: Date.now()
      };
      this.post('solution', this.current);
      return;
    }
    this.post('loading', { message: '正在继续历史练习…' });
    await this.loadExercise(subject, combineKey);
  }

  async answer(message) {
    if (!this.current || this.current.readOnly) {
      throw new Error('当前练习不能作答');
    }
    const questionIndex = Number(message.questionIndex);
    const question = this.current.questions?.[questionIndex];
    if (!question) throw new Error('题目序号无效');
    const globalId = question.globalId || question.id;
    if (globalId == null || globalId === '') throw new Error('题目缺少有效 ID');
    const answer = String(message.answer ?? '');
    if (this.current.answerMode === 'objective' && !/^\d+(,\d+)*$/.test(answer)) {
      throw new Error('答案选项格式无效');
    }
    await this.client.answerSubject({
      subjectId: this.current.subjectId,
      combineKey: this.current.combineKey,
      globalId,
      answer,
      time: Math.round((Date.now() - this.current.startedAt) / 1000)
    });
    const answerValue = this.current.answerMode === 'essay' ? { type: 204, answer } : { type: 201, choice: answer };
    this.current.userAnswers[String(globalId)] = { answer: answerValue };
    this.post('answerSaved', { questionIndex, answer });
  }

  async submit() {
    if (!this.current || this.current.readOnly || !this.current.combineKey) {
      throw new Error('当前没有可提交的练习');
    }
    const choice = await vscode.window.showInformationMessage('确认交卷？', { modal: true }, '确认交卷');
    if (choice !== '确认交卷') return;
    this.post('loading', { message: '正在交卷并读取解析…' });
    const result = await this.client.submitSubject(this.current.subjectId, this.current.combineKey);
    if (result?.msg === 'needPayment') {
      throw new Error('该内容需要在粉笔官网开通对应权限');
    }
    const document = await this.client.solutionDocument(this.current.subjectId, this.current.combineKey);
    this.current = {
      ...this.current,
      solutions: document.items,
      materials: document.materials,
      userAnswers: document.userAnswers,
      readOnly: true
    };
    this.post('solution', this.current);
  }

  async copyNote(text) {
    const value = String(text || '');
    if (!value || value.length > 20000) throw new Error('错题内容为空或过长');
    await vscode.env.clipboard.writeText(value);
    void vscode.window.showInformationMessage('题干已复制，可运行“省考：保存剪贴板错题到个人飞书”任务。');
  }

  getHtml(webview) {
    const nonce = crypto.randomBytes(16).toString('base64');
    const scriptUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'main.js')));
    const styleUri = webview.asWebviewUri(vscode.Uri.file(path.join(this.context.extensionPath, 'media', 'style.css')));
    return `<!doctype html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta http-equiv="Content-Security-Policy" content="default-src 'none'; img-src https: http: data: blob:; style-src ${webview.cspSource} 'unsafe-inline'; script-src 'nonce-${nonce}'; connect-src 'none';">
  <link rel="stylesheet" href="${styleUri}">
  <title>公考专注刷题</title>
</head>
<body>
  <main id="app" aria-live="polite"></main>
  <script nonce="${nonce}" src="${scriptUri}"></script>
</body>
</html>`;
  }
}

function activate(context) {
  const provider = new PracticeViewProvider(context);
  context.subscriptions.push(
    vscode.window.registerWebviewViewProvider('fenbiFocus.practiceView', provider, { webviewOptions: { retainContextWhenHidden: true } }),
    vscode.commands.registerCommand('fenbiFocus.setCookie', () => provider.setCookie()),
    vscode.commands.registerCommand('fenbiFocus.clearCookie', () => provider.clearCookie()),
    vscode.commands.registerCommand('fenbiFocus.refresh', () => provider.refresh()),
    vscode.commands.registerCommand('fenbiFocus.diagnoseEssayList', async () => {
      try {
        const result = await provider.client.essayQuestionList(1, 0);
        await vscode.window.showInformationMessage(`综应列表诊断：案例分析题第 1 页读取 ${result.items.length} 题，考试类别 ${result.examCategory.id}`);
      } catch (error) {
        await vscode.window.showErrorMessage(`综应列表诊断：${safeMessage(error)}`, { modal: true });
      }
    })
  );
}

function deactivate() {}

module.exports = { activate, deactivate, PracticeViewProvider, safeMessage };
