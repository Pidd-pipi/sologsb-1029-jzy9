<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import {
  courseForLesson,
  deletePracticeSheet,
  exportRecords,
  lessonById,
  persist,
  practiceSheetById,
  resolveSheetItem,
  saveAttempt,
  setDownloaded,
  state,
  updateTokenClassification
} from './store';
import type { ErrorCategory, Lesson, PracticeAttempt, PracticeSheet, PracticeSheetItem, PracticeView, Sentence } from './types';
import { compareSentence, scoreAttempt, segmentText } from './utils';

const view = ref<PracticeView>(state.activeSheetId || state.activeLessonId ? 'practice' : 'library');
const online = ref(navigator.onLine);
const toast = ref('');
const resultAttemptId = ref('');
const selectedResultSentence = ref(0);
const segmentStart = ref(0);
const segmentEnd = ref(1);
const teacherAttemptId = ref(state.attempts[0]?.id ?? '');
const teacherDraft = ref(state.attempts[0]?.teacherFeedback ?? '');
const sheetEditorOpen = ref(false);
const editingSheetId = ref('');
const sheetName = ref('');
const selectedItemKeys = ref<string[]>([]);
const editorItems = ref<PracticeSheetItem[]>([]);
let toastTimer = 0;

interface PracticeEntry {
  key: string;
  itemId: string;
  courseId: string;
  lessonId: string;
  sentenceId: string;
  courseTitle: string;
  lesson: Lesson;
  sentence: Sentence;
}

const isSheetMode = computed(() => !!state.activeSheetId);
const activeSheet = computed(() => practiceSheetById(state.activeSheetId));
const sheetEntries = computed<PracticeEntry[]>(() => {
  if (!activeSheet.value) return [];
  return activeSheet.value.items
    .map((item) => {
      const resolved = resolveSheetItem(item);
      if (!resolved) return undefined;
      return {
        key: item.itemId,
        itemId: item.itemId,
        courseId: item.courseId,
        lessonId: item.lessonId,
        sentenceId: item.sentenceId,
        courseTitle: resolved.course.title,
        lesson: resolved.lesson,
        sentence: resolved.sentence
      };
    })
    .filter((item): item is PracticeEntry => !!item);
});
const activeLesson = computed(() => isSheetMode.value ? undefined : lessonById(state.activeLessonId));
const activeCourse = computed(() => {
  if (activeSheet.value) return undefined;
  return activeLesson.value ? courseForLesson(activeLesson.value.id) : undefined;
});
const activeEntries = computed<PracticeEntry[]>(() => {
  const lesson = activeLesson.value;
  if (!lesson) return sheetEntries.value;
  const course = activeCourse.value;
  return lesson.sentences.map((sentence) => ({
    key: sentence.id,
    itemId: sentence.id,
    courseId: lesson.courseId,
    lessonId: lesson.id,
    sentenceId: sentence.id,
    courseTitle: course?.title ?? '',
    lesson,
    sentence
  }));
});
const currentEntry = computed(() => {
  const entries = activeEntries.value;
  const currentId = isSheetMode.value
    ? state.sheetDrafts[state.activeSheetId]?.activeItemId
    : state.activeSentenceId;
  return entries.find((entry) => entry.itemId === currentId) ?? entries[0];
});
const currentSentence = computed(() => currentEntry.value?.sentence);
const activeProgress = computed(() => activeLesson.value ? state.progress[activeLesson.value.id] : undefined);
const activeSheetDraft = computed(() => activeSheet.value ? state.sheetDrafts[activeSheet.value.id] : undefined);
const currentAnswer = ref('');
const currentIndex = computed(() => activeEntries.value.findIndex((entry) => entry.itemId === currentEntry.value?.itemId));
const practiceCompletion = computed(() => {
  const entries = activeEntries.value;
  if (!entries.length) return 0;
  const answered = entries.filter((entry) => {
    if (isSheetMode.value) return (activeSheetDraft.value?.answersByItem[entry.itemId] ?? '').trim();
    return (activeProgress.value?.answers[entry.sentenceId] ?? '').trim();
  }).length;
  return Math.round((answered / entries.length) * 100);
});
const resultAttempt = computed(() => state.attempts.find((attempt) => attempt.id === resultAttemptId.value));
const resultSentence = computed(() => resultAttempt.value?.sentenceAttempts[selectedResultSentence.value]);
const teacherAttempt = computed(() => state.attempts.find((attempt) => attempt.id === teacherAttemptId.value));
const totalWords = computed(() => state.attempts.flatMap((attempt) => attempt.sentenceAttempts).flatMap((item) => item.tokens).length);
const correctedWords = computed(() => state.attempts.flatMap((attempt) => attempt.sentenceAttempts).flatMap((item) => item.tokens).filter((token) => !token.correct && token.category !== 'unclassified').length);

const categoryOptions: Array<{ value: ErrorCategory; label: string }> = [
  { value: 'unclassified', label: '未分类' },
  { value: 'spelling', label: '拼写错误' },
  { value: 'omitted', label: '漏词' },
  { value: 'extra', label: '多词' },
  { value: 'punctuation', label: '标点' },
  { value: 'grammar', label: '语法' }
];

const sheetSentenceOptions = computed(() => state.courses.flatMap((course) =>
  course.lessons.flatMap((lesson) =>
    lesson.sentences.map((sentence) => ({
      key: `${course.id}__${lesson.id}__${sentence.id}`,
      course,
      lesson,
      sentence
    }))
  )
));

function sheetItemKey(item: Pick<PracticeSheetItem, 'courseId' | 'lessonId' | 'sentenceId'>) {
  return `${item.courseId}__${item.lessonId}__${item.sentenceId}`;
}

function answerForEntry(entry: PracticeEntry): string {
  if (isSheetMode.value && activeSheet.value) {
    return state.sheetDrafts[activeSheet.value.id]?.answersByItem[entry.itemId] ?? '';
  }
  return state.progress[entry.lessonId]?.answers[entry.sentenceId] ?? '';
}

watch(currentEntry, (entry) => {
  currentAnswer.value = entry ? answerForEntry(entry) : '';
  segmentStart.value = 0;
  segmentEnd.value = entry ? Math.max(0, segmentText(entry.sentence.text).length - 1) : 0;
}, { immediate: true });

watch(currentAnswer, (value) => {
  const sheet = activeSheet.value;
  const entry = currentEntry.value;
  if (!entry) return;
  const now = new Date().toISOString();
  if (sheet) {
    const draft = state.sheetDrafts[sheet.id] ?? { answersByItem: {}, activeItemId: entry.itemId, updatedAt: now };
    draft.answersByItem[entry.itemId] = value;
    draft.activeItemId = entry.itemId;
    draft.updatedAt = now;
    state.sheetDrafts[sheet.id] = draft;
    return;
  }
  const progress = state.progress[entry.lessonId] ?? { answers: {}, activeSentenceId: entry.sentenceId, updatedAt: now };
  progress.answers[entry.sentenceId] = value;
  progress.activeSentenceId = entry.sentenceId;
  progress.updatedAt = now;
  state.progress[entry.lessonId] = progress;
});

watch(teacherAttemptId, (id) => {
  teacherDraft.value = state.attempts.find((attempt) => attempt.id === id)?.teacherFeedback ?? '';
});

function notify(message: string) {
  toast.value = message;
  window.clearTimeout(toastTimer);
  toastTimer = window.setTimeout(() => { toast.value = ''; }, 2400);
}

function startLesson(lesson: Lesson) {
  const progress = state.progress[lesson.id] ?? { answers: {}, activeSentenceId: lesson.sentences[0].id, updatedAt: new Date().toISOString() };
  if (!lesson.sentences.some((sentence) => sentence.id === progress.activeSentenceId)) progress.activeSentenceId = lesson.sentences[0].id;
  state.progress[lesson.id] = progress;
  state.activeLessonId = lesson.id;
  state.activeSheetId = '';
  state.activeSentenceId = progress.activeSentenceId;
  currentAnswer.value = progress.answers[state.activeSentenceId] ?? '';
  view.value = 'practice';
  persist();
}

function startSheet(sheet: PracticeSheet) {
  if (!sheet.items.length) {
    notify('这份练习单还没有句子');
    return;
  }
  const firstItemId = sheet.items[0]?.itemId ?? '';
  const draft = state.sheetDrafts[sheet.id] ?? { answersByItem: {}, activeItemId: firstItemId, updatedAt: new Date().toISOString() };
  if (!sheet.items.some((item) => item.itemId === draft.activeItemId)) draft.activeItemId = firstItemId;
  state.sheetDrafts[sheet.id] = draft;
  state.activeSheetId = sheet.id;
  state.activeLessonId = '';
  state.activeSentenceId = '';
  currentAnswer.value = draft.answersByItem[draft.activeItemId] ?? '';
  view.value = 'practice';
  persist();
}

function openSheetEditor(sheet?: PracticeSheet) {
  editingSheetId.value = sheet?.id ?? '';
  sheetName.value = sheet?.name ?? '';
  editorItems.value = sheet ? sheet.items.map((item) => ({ ...item })) : [];
  selectedItemKeys.value = editorItems.value.map(sheetItemKey);
  sheetEditorOpen.value = true;
}

function closeSheetEditor() {
  sheetEditorOpen.value = false;
  editingSheetId.value = '';
  sheetName.value = '';
  selectedItemKeys.value = [];
  editorItems.value = [];
}

function toggleSheetSentence(event: Event) {
  const select = event.target as HTMLSelectElement;
  const option = sheetSentenceOptions.value.find((item) => item.key === select.value);
  select.value = '';
  if (!option) return;
  const existing = editorItems.value.find((item) => sheetItemKey(item) === option.key);
  if (existing) {
    notify('这个句子已在练习单中');
    return;
  }
  editorItems.value.push({
    itemId: `sheet-item-${option.course.id}-${option.lesson.id}-${option.sentence.id}`,
    courseId: option.course.id,
    lessonId: option.lesson.id,
    sentenceId: option.sentence.id
  });
  selectedItemKeys.value = editorItems.value.map(sheetItemKey);
}

function toggleSelectedSentence(key: string) {
  if (selectedItemKeys.value.includes(key)) {
    editorItems.value = editorItems.value.filter((item) => sheetItemKey(item) !== key);
  } else {
    const option = sheetSentenceOptions.value.find((item) => item.key === key);
    if (!option) return;
    editorItems.value.push({
      itemId: `sheet-item-${option.course.id}-${option.lesson.id}-${option.sentence.id}`,
      courseId: option.course.id,
      lessonId: option.lesson.id,
      sentenceId: option.sentence.id
    });
  }
  selectedItemKeys.value = editorItems.value.map(sheetItemKey);
}

function moveEditorItem(index: number, delta: number) {
  const target = index + delta;
  if (target < 0 || target >= editorItems.value.length) return;
  const items = [...editorItems.value];
  [items[index], items[target]] = [items[target], items[index]];
  editorItems.value = items;
}

function removeEditorItem(index: number) {
  editorItems.value = editorItems.value.filter((_, itemIndex) => itemIndex !== index);
  selectedItemKeys.value = editorItems.value.map(sheetItemKey);
}

function saveSheet() {
  const name = sheetName.value.trim();
  if (!name) {
    notify('请先填写练习单名称');
    return;
  }
  if (!editorItems.value.length) {
    notify('请至少勾选一个句子');
    return;
  }
  const now = new Date().toISOString();
  const existing = editingSheetId.value ? state.practiceSheets.find((sheet) => sheet.id === editingSheetId.value) : undefined;
  const sheet: PracticeSheet = {
    id: existing?.id ?? `sheet-${Date.now()}`,
    name,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
    items: editorItems.value.map((item) => ({ ...item }))
  };
  if (existing) {
    Object.assign(existing, sheet);
    const draft = state.sheetDrafts[sheet.id];
    if (draft) {
      const validItemIds = new Set(sheet.items.map((item) => item.itemId));
      draft.answersByItem = Object.fromEntries(Object.entries(draft.answersByItem).filter(([itemId]) => validItemIds.has(itemId)));
      if (!validItemIds.has(draft.activeItemId)) draft.activeItemId = sheet.items[0]?.itemId ?? '';
      draft.updatedAt = now;
    }
  } else {
    state.practiceSheets.unshift(sheet);
  }
  closeSheetEditor();
  persist();
  notify('专项练习单已保存');
}

function removeSheet(sheet: PracticeSheet) {
  const draftCount = Object.values(state.sheetDrafts[sheet.id]?.answersByItem ?? {}).filter((answer) => answer.trim()).length;
  const attemptCount = state.attempts.filter((attempt) => attempt.kind === 'sheet' && attempt.sheetId === sheet.id).length;
  const message = `撤掉「${sheet.name}」只会删除这份练习单自己的${draftCount ? `草稿（${draftCount} 句）` : '草稿'}和${attemptCount ? `作答（${attemptCount} 条）` : '作答'}，原课程记录保留。确定吗？`;
  if (!window.confirm(message)) return;
  deletePracticeSheet(sheet.id);
  if (view.value === 'practice' && state.activeSheetId === sheet.id) {
    state.activeSheetId = '';
    view.value = 'library';
  }
  if (resultAttemptId.value && state.attempts.every((attempt) => attempt.id !== resultAttemptId.value)) {
    resultAttemptId.value = '';
    view.value = 'library';
  }
  persist();
  notify('练习单已撤掉，原课程记录未受影响');
}

function goToSentence(index: number) {
  const entry = activeEntries.value[index];
  if (!entry) return;
  const now = new Date().toISOString();
  if (isSheetMode.value && activeSheet.value) {
    const draft = state.sheetDrafts[activeSheet.value.id] ?? { answersByItem: {}, activeItemId: entry.itemId, updatedAt: now };
    draft.activeItemId = entry.itemId;
    draft.updatedAt = now;
    state.sheetDrafts[activeSheet.value.id] = draft;
  } else {
    state.activeSentenceId = entry.sentenceId;
    const progress = state.progress[entry.lessonId];
    if (progress) {
      progress.activeSentenceId = entry.sentenceId;
      progress.updatedAt = now;
    }
  }
  currentAnswer.value = answerForEntry(entry);
  window.scrollTo({ top: 0, behavior: 'smooth' });
}

function submitLesson() {
  const entries = activeEntries.value;
  const sheet = activeSheet.value;
  if (!entries.length) return;
  const answeredCount = entries.filter((entry) => answerForEntry(entry).trim()).length;
  if (!answeredCount) {
    notify('请至少输入一句话再提交');
    return;
  }
  if (answeredCount < entries.length && !window.confirm(`还有 ${entries.length - answeredCount} 句未作答，仍然提交吗？`)) return;
  const sentenceAttempts = entries.map((entry) => {
    const source = entry.sentence.text;
    const answer = answerForEntry(entry);
    const tokens = compareSentence(source, answer);
    const correct = tokens.filter((token) => token.correct).length;
    return {
      sentenceId: entry.sentenceId,
      itemId: sheet ? entry.itemId : undefined,
      source,
      answer,
      tokens,
      score: tokens.length ? Math.round((correct / tokens.length) * 100) : 0
    };
  });
  const attempt: PracticeAttempt = {
    id: `attempt-${Date.now()}`,
    kind: sheet ? 'sheet' : 'lesson',
    sheetId: sheet?.id,
    sheetName: sheet?.name,
    lessonId: sheet ? '' : entries[0]?.lessonId ?? '',
    lessonTitle: sheet ? sheet.name : entries[0]?.lesson.title ?? '',
    courseTitle: sheet ? '专项练习单' : entries[0]?.courseTitle ?? '',
    submittedAt: new Date().toISOString(),
    score: scoreAttempt(sentenceAttempts),
    sentenceAttempts,
    teacherFeedback: ''
  };
  saveAttempt(attempt);
  resultAttemptId.value = attempt.id;
  selectedResultSentence.value = 0;
  syncSegment();
  view.value = 'result';
  persist();
  notify('已提交，逐词结果已生成');
}

function syncSegment() {
  const tokenCount = segmentText(resultSentence.value?.source ?? '').length;
  segmentStart.value = 0;
  segmentEnd.value = Math.max(0, tokenCount - 1);
}

function replay(text: string, rate = 0.82) {
  if (!('speechSynthesis' in window)) {
    notify('当前浏览器不支持语音播放');
    return;
  }
  window.speechSynthesis.cancel();
  const utterance = new SpeechSynthesisUtterance(text);
  utterance.lang = 'en-US';
  utterance.rate = rate;
  window.speechSynthesis.speak(utterance);
}

function replaySegment() {
  const tokens = segmentText(resultSentence.value?.source ?? '');
  const start = Math.min(segmentStart.value, segmentEnd.value);
  const end = Math.max(segmentStart.value, segmentEnd.value);
  replay(tokens.slice(start, end + 1).map((token) => token.display).join(' '), 0.72);
}

function selectResultSentence(index: number) {
  selectedResultSentence.value = index;
  syncSegment();
}

function saveClassification(attemptId: string, sentenceId: string, tokenIndex: number, category: ErrorCategory, reason: string, itemId?: string) {
  updateTokenClassification(attemptId, sentenceId, tokenIndex, { category, reason }, itemId);
  persist();
}

function saveTeacherFeedback() {
  const attempt = teacherAttempt.value;
  if (!attempt) return;
  attempt.teacherFeedback = teacherDraft.value.trim();
  persist();
  notify('教师反馈已保存');
}

function toggleTheme() {
  state.theme = state.theme === 'light' ? 'dark' : 'light';
}

function changeFont(delta: number) {
  state.fontScale = Math.min(1.25, Math.max(0.85, Number((state.fontScale + delta).toFixed(2))));
}

function downloadRecords() {
  const blob = new Blob([exportRecords()], { type: 'application/json;charset=utf-8' });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = `echo-step-records-${new Date().toISOString().slice(0, 10)}.json`;
  anchor.click();
  URL.revokeObjectURL(url);
  notify('练习记录已导出');
}

function formatDate(value: string): string {
  return new Date(value).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function resumeResultAttempt() {
  const attempt = resultAttempt.value;
  if (!attempt) return;
  if (attempt.kind === 'sheet' && attempt.sheetId) {
    const sheet = practiceSheetById(attempt.sheetId);
    if (sheet) {
      startSheet(sheet);
      return;
    }
    notify('这份练习单已撤掉，不能继续它的草稿');
    view.value = 'library';
    return;
  }
  const lesson = lessonById(attempt.lessonId);
  if (lesson) startLesson(lesson);
}

function attemptLabel(attempt: PracticeAttempt): string {
  return `${attempt.kind === 'sheet' ? '专项 · ' : ''}${attempt.lessonTitle} · ${attempt.score} 分 · ${formatDate(attempt.submittedAt)}`;
}

function onConnectionChange() {
  online.value = navigator.onLine;
  persist();
}

function onVisibilityChange() {
  if (document.visibilityState === 'hidden') persist();
}

onMounted(() => {
  window.addEventListener('online', onConnectionChange);
  window.addEventListener('offline', onConnectionChange);
  window.addEventListener('visibilitychange', onVisibilityChange);
  window.addEventListener('pagehide', persist);
});

onBeforeUnmount(() => {
  window.removeEventListener('online', onConnectionChange);
  window.removeEventListener('offline', onConnectionChange);
  window.removeEventListener('visibilitychange', onVisibilityChange);
  window.removeEventListener('pagehide', persist);
  persist();
});
</script>

<template>
  <var-app>
    <div class="app-shell" :data-theme="state.theme" :style="{ '--font-scale': state.fontScale }">
      <div v-if="view === 'library'" class="page">
        <header class="topbar">
          <div class="brand">
            <div class="brand-mark">E</div>
            <div><h1>EchoStep</h1><p>移动端语言听写</p></div>
          </div>
          <div class="icon-row">
            <button class="icon-button" :aria-label="state.theme === 'light' ? '切换到深色模式' : '切换到浅色模式'" @click="toggleTheme">{{ state.theme === 'light' ? '◐' : '☀' }}</button>
            <button class="icon-button" aria-label="减小字号" @click="changeFont(-0.05)">A−</button>
            <button class="icon-button" aria-label="增大字号" @click="changeFont(0.05)">A＋</button>
          </div>
        </header>

        <section class="hero">
          <h2>今天也把声音变成文字</h2>
          <p>下载课程后可离线作答，答案和当前位置会自动恢复。</p>
          <div class="hero-stats">
            <div class="hero-stat"><strong>{{ state.attempts.length }}</strong><span>练习记录</span></div>
            <div class="hero-stat"><strong>{{ correctedWords }}</strong><span>已分类错误</span></div>
            <div class="hero-stat"><strong>{{ totalWords }}</strong><span>累计词数</span></div>
          </div>
        </section>

        <div class="offline-banner" :class="{ online }">
          <span>{{ online ? '● 在线 · 数据已保存到本机' : '● 离线模式 · 可继续已下载课程' }}</span>
          <span>{{ online ? '本地优先存储' : '恢复网络后继续保存' }}</span>
        </div>

        <div class="section-head">
          <h3>课程库</h3>
          <div class="segmented">
            <button :class="{ active: state.role === 'learner' }" @click="state.role = 'learner'; view = 'library'">学习</button>
            <button :class="{ active: state.role === 'teacher' }" @click="state.role = 'teacher'; view = 'teacher'">教师</button>
          </div>
        </div>

        <article v-for="course in state.courses" :key="course.id" class="course-card">
          <div class="course-title">
            <div><h3>{{ course.title }}</h3><p>{{ course.description }}</p></div>
            <span class="level-badge">{{ course.level }}</span>
          </div>
          <div v-for="lesson in course.lessons" :key="lesson.id" class="lesson-row">
            <div><h4>{{ lesson.title }}</h4><p>{{ lesson.subtitle }} · {{ lesson.sentences.length }} 句 · 约 {{ lesson.estimatedMinutes }} 分钟</p></div>
            <div class="lesson-actions">
              <var-switch :model-value="lesson.downloaded" @update:model-value="setDownloaded(lesson.id, $event as boolean)" />
              <var-button type="primary" size="small" @click="startLesson(lesson)">{{ lesson.downloaded ? '继续' : '开始' }}</var-button>
            </div>
          </div>
        </article>

        <div class="section-head">
          <h3>专项练习单</h3>
          <var-button type="primary" size="small" @click="openSheetEditor()">新建练习单</var-button>
        </div>

        <template v-if="state.practiceSheets.length">
          <article v-for="sheet in state.practiceSheets" :key="sheet.id" class="panel sheet-card">
            <div class="history-top">
              <div>
                <strong>{{ sheet.name }}</strong>
                <p>{{ sheet.items.length }} 句 · 更新于 {{ formatDate(sheet.updatedAt) }}</p>
              </div>
              <span class="level-badge">专项</span>
            </div>
            <div class="sheet-actions">
              <var-button type="primary" size="small" @click="startSheet(sheet)">开始</var-button>
              <var-button size="small" variant="outline" @click="openSheetEditor(sheet)">编辑</var-button>
              <var-button size="small" color="#d83b45" text-color="#d83b45" variant="outline" @click="removeSheet(sheet)">撤掉</var-button>
            </div>
          </article>
        </template>
        <div v-else class="panel empty-state"><strong>还没有专项练习单</strong>从课程库勾选常错句，可跨课节调整听写顺序。</div>

        <section v-if="sheetEditorOpen" class="panel sheet-editor">
          <div class="detail-head">
            <div><h3>{{ editingSheetId ? '编辑专项练习单' : '新建专项练习单' }}</h3><p>勾选句子后，按右侧顺序逐句听写。</p></div>
          </div>
          <label class="editor-field"><span>练习单名称</span><input v-model="sheetName" placeholder="如：机场与会议高频错句" /></label>

          <label class="editor-field"><span>从课程库添加句子</span>
            <select value="" @change="toggleSheetSentence">
              <option value="" disabled>选择要加入的句子</option>
              <option v-for="option in sheetSentenceOptions" :key="option.key" :value="option.key" :disabled="selectedItemKeys.includes(option.key)">
                {{ option.course.title }} / {{ option.lesson.title }} / {{ option.sentence.text }}
              </option>
            </select>
          </label>

          <div class="dictation-label"><strong>课程库句子</strong><span>勾选后加入练习单</span></div>
          <div class="sentence-check-list">
            <label v-for="option in sheetSentenceOptions" :key="`check-${option.key}`" class="sentence-check">
              <input type="checkbox" :checked="selectedItemKeys.includes(option.key)" @change="toggleSelectedSentence(option.key)" />
              <span><strong>{{ option.lesson.title }}</strong>{{ option.sentence.text }}</span>
            </label>
          </div>

          <div v-if="editorItems.length" class="dictation-label"><strong>听写顺序</strong><span>{{ editorItems.length }} 句</span></div>
          <div v-for="(item, index) in editorItems" :key="item.itemId" class="ordered-sentence">
            <span>{{ index + 1 }}</span>
            <div>
              <strong>{{ resolveSheetItem(item)?.lesson.title }}</strong>
              <p>{{ resolveSheetItem(item)?.sentence.text }}</p>
            </div>
            <div class="order-buttons">
              <button type="button" aria-label="上移" :disabled="index === 0" @click="moveEditorItem(index, -1)">↑</button>
              <button type="button" aria-label="下移" :disabled="index === editorItems.length - 1" @click="moveEditorItem(index, 1)">↓</button>
              <button type="button" aria-label="移除" @click="removeEditorItem(index)">×</button>
            </div>
          </div>

          <div class="editor-actions">
            <var-button block variant="outline" @click="closeSheetEditor">取消</var-button>
            <var-button block type="primary" @click="saveSheet">保存练习单</var-button>
          </div>
        </section>

        <div class="section-head"><h3>最近练习</h3><span>{{ state.attempts.length }} 条记录</span></div>
        <article v-if="state.attempts.length" class="panel">
          <div v-for="attempt in state.attempts.slice(0, 4)" :key="attempt.id" class="history-card">
            <div class="history-top"><strong>{{ attempt.lessonTitle }}</strong><span class="history-score">{{ attempt.score }} 分</span></div>
            <p>{{ formatDate(attempt.submittedAt) }} · {{ attempt.teacherFeedback || '暂无教师反馈' }}</p>
          </div>
          <var-button block type="primary" variant="outline" @click="downloadRecords">导出全部练习记录</var-button>
        </article>
        <div v-else class="empty-state"><strong>还没有练习记录</strong>完成一次听写后，可在这里复核和导出。</div>
      </div>

      <div v-else-if="view === 'practice' && activeEntries.length" class="page">
        <header class="practice-header">
          <div class="practice-nav">
            <button class="back-button" aria-label="返回课程库" @click="view = 'library'">‹</button>
            <div><h2>{{ activeSheet ? activeSheet.name : activeLesson?.title }}</h2></div>
            <span class="status-chip">{{ online ? '在线' : '离线' }}</span>
          </div>
          <div class="progress-line">
            <div class="sentence-count"><span>第 {{ currentIndex + 1 }} / {{ activeEntries.length }} 句</span><span>{{ practiceCompletion }}% 已填写</span></div>
            <var-progress :value="practiceCompletion" color="#1769e0" />
          </div>
        </header>

        <section class="audio-card">
          <div class="audio-meta">
            <button class="play-button" aria-label="播放当前句子" @click="replay(currentSentence?.text ?? '')">▶</button>
            <div><strong>听写提示</strong><p>先完整播放，再输入你听到的英文。播放速度已放慢。</p></div>
          </div>
          <p v-if="currentEntry" class="audio-source">{{ currentEntry.courseTitle }} / {{ currentEntry.lesson.title }}</p>
        </section>

        <div class="dictation-label"><strong>输入听到的内容</strong><span>答案在本机自动保存</span></div>
        <textarea v-model="currentAnswer" class="answer-box" :aria-label="`第 ${currentIndex + 1} 句听写答案`" placeholder="Type what you hear..." @keydown.ctrl.enter="submitLesson" @keydown.meta.enter="submitLesson"></textarea>
        <div class="practice-actions">
          <var-button block type="default" variant="outline" @click="replay(currentSentence?.text ?? '')">再听一次</var-button>
          <var-button block type="primary" @click="submitLesson">提交本次听写</var-button>
        </div>

        <div class="sentence-picker" aria-label="句子导航">
          <button v-for="(entry, index) in activeEntries" :key="entry.key" class="sentence-dot" :class="{ active: entry.itemId === currentEntry?.itemId, done: !!answerForEntry(entry) }" :aria-label="`跳到第 ${index + 1} 句`" @click="goToSentence(index)">{{ index + 1 }}</button>
        </div>

        <section v-if="currentSentence" class="panel">
          <div class="detail-head"><div><h3>场景提示</h3><p>{{ currentSentence.translation }}</p></div></div>
          <div class="feedback-card">{{ currentSentence.note }}</div>
        </section>
      </div>

      <div v-else-if="view === 'result' && resultAttempt" class="page">
        <header class="topbar">
          <button class="back-button" aria-label="返回课程库" @click="view = 'library'">‹</button>
          <span class="status-chip">提交于 {{ formatDate(resultAttempt.submittedAt) }}</span>
          <button class="icon-button" @click="downloadRecords">导出</button>
        </header>

        <section class="panel result-score">
          <div class="score-ring" :style="{ '--score': `${resultAttempt.score}%` }"><strong>{{ resultAttempt.score }}</strong></div>
          <h2>{{ resultAttempt.score >= 90 ? '几乎完美' : resultAttempt.score >= 70 ? '继续打磨细节' : '再听一遍会更好' }}</h2>
          <p>{{ resultAttempt.lessonTitle }} · 点击红色词可单独重听，并记录错误原因。</p>
        </section>

        <div class="sentence-picker">
          <button v-for="(attempt, index) in resultAttempt.sentenceAttempts" :key="`${attempt.itemId ?? attempt.sentenceId}-${index}`" class="sentence-dot" :class="{ active: index === selectedResultSentence }" @click="selectResultSentence(index)">{{ index + 1 }}</button>
        </div>

        <section v-if="resultSentence" class="panel token-panel">
          <div class="detail-head">
            <div><h3>第 {{ selectedResultSentence + 1 }} 句逐词结果</h3><p>{{ resultSentence.source }}</p></div>
            <span class="history-score">{{ resultSentence.score }}%</span>
          </div>
          <div class="word-list">
            <button v-for="token in resultSentence.tokens" :key="`${token.index}-${token.expected}-${token.actual}`" class="word-chip" :class="{ wrong: !token.correct }" :title="token.correct ? '点击重听' : `你的答案：${token.actual || '未输入'}`" @click="replay(token.expected || token.actual, 0.7)">
              {{ token.expected || `[+${token.actual}]` }}<small v-if="!token.correct">{{ token.actual || '漏词' }}</small>
            </button>
          </div>

          <div v-if="resultSentence.tokens.some((token) => !token.correct)" style="margin-top: 18px">
            <div class="dictation-label"><strong>片段重听</strong><span>选择起止词后播放</span></div>
            <div style="display: grid; grid-template-columns: 1fr 1fr auto; gap: 8px; align-items: center">
              <select v-model.number="segmentStart" aria-label="片段起点"><option v-for="token in segmentText(resultSentence.source)" :key="`s-${token.index}`" :value="token.index">{{ token.index + 1 }} · {{ token.display }}</option></select>
              <select v-model.number="segmentEnd" aria-label="片段终点"><option v-for="token in segmentText(resultSentence.source)" :key="`e-${token.index}`" :value="token.index">{{ token.index + 1 }} · {{ token.display }}</option></select>
              <var-button type="primary" size="small" @click="replaySegment">播放片段</var-button>
            </div>
          </div>

          <div v-if="resultSentence.tokens.some((token) => !token.correct)" style="margin-top: 18px">
            <div class="dictation-label"><strong>错误分类与原因</strong><span>会被写入本地记录</span></div>
            <div v-for="token in resultSentence.tokens.filter((item) => !item.correct)" :key="`edit-${token.index}`" class="feedback-card">
              <strong>{{ token.expected || `多出的词：${token.actual}` }}</strong>
              <div style="display: grid; grid-template-columns: 120px 1fr; gap: 8px; margin-top: 9px">
                <select :value="token.category" @change="saveClassification(resultAttempt.id, resultSentence.sentenceId, token.index, ($event.target as HTMLSelectElement).value as ErrorCategory, token.reason, resultSentence.itemId)">
                  <option v-for="option in categoryOptions" :key="option.value" :value="option.value">{{ option.label }}</option>
                </select>
                <input :value="token.reason" placeholder="记录原因，如连读、词尾未听清" @change="saveClassification(resultAttempt.id, resultSentence.sentenceId, token.index, token.category, ($event.target as HTMLInputElement).value, resultSentence.itemId)" />
              </div>
            </div>
          </div>
        </section>

        <section v-if="resultAttempt.teacherFeedback" class="panel"><div class="feedback-card"><strong>教师反馈</strong><p>{{ resultAttempt.teacherFeedback }}</p></div></section>
        <var-button block type="primary" @click="resumeResultAttempt">返回本次{{ resultAttempt.kind === 'sheet' ? '练习单' : '课程' }}</var-button>
        <var-button block type="default" variant="outline" style="margin-top: 10px" @click="downloadRecords">导出练习记录</var-button>
      </div>

      <div v-else-if="view === 'teacher'" class="page">
        <header class="topbar">
          <button class="back-button" aria-label="返回课程库" @click="view = 'library'">‹</button>
          <div class="brand"><div class="brand-mark">T</div><div><h1>教师复核</h1><p>查看作答并写入反馈</p></div></div>
        </header>

        <div v-if="state.attempts.length" class="panel">
          <div class="dictation-label"><strong>选择一次作答</strong><span>{{ state.attempts.length }} 条</span></div>
          <var-select v-model="teacherAttemptId" placeholder="选择作答">
            <var-option v-for="attempt in state.attempts" :key="attempt.id" :label="attemptLabel(attempt)" :value="attempt.id" />
          </var-select>
          <template v-if="teacherAttempt">
            <div class="feedback-card"><strong>{{ teacherAttempt.courseTitle }}</strong><p>{{ teacherAttempt.lessonTitle }} · 总分 {{ teacherAttempt.score }}，完成 {{ teacherAttempt.sentenceAttempts.length }} 句。</p></div>
            <div class="teacher-editor">
              <textarea v-model="teacherDraft" placeholder="给学生一条具体、可执行的反馈..." aria-label="教师反馈"></textarea>
              <var-button block type="primary" style="margin-top: 10px" @click="saveTeacherFeedback">保存反馈</var-button>
            </div>
          </template>
        </div>
        <div v-else class="empty-state"><strong>暂无学生作答</strong>学习端提交听写后，这里会出现练习记录。</div>
      </div>

      <div v-if="toast" style="position: fixed; z-index: 30; left: 50%; bottom: 28px; transform: translateX(-50%); padding: 11px 16px; border-radius: 12px; background: #17233d; color: white; font-size: .78rem; box-shadow: 0 10px 30px rgb(0 0 0 / .2)">{{ toast }}</div>
    </div>
  </var-app>
</template>
