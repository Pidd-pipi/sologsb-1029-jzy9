import { reactive, watch } from 'vue';
import { createInitialState } from './data';
import type { Lesson, PersistedState, PracticeAttempt, PracticeSheet } from './types';

const STORAGE_KEY = 'sologsb-1029-dictation-state-v1';

function normalizeState(parsed: PersistedState): PersistedState {
  const initial = createInitialState();
  parsed.practiceSheets ??= [];
  parsed.attempts ??= [];
  parsed.progress ??= {};
  parsed.sheetDrafts ??= {};
  parsed.activeSheetId ??= '';
  if (parsed.activeSheetId && !parsed.practiceSheets.some((sheet) => sheet.id === parsed.activeSheetId)) parsed.activeSheetId = '';
  if (parsed.activeLessonId && !parsed.courses.some((course) => course.lessons.some((lesson) => lesson.id === parsed.activeLessonId))) parsed.activeLessonId = '';
  parsed.attempts = parsed.attempts.map((attempt) => ({
    ...attempt,
    kind: attempt.kind ?? 'lesson'
  }));
  return { ...initial, ...parsed };
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as PersistedState;
      if (parsed.schemaVersion === 1) return normalizeState(parsed);
    }
  } catch {
    // Falls back to the sample course when the local draft is malformed.
  }
  return createInitialState();
}

export const state = reactive<PersistedState>(loadState());

export const persist = () => {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    return true;
  } catch {
    return false;
  }
};

watch(state, persist, { deep: true });

export const lessons = (): Lesson[] => state.courses.flatMap((course) => course.lessons);
export const lessonById = (id: string): Lesson | undefined => lessons().find((lesson) => lesson.id === id);
export const courseForLesson = (lessonId: string) => state.courses.find((course) => course.id === lessonById(lessonId)?.courseId);
export const practiceSheetById = (id: string): PracticeSheet | undefined => state.practiceSheets.find((sheet) => sheet.id === id);

export function resolveSheetItem(item: { courseId: string; lessonId: string; sentenceId: string }) {
  const course = state.courses.find((entry) => entry.id === item.courseId);
  const lesson = course?.lessons.find((entry) => entry.id === item.lessonId);
  const sentence = lesson?.sentences.find((entry) => entry.id === item.sentenceId);
  return course && lesson && sentence ? { course, lesson, sentence } : undefined;
}

export function setDownloaded(lessonId: string, value: boolean) {
  const lesson = lessonById(lessonId);
  if (lesson) lesson.downloaded = value;
}

export function deletePracticeSheet(sheetId: string) {
  state.practiceSheets = state.practiceSheets.filter((sheet) => sheet.id !== sheetId);
  delete state.sheetDrafts[sheetId];
  state.attempts = state.attempts.filter((attempt) => !(attempt.kind === 'sheet' && attempt.sheetId === sheetId));
  if (state.activeSheetId === sheetId) state.activeSheetId = '';
}

export function saveAttempt(attempt: PracticeAttempt) {
  state.attempts.unshift(attempt);
}

export function updateTokenClassification(
  attemptId: string,
  sentenceId: string,
  tokenIndex: number,
  patch: { category?: PracticeAttempt['sentenceAttempts'][number]['tokens'][number]['category']; reason?: string },
  itemId?: string
) {
  const attempt = state.attempts.find((item) => item.id === attemptId);
  const sentenceAttempt = attempt?.sentenceAttempts
    .find((item) => item.sentenceId === sentenceId && (itemId === undefined || item.itemId === itemId));
  const token = sentenceAttempt?.tokens.find((item) => item.index === tokenIndex);
  if (token) Object.assign(token, patch);
}

export function exportRecords(): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    application: 'EchoStep 移动听写',
    practiceSheets: state.practiceSheets,
    attempts: state.attempts,
    progress: state.progress,
    sheetDrafts: state.sheetDrafts
  }, null, 2);
}

export function resetDemo() {
  const fresh = createInitialState();
  Object.assign(state, fresh);
}
