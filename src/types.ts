// ============ ENUMS ============

export enum Goal {
  LEARN = "learn",
  EXAM = "exam",
  QUIZ = "quiz",
}

export enum LearningMethod {
  EXAMPLES = "examples", // Learn through worked examples
  THEORY = "theory", // Understand concepts before practice
  PRACTICE = "practice", // Learn by doing exercises
  FLASHCARDS = "flashcards", // Memorization and recall
  SUMMARIES = "summaries", // Condensed key points
  SOCRATIC = "socratic", // AI asks guiding questions
}

export enum ExamDepth {
  OVERVIEW = "overview", // Key points only
  MODERATE = "moderate", // Main concepts + some details
  DEEP = "deep", // Comprehensive coverage
}

export enum QuizType {
  MULTIPLE_CHOICE = "multiple_choice",
  FREE_RESPONSE = "free_response",
  MIXED = "mixed",
}

export enum SessionType {
  LEARN = "learn",
  REVIEW = "review",
  QUIZ = "quiz",
  EXAM_PREP = "exam_prep",
}

export enum ResetType {
  ALL = "all",
  KNOWLEDGE = "knowledge",
  QUIZZES = "quizzes",
  SESSIONS = "sessions",
}

// ============ INTERFACES ============

export interface UserProfile {
  id: number;
  name: string | null;
  major: string | null;
  year: string | null;
  preferred_learning_methods: string | null; // JSON array of LearningMethod[]
  created_at: string;
  last_active: string;
}

export interface SessionPreferences {
  id: number;
  goal: Goal | null;
  // Learn branch
  learn_topic: string | null;
  learn_concept: string | null;
  // Exam branch
  exam_name: string | null;
  exam_depth: ExamDepth | null;
  exam_time_left: string | null;
  // Quiz branch
  quiz_topic: string | null;
  quiz_num_questions: number | null;
  quiz_type: QuizType | null;
  quiz_hints_allowed: boolean | null;
  // Meta
  onboarding_complete: boolean;
  created_at: string;
}

export interface Knowledge {
  id: number;
  subject: string;
  topic: string;
  mastery_level: number;
  confidence: number;
  times_studied: number;
  times_quizzed: number;
  last_studied: string | null;
  last_quizzed: string | null;
  weak_areas: string | null; // JSON array
  notes: string | null;
  created_at: string;
}

export interface QuizResult {
  subject: string;
  topic?: string;
  quizType: QuizType;
  score: number;
  totalQuestions: number;
  correctAnswers: number;
  missedConcepts: string[];
  timeSpentSeconds?: number;
  hintsUsed?: number;
}

export interface QuizHistory {
  id: number;
  subject: string;
  topic: string | null;
  quiz_type: QuizType | null;
  score: number;
  total_questions: number;
  correct_answers: number;
  missed_concepts: string | null; // JSON array
  time_spent_seconds: number | null;
  hints_used: number;
  quiz_date: string;
}

export interface QuizStats {
  totalQuizzes: number;
  averageScore: number;
  totalQuestions: number;
  totalCorrect: number;
  bestScore: number;
  worstScore: number;
  recentScores: number[]; // Last 5 quiz scores
  mostMissedConcepts: string[]; // Aggregated from missed_concepts
}

export interface StudySession {
  id: number;
  session_type: SessionType;
  subject: string | null;
  topic: string | null;
  duration_minutes: number | null;
  summary: string | null;
  started_at: string;
  ended_at: string | null;
}
