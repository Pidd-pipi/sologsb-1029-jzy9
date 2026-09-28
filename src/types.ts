export type ErrorCategory = 'unclassified' | 'spelling' | 'omitted' | 'extra' | 'punctuation' | 'grammar';
export type PracticeView = 'library' | 'practice' | 'result' | 'teacher';
export type PracticeKind = 'lesson' | 'sheet';
export type ThemeMode = 'light' | 'dark';

export interface Sentence {
  id: string;
  text: string;
  translation: string;
  note: string;
}

export interface Lesson {
  id: string;
  courseId: string;
  title: string;
  subtitle: string;
  level: string;
  estimatedMinutes: number;
  downloaded: boolean;
  sentences: Sentence[];
}

export interface Course {
  id: string;
  title: string;
  description: string;
  level: string;
  accent: string;
  lessons: Lesson[];
}

export interface PracticeSheetItem {
  itemId: string;
  courseId: string;
  lessonId: string;
  sentenceId: string;
}

export interface PracticeSheet {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  items: PracticeSheetItem[];
}

export interface SheetDraft {
  answersByItem: Record<string, string>;
  activeItemId: string;
  updatedAt: string;
}

export interface TokenResult {
  index: number;
  expected: string;
  actual: string;
  correct: boolean;
  category: ErrorCategory;
  reason: string;
}

export interface SentenceAttempt {
  sentenceId: string;
  itemId?: string;
  source: string;
  answer: string;
  tokens: TokenResult[];
  score: number;
}

export interface PracticeAttempt {
  id: string;
  kind: PracticeKind;
  sheetId?: string;
  sheetName?: string;
  lessonId: string;
  lessonTitle: string;
  courseTitle: string;
  submittedAt: string;
  score: number;
  sentenceAttempts: SentenceAttempt[];
  teacherFeedback: string;
}

export interface LessonProgress {
  answers: Record<string, string>;
  activeSentenceId: string;
  updatedAt: string;
}

export interface PersistedState {
  schemaVersion: 1;
  courses: Course[];
  practiceSheets: PracticeSheet[];
  attempts: PracticeAttempt[];
  progress: Record<string, LessonProgress>;
  sheetDrafts: Record<string, SheetDraft>;
  activeLessonId: string;
  activeSheetId: string;
  activeSentenceId: string;
  theme: ThemeMode;
  fontScale: number;
  role: 'learner' | 'teacher';
}

export interface TextSegment {
  index: number;
  display: string;
  normalized: string;
}
