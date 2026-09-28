import { reactive, watch } from 'vue';
import { createInitialState } from './data';
import type { Course, Lesson, PersistedState, PracticeAttempt, PracticeSheet } from './types';

const STORAGE_KEY = 'sologsb-1029-dictation-state-v1';
const PRACTICE_SHEET_COURSE_ID = 'practice-sheets';
export const PRACTICE_SHEET_LESSON_PREFIX = 'practice-sheet:';

function normalizeState(saved: Partial<PersistedState>): PersistedState {
  const initial = createInitialState();
  return {
    ...initial,
    ...saved,
    courses: Array.isArray(saved.courses) ? saved.courses : initial.courses,
    attempts: Array.isArray(saved.attempts) ? saved.attempts : initial.attempts,
    progress: saved.progress ?? initial.progress,
    practiceSheets: Array.isArray(saved.practiceSheets) ? saved.practiceSheets : [],
    activeLessonId: saved.activeLessonId ?? '',
    activeSheetId: saved.activeSheetId ?? '',
    activeSentenceId: saved.activeSentenceId ?? '',
    theme: saved.theme === 'dark' ? 'dark' : 'light',
    fontScale: typeof saved.fontScale === 'number' ? saved.fontScale : 1,
    role: saved.role === 'teacher' ? 'teacher' : 'learner'
  };
}

function loadState(): PersistedState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<PersistedState>;
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

export const practiceSheetLessonId = (sheetId: string) => `${PRACTICE_SHEET_LESSON_PREFIX}${sheetId}`;
export const isPracticeSheetLessonId = (lessonId: string) => lessonId.startsWith(PRACTICE_SHEET_LESSON_PREFIX);
export const practiceSheetById = (sheetId: string) => state.practiceSheets.find((sheet) => sheet.id === sheetId);

export function practiceSheetToLesson(sheet: PracticeSheet): Lesson {
  return {
    id: practiceSheetLessonId(sheet.id),
    courseId: PRACTICE_SHEET_COURSE_ID,
    title: sheet.name,
    subtitle: '专项练习单',
    level: '专项',
    estimatedMinutes: Math.max(1, Math.round(sheet.items.length * 1.2)),
    downloaded: true,
    sentences: sheet.items.map((item) => ({
      id: item.id,
      text: item.text,
      translation: item.translation,
      note: item.note
    }))
  };
}

export function practiceSheetCourse(sheets: PracticeSheet[]): Course {
  return {
    id: PRACTICE_SHEET_COURSE_ID,
    title: '专项练习单',
    description: '由教师从课程库挑选句子组成的临时复习课。',
    level: '专项',
    accent: '#d97706',
    lessons: sheets.map(practiceSheetToLesson)
  };
}

export const lessons = (): Lesson[] => [
  ...state.courses.flatMap((course) => course.lessons),
  ...state.practiceSheets.map(practiceSheetToLesson)
];
export const lessonById = (id: string): Lesson | undefined => lessons().find((lesson) => lesson.id === id);
export const courseForLesson = (lessonId: string): Course | undefined => {
  if (isPracticeSheetLessonId(lessonId)) return practiceSheetCourse(state.practiceSheets);
  return state.courses.find((course) => course.id === lessonById(lessonId)?.courseId);
};

export function setDownloaded(lessonId: string, value: boolean) {
  const lesson = lessonById(lessonId);
  if (lesson) lesson.downloaded = value;
}

export function savePracticeSheet(sheet: PracticeSheet) {
  const index = state.practiceSheets.findIndex((item) => item.id === sheet.id);
  if (index === -1) state.practiceSheets.unshift(sheet);
  else state.practiceSheets.splice(index, 1, sheet);

  const lessonId = practiceSheetLessonId(sheet.id);
  const progress = state.progress[lessonId];
  if (progress) {
    const validIds = new Set(sheet.items.map((item) => item.id));
    Object.keys(progress.answers).forEach((answerId) => {
      if (!validIds.has(answerId)) delete progress.answers[answerId];
    });
    if (!validIds.has(progress.activeSentenceId)) progress.activeSentenceId = sheet.items[0]?.id ?? '';
    progress.updatedAt = new Date().toISOString();
  }
}

export function deletePracticeSheet(sheetId: string) {
  const lessonId = practiceSheetLessonId(sheetId);
  state.practiceSheets = state.practiceSheets.filter((sheet) => sheet.id !== sheetId);
  delete state.progress[lessonId];
  state.attempts = state.attempts.filter((attempt) => attempt.practiceSheetId !== sheetId);
  if (state.activeLessonId === lessonId) {
    state.activeLessonId = '';
    state.activeSheetId = '';
    state.activeSentenceId = '';
  }
}

export function saveAttempt(attempt: PracticeAttempt) {
  state.attempts.unshift(attempt);
}

export function updateTokenClassification(attemptId: string, sentenceId: string, tokenIndex: number, patch: { category?: PracticeAttempt['sentenceAttempts'][number]['tokens'][number]['category']; reason?: string }) {
  const attempt = state.attempts.find((item) => item.id === attemptId);
  const token = attempt?.sentenceAttempts.find((item) => item.sentenceId === sentenceId)?.tokens.find((item) => item.index === tokenIndex);
  if (token) Object.assign(token, patch);
}

export function exportRecords(): string {
  return JSON.stringify({
    exportedAt: new Date().toISOString(),
    application: 'EchoStep 移动听写',
    attempts: state.attempts,
    practiceSheets: state.practiceSheets,
    progress: state.progress
  }, null, 2);
}

export function resetDemo() {
  const fresh = createInitialState();
  Object.assign(state, fresh);
}
