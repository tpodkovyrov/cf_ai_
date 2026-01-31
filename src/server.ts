import { routeAgentRequest, type Schedule } from "agents";

import { getSchedulePrompt } from "agents/schedule";

import { AIChatAgent } from "@cloudflare/ai-chat";
import type { UserProfile, LearningMethod, SessionPreferences, Knowledge, QuizResult, QuizHistory, QuizStats } from "./types";
import { Goal, ExamDepth, QuizType } from "./types";
import {
  generateId,
  streamText,
  type StreamTextOnFinishCallback,
  stepCountIs,
  createUIMessageStream,
  convertToModelMessages,
  createUIMessageStreamResponse,
  type ToolSet
} from "ai";
// OpenAI import removed - using free Cloudflare Workers AI instead
import { processToolCalls, cleanupMessages } from "./utils";
import { tools, executions } from "./tools";
import { createWorkersAI } from "workers-ai-provider";
import {
  CLASSIFIER_SYSTEM,
  CLASSIFIER_CONTEXT_TEMPLATE,
  CLASSIFIER_USER_TEMPLATE,
  PLAN_GENERATOR_SYSTEM,
  PLAN_GENERATOR_USER_TEMPLATE,
  PROCESS_STEP_SYSTEM_TEMPLATE,
  KNOWLEDGE_INFER_SYSTEM,
  KNOWLEDGE_INFER_USER_TEMPLATE,
  MAIN_SYSTEM_TEMPLATE,
  MISSING_PROFILE_LINE_TEMPLATE,
  KNOWLEDGE_NONE_YET,
  WEAK_AREAS_NONE,
  RECENT_QUIZZES_NONE,
  RECENT_QUIZZES_LINE_TEMPLATE,
  ACKNOWLEDGMENT_TEMPLATE,
  TRACKING_MESSAGE_ADDED,
  TRACKING_MESSAGE_WHAT_NEXT,
  TRACKING_MESSAGE_EXPLAIN_MORE,
  GENERAL_QUESTION_SYSTEM,
  TEST_MAX_TOKENS_USER
} from "./prompts";

// Use Cloudflare Workers AI (FREE) instead of OpenAI
// Available models: 
// - @cf/meta/llama-3.1-8b-instruct (fast, good for most tasks)
// - @cf/meta/llama-3.3-70b-instruct-fp8-fast (smarter, larger)
// - @cf/deepseek-ai/deepseek-r1-distill-qwen-32b (reasoning)

// Note: We'll initialize the model inside the class to access env.AI

/**
 * Chat Agent implementation that handles real-time AI chat interactions
 */
export class Chat extends AIChatAgent<Env> {
  // ============ PLAN PROCESSING STATE ============
  // State management for recursive sequential chunking (plan-then-execute)
  
  /** The plan steps generated from user's prompt */
  private planSteps: string[] = [];
  
  /** Results accumulated from processing each step */
  private stepResults: string[] = [];
  
  /** The user's original question/prompt being processed */
  private originalPrompt: string = "";
  
  /** Flag indicating if we're currently processing a multi-step plan */
  private isProcessingPlan: boolean = false;

  /**
   * Initialize database tables with CHECK constraints for enum validation.
   * Called automatically when the Durable Object is created.
   */
  initTables() {
    // 1. User profile - stores user info and learning preferences
    this.sql`CREATE TABLE IF NOT EXISTS user_profile (
      id INTEGER PRIMARY KEY DEFAULT 1,
      name TEXT,
      major TEXT,
      year TEXT,
      preferred_learning_methods TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      last_active DATETIME DEFAULT CURRENT_TIMESTAMP
    )`;

    // 2. Session preferences - stores current session goals and settings
    this.sql`CREATE TABLE IF NOT EXISTS session_preferences (
      id INTEGER PRIMARY KEY DEFAULT 1,
      goal TEXT CHECK(goal IN ('learn', 'exam', 'quiz')),
      learn_topic TEXT,
      learn_concept TEXT,
      exam_name TEXT,
      exam_depth TEXT CHECK(exam_depth IN ('overview', 'moderate', 'deep')),
      exam_time_left TEXT,
      quiz_topic TEXT,
      quiz_num_questions INTEGER,
      quiz_type TEXT CHECK(quiz_type IN ('multiple_choice', 'free_response', 'mixed')),
      quiz_hints_allowed BOOLEAN,
      onboarding_complete BOOLEAN DEFAULT FALSE,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP
    )`;

    // 3. Knowledge - tracks mastery of subjects/topics
    this.sql`CREATE TABLE IF NOT EXISTS knowledge (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      topic TEXT NOT NULL,
      mastery_level INTEGER DEFAULT 0 CHECK(mastery_level >= 0 AND mastery_level <= 100),
      confidence INTEGER DEFAULT 0 CHECK(confidence >= 0 AND confidence <= 100),
      times_studied INTEGER DEFAULT 0,
      times_quizzed INTEGER DEFAULT 0,
      last_studied DATETIME,
      last_quizzed DATETIME,
      weak_areas TEXT,
      notes TEXT,
      created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      UNIQUE(subject, topic)
    )`;

    // 4. Quiz history - records all quiz attempts and results
    this.sql`CREATE TABLE IF NOT EXISTS quiz_history (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      subject TEXT NOT NULL,
      topic TEXT,
      quiz_type TEXT CHECK(quiz_type IN ('multiple_choice', 'free_response', 'mixed')),
      score INTEGER NOT NULL CHECK(score >= 0 AND score <= 100),
      total_questions INTEGER NOT NULL,
      correct_answers INTEGER NOT NULL,
      missed_concepts TEXT,
      time_spent_seconds INTEGER,
      hints_used INTEGER DEFAULT 0,
      quiz_date DATETIME DEFAULT CURRENT_TIMESTAMP
    )`;

    // 5. Study sessions - logs study session activity
    this.sql`CREATE TABLE IF NOT EXISTS study_sessions (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      session_type TEXT NOT NULL CHECK(session_type IN ('learn', 'review', 'quiz', 'exam_prep')),
      subject TEXT,
      topic TEXT,
      duration_minutes INTEGER,
      summary TEXT,
      started_at DATETIME DEFAULT CURRENT_TIMESTAMP,
      ended_at DATETIME
    )`;
  }

  // ============ USER PROFILE METHODS ============

  /**
   * Retrieves the user profile from the database.
   * @returns The user profile or null if not found
   */
  getUserProfile(): UserProfile | null {
    const result = this.sql<UserProfile>`SELECT * FROM user_profile WHERE id = 1`;
    return result[0] || null;
  }

  /**
   * Updates or creates the user profile with the provided data.
   * Supports JSON storage for preferred learning methods.
   * @param data - Partial user profile data to update
   */
  updateUserProfile(data: {
    name?: string;
    major?: string;
    year?: string;
    preferredLearningMethods?: LearningMethod[];
  }): void {
    const existing = this.getUserProfile();
    
    if (!existing) {
      // Create new profile if none exists
      this.sql`INSERT INTO user_profile (id, name, major, year, preferred_learning_methods)
               VALUES (1, ${data.name ?? null}, ${data.major ?? null}, ${data.year ?? null}, ${data.preferredLearningMethods ? JSON.stringify(data.preferredLearningMethods) : null})`;
    } else {
      // Update existing profile fields
      if (data.name !== undefined) {
        this.sql`UPDATE user_profile SET name = ${data.name} WHERE id = 1`;
      }
      if (data.major !== undefined) {
        this.sql`UPDATE user_profile SET major = ${data.major} WHERE id = 1`;
      }
      if (data.year !== undefined) {
        this.sql`UPDATE user_profile SET year = ${data.year} WHERE id = 1`;
      }
      if (data.preferredLearningMethods !== undefined) {
        this.sql`UPDATE user_profile SET preferred_learning_methods = ${JSON.stringify(data.preferredLearningMethods)} WHERE id = 1`;
      }
    }
    
    // Always update last_active timestamp
    this.sql`UPDATE user_profile SET last_active = CURRENT_TIMESTAMP WHERE id = 1`;
  }

  // ============ SESSION PREFERENCES METHODS ============

  /**
   * Retrieves the session preferences from the database.
   * @returns The session preferences or null if not found
   */
  getSessionPreferences(): SessionPreferences | null {
    const result = this.sql<SessionPreferences>`SELECT * FROM session_preferences WHERE id = 1`;
    return result[0] || null;
  }

  /**
   * Updates or creates session preferences with enum validation.
   * Validates goal, examDepth, and quizType against their respective enums.
   * @param data - Partial session preferences data to update
   * @throws Error if enum values are invalid
   */
  updateSessionPreferences(data: {
    goal?: string;
    learnTopic?: string;
    learnConcept?: string;
    examName?: string;
    examDepth?: string;
    examTimeLeft?: string;
    quizTopic?: string;
    quizNumQuestions?: number;
    quizType?: string;
    quizHintsAllowed?: boolean;
    onboardingComplete?: boolean;
  }): void {
    // Validate enum values before saving
    if (data.goal !== undefined && data.goal !== null) {
      const validGoals = Object.values(Goal);
      if (!validGoals.includes(data.goal as Goal)) {
        throw new Error(`Invalid goal: ${data.goal}. Must be one of: ${validGoals.join(", ")}`);
      }
    }

    if (data.examDepth !== undefined && data.examDepth !== null) {
      const validDepths = Object.values(ExamDepth);
      if (!validDepths.includes(data.examDepth as ExamDepth)) {
        throw new Error(`Invalid examDepth: ${data.examDepth}. Must be one of: ${validDepths.join(", ")}`);
      }
    }

    if (data.quizType !== undefined && data.quizType !== null) {
      const validTypes = Object.values(QuizType);
      if (!validTypes.includes(data.quizType as QuizType)) {
        throw new Error(`Invalid quizType: ${data.quizType}. Must be one of: ${validTypes.join(", ")}`);
      }
    }

    const existing = this.getSessionPreferences();

    if (!existing) {
      // Create new session preferences if none exists
      this.sql`INSERT INTO session_preferences (
        id,
        goal,
        learn_topic,
        learn_concept,
        exam_name,
        exam_depth,
        exam_time_left,
        quiz_topic,
        quiz_num_questions,
        quiz_type,
        quiz_hints_allowed,
        onboarding_complete
      ) VALUES (
        1,
        ${data.goal ?? null},
        ${data.learnTopic ?? null},
        ${data.learnConcept ?? null},
        ${data.examName ?? null},
        ${data.examDepth ?? null},
        ${data.examTimeLeft ?? null},
        ${data.quizTopic ?? null},
        ${data.quizNumQuestions ?? null},
        ${data.quizType ?? null},
        ${data.quizHintsAllowed ?? null},
        ${data.onboardingComplete ?? false}
      )`;
    } else {
      // Update existing session preferences fields
      if (data.goal !== undefined) {
        this.sql`UPDATE session_preferences SET goal = ${data.goal} WHERE id = 1`;
      }
      if (data.learnTopic !== undefined) {
        this.sql`UPDATE session_preferences SET learn_topic = ${data.learnTopic} WHERE id = 1`;
      }
      if (data.learnConcept !== undefined) {
        this.sql`UPDATE session_preferences SET learn_concept = ${data.learnConcept} WHERE id = 1`;
      }
      if (data.examName !== undefined) {
        this.sql`UPDATE session_preferences SET exam_name = ${data.examName} WHERE id = 1`;
      }
      if (data.examDepth !== undefined) {
        this.sql`UPDATE session_preferences SET exam_depth = ${data.examDepth} WHERE id = 1`;
      }
      if (data.examTimeLeft !== undefined) {
        this.sql`UPDATE session_preferences SET exam_time_left = ${data.examTimeLeft} WHERE id = 1`;
      }
      if (data.quizTopic !== undefined) {
        this.sql`UPDATE session_preferences SET quiz_topic = ${data.quizTopic} WHERE id = 1`;
      }
      if (data.quizNumQuestions !== undefined) {
        this.sql`UPDATE session_preferences SET quiz_num_questions = ${data.quizNumQuestions} WHERE id = 1`;
      }
      if (data.quizType !== undefined) {
        this.sql`UPDATE session_preferences SET quiz_type = ${data.quizType} WHERE id = 1`;
      }
      if (data.quizHintsAllowed !== undefined) {
        this.sql`UPDATE session_preferences SET quiz_hints_allowed = ${data.quizHintsAllowed} WHERE id = 1`;
      }
      if (data.onboardingComplete !== undefined) {
        this.sql`UPDATE session_preferences SET onboarding_complete = ${data.onboardingComplete} WHERE id = 1`;
      }
    }
  }

  // ============ KNOWLEDGE METHODS ============

  /**
   * Retrieves all knowledge entries from the database.
   * @returns Array of all knowledge entries
   */
  getKnowledge(): Knowledge[] {
    return this.sql<Knowledge>`SELECT * FROM knowledge ORDER BY last_studied DESC`;
  }

  /**
   * Retrieves knowledge entries filtered by subject.
   * @param subject - The subject to filter by
   * @returns Array of knowledge entries for the given subject
   */
  getKnowledgeBySubject(subject: string): Knowledge[] {
    return this.sql<Knowledge>`SELECT * FROM knowledge WHERE subject = ${subject} ORDER BY topic ASC`;
  }

  /**
   * Retrieves the mastery level for a specific subject/topic combination.
   * @param subject - The subject
   * @param topic - The topic within the subject
   * @returns The knowledge entry or null if not found
   */
  getTopicMastery(subject: string, topic: string): Knowledge | null {
    const result = this.sql<Knowledge>`SELECT * FROM knowledge WHERE subject = ${subject} AND topic = ${topic}`;
    return result[0] || null;
  }

  /**
   * Updates or creates a knowledge entry (upsert pattern).
   * Uses UNIQUE(subject, topic) constraint for conflict resolution.
   * @param data - Knowledge data to update or insert
   */
  updateKnowledge(data: {
    subject: string;
    topic: string;
    masteryLevel?: number;
    confidence?: number;
    timesStudied?: number;
    timesQuizzed?: number;
    lastStudied?: boolean; // If true, sets last_studied to CURRENT_TIMESTAMP
    lastQuizzed?: boolean; // If true, sets last_quizzed to CURRENT_TIMESTAMP
    weakAreas?: string[]; // JSON array of weak areas
    notes?: string;
  }): void {
    const existing = this.getTopicMastery(data.subject, data.topic);

    if (!existing) {
      // Create new knowledge entry
      this.sql`INSERT INTO knowledge (
        subject,
        topic,
        mastery_level,
        confidence,
        times_studied,
        times_quizzed,
        last_studied,
        last_quizzed,
        weak_areas,
        notes
      ) VALUES (
        ${data.subject},
        ${data.topic},
        ${data.masteryLevel ?? 0},
        ${data.confidence ?? 0},
        ${data.timesStudied ?? 0},
        ${data.timesQuizzed ?? 0},
        ${data.lastStudied ? new Date().toISOString() : null},
        ${data.lastQuizzed ? new Date().toISOString() : null},
        ${data.weakAreas ? JSON.stringify(data.weakAreas) : null},
        ${data.notes ?? null}
      )`;
    } else {
      // Update existing knowledge entry
      if (data.masteryLevel !== undefined) {
        this.sql`UPDATE knowledge SET mastery_level = ${data.masteryLevel} WHERE subject = ${data.subject} AND topic = ${data.topic}`;
      }
      if (data.confidence !== undefined) {
        this.sql`UPDATE knowledge SET confidence = ${data.confidence} WHERE subject = ${data.subject} AND topic = ${data.topic}`;
      }
      if (data.timesStudied !== undefined) {
        this.sql`UPDATE knowledge SET times_studied = ${data.timesStudied} WHERE subject = ${data.subject} AND topic = ${data.topic}`;
      }
      if (data.timesQuizzed !== undefined) {
        this.sql`UPDATE knowledge SET times_quizzed = ${data.timesQuizzed} WHERE subject = ${data.subject} AND topic = ${data.topic}`;
      }
      if (data.lastStudied) {
        this.sql`UPDATE knowledge SET last_studied = CURRENT_TIMESTAMP WHERE subject = ${data.subject} AND topic = ${data.topic}`;
      }
      if (data.lastQuizzed) {
        this.sql`UPDATE knowledge SET last_quizzed = CURRENT_TIMESTAMP WHERE subject = ${data.subject} AND topic = ${data.topic}`;
      }
      if (data.weakAreas !== undefined) {
        this.sql`UPDATE knowledge SET weak_areas = ${JSON.stringify(data.weakAreas)} WHERE subject = ${data.subject} AND topic = ${data.topic}`;
      }
      if (data.notes !== undefined) {
        this.sql`UPDATE knowledge SET notes = ${data.notes} WHERE subject = ${data.subject} AND topic = ${data.topic}`;
      }
    }
  }

  /**
   * Retrieves knowledge entries that need review (weak areas).
   * Returns entries with low mastery (< 60%) or low confidence (< 50%).
   * @param limit - Maximum number of entries to return (default: 10)
   * @returns Array of knowledge entries that need review
   */
  getWeakAreas(limit: number = 10): Knowledge[] {
    return this.sql<Knowledge>`
      SELECT * FROM knowledge 
      WHERE mastery_level < 60 OR confidence < 50
      ORDER BY mastery_level ASC, confidence ASC
      LIMIT ${limit}
    `;
  }

  // ============ QUIZ METHODS ============

  /**
   * Records a quiz result to the quiz_history table.
   * Also updates the knowledge table with quiz performance.
   * @param data - The quiz result data to record
   * @returns The ID of the inserted quiz record
   */
  recordQuiz(data: QuizResult): number {
    // Validate quiz type enum
    const validTypes = Object.values(QuizType);
    if (!validTypes.includes(data.quizType)) {
      throw new Error(`Invalid quizType: ${data.quizType}. Must be one of: ${validTypes.join(", ")}`);
    }

    // Insert quiz result into quiz_history
    this.sql`INSERT INTO quiz_history (
      subject,
      topic,
      quiz_type,
      score,
      total_questions,
      correct_answers,
      missed_concepts,
      time_spent_seconds,
      hints_used
    ) VALUES (
      ${data.subject},
      ${data.topic ?? null},
      ${data.quizType},
      ${data.score},
      ${data.totalQuestions},
      ${data.correctAnswers},
      ${data.missedConcepts.length > 0 ? JSON.stringify(data.missedConcepts) : null},
      ${data.timeSpentSeconds ?? null},
      ${data.hintsUsed ?? 0}
    )`;

    // Get the ID of the inserted record
    const lastId = this.sql<{ id: number }>`SELECT last_insert_rowid() as id`;
    const insertedId = lastId[0]?.id ?? 0;

    // Update knowledge table with quiz performance
    if (data.topic) {
      const existing = this.getTopicMastery(data.subject, data.topic);
      if (existing) {
        // Update existing knowledge entry
        const newTimesQuizzed = existing.times_quizzed + 1;
        // Update mastery based on weighted average of old mastery and new score
        const newMastery = Math.round((existing.mastery_level * 0.7) + (data.score * 0.3));
        
        // Merge weak areas
        const existingWeakAreas: string[] = existing.weak_areas ? JSON.parse(existing.weak_areas) : [];
        const mergedWeakAreas = [...new Set([...existingWeakAreas, ...data.missedConcepts])];
        
        this.updateKnowledge({
          subject: data.subject,
          topic: data.topic,
          masteryLevel: Math.min(100, Math.max(0, newMastery)),
          timesQuizzed: newTimesQuizzed,
          lastQuizzed: true,
          weakAreas: mergedWeakAreas
        });
      } else {
        // Create new knowledge entry
        this.updateKnowledge({
          subject: data.subject,
          topic: data.topic,
          masteryLevel: data.score,
          timesQuizzed: 1,
          lastQuizzed: true,
          weakAreas: data.missedConcepts
        });
      }
    }

    return insertedId;
  }

  /**
   * Retrieves quiz history, optionally filtered by subject.
   * @param subject - Optional subject to filter by
   * @param limit - Maximum number of records to return (default: 20)
   * @returns Array of quiz history records, ordered by most recent first
   */
  getQuizHistory(subject?: string, limit: number = 20): QuizHistory[] {
    if (subject) {
      return this.sql<QuizHistory>`
        SELECT * FROM quiz_history 
        WHERE subject = ${subject}
        ORDER BY quiz_date DESC
        LIMIT ${limit}
      `;
    }
    return this.sql<QuizHistory>`
      SELECT * FROM quiz_history 
      ORDER BY quiz_date DESC
      LIMIT ${limit}
    `;
  }

  /**
   * Calculates aggregate statistics for quiz performance.
   * @param subject - Optional subject to filter stats by
   * @returns Quiz statistics including averages, totals, and trends
   */
  getQuizStats(subject?: string): QuizStats {
    // Get aggregate stats
    type AggregateRow = {
      total_quizzes: number;
      avg_score: number;
      total_questions: number;
      total_correct: number;
      best_score: number;
      worst_score: number;
    };

    let aggregates: AggregateRow[];
    if (subject) {
      aggregates = this.sql<AggregateRow>`
        SELECT 
          COUNT(*) as total_quizzes,
          COALESCE(AVG(score), 0) as avg_score,
          COALESCE(SUM(total_questions), 0) as total_questions,
          COALESCE(SUM(correct_answers), 0) as total_correct,
          COALESCE(MAX(score), 0) as best_score,
          COALESCE(MIN(score), 0) as worst_score
        FROM quiz_history
        WHERE subject = ${subject}
      `;
    } else {
      aggregates = this.sql<AggregateRow>`
        SELECT 
          COUNT(*) as total_quizzes,
          COALESCE(AVG(score), 0) as avg_score,
          COALESCE(SUM(total_questions), 0) as total_questions,
          COALESCE(SUM(correct_answers), 0) as total_correct,
          COALESCE(MAX(score), 0) as best_score,
          COALESCE(MIN(score), 0) as worst_score
        FROM quiz_history
      `;
    }

    const stats = aggregates[0] || {
      total_quizzes: 0,
      avg_score: 0,
      total_questions: 0,
      total_correct: 0,
      best_score: 0,
      worst_score: 0
    };

    // Get recent scores (last 5 quizzes)
    type ScoreRow = { score: number };
    let recentScores: ScoreRow[];
    if (subject) {
      recentScores = this.sql<ScoreRow>`
        SELECT score FROM quiz_history
        WHERE subject = ${subject}
        ORDER BY quiz_date DESC
        LIMIT 5
      `;
    } else {
      recentScores = this.sql<ScoreRow>`
        SELECT score FROM quiz_history
        ORDER BY quiz_date DESC
        LIMIT 5
      `;
    }

    // Get all missed concepts to find the most common ones
    type MissedConceptsRow = { missed_concepts: string | null };
    let missedConceptsRows: MissedConceptsRow[];
    if (subject) {
      missedConceptsRows = this.sql<MissedConceptsRow>`
        SELECT missed_concepts FROM quiz_history
        WHERE subject = ${subject} AND missed_concepts IS NOT NULL
        ORDER BY quiz_date DESC
        LIMIT 10
      `;
    } else {
      missedConceptsRows = this.sql<MissedConceptsRow>`
        SELECT missed_concepts FROM quiz_history
        WHERE missed_concepts IS NOT NULL
        ORDER BY quiz_date DESC
        LIMIT 10
      `;
    }

    // Aggregate missed concepts and count occurrences
    const conceptCounts: Record<string, number> = {};
    for (const row of missedConceptsRows) {
      if (row.missed_concepts) {
        try {
          const concepts: string[] = JSON.parse(row.missed_concepts);
          for (const concept of concepts) {
            conceptCounts[concept] = (conceptCounts[concept] || 0) + 1;
          }
        } catch {
          // Skip malformed JSON
        }
      }
    }

    // Sort by frequency and take top 5
    const sortedConcepts = Object.entries(conceptCounts)
      .sort((a, b) => b[1] - a[1])
      .slice(0, 5)
      .map(([concept]) => concept);

    return {
      totalQuizzes: stats.total_quizzes,
      averageScore: Math.round(stats.avg_score),
      totalQuestions: stats.total_questions,
      totalCorrect: stats.total_correct,
      bestScore: stats.best_score,
      worstScore: stats.worst_score,
      recentScores: recentScores.map(r => r.score),
      mostMissedConcepts: sortedConcepts
    };
  }

  // ============ STUDY SESSION METHODS ============

  /**
   * Starts a new study session and returns its ID.
   * @param sessionType - The type of session (learn, review, quiz, exam_prep)
   * @param subject - Optional subject being studied
   * @param topic - Optional topic being studied
   * @returns The ID of the created session
   */
  startSession(sessionType: string, subject?: string, topic?: string): number {
    // Validate session type enum
    const validTypes = ['learn', 'review', 'quiz', 'exam_prep'];
    if (!validTypes.includes(sessionType)) {
      throw new Error(`Invalid sessionType: ${sessionType}. Must be one of: ${validTypes.join(", ")}`);
    }

    this.sql`INSERT INTO study_sessions (session_type, subject, topic)
             VALUES (${sessionType}, ${subject ?? null}, ${topic ?? null})`;
    
    const result = this.sql<{ id: number }>`SELECT last_insert_rowid() as id`;
    return result[0]?.id ?? 0;
  }

  /**
   * Ends a study session by setting the end time and summary.
   * Also calculates the duration based on start and end times.
   * @param sessionId - The ID of the session to end
   * @param summary - A summary of what was covered in the session
   */
  endSession(sessionId: number, summary: string): void {
    this.sql`UPDATE study_sessions 
             SET ended_at = CURRENT_TIMESTAMP,
                 summary = ${summary},
                 duration_minutes = CAST((JULIANDAY(CURRENT_TIMESTAMP) - JULIANDAY(started_at)) * 1440 AS INTEGER)
             WHERE id = ${sessionId}`;
  }

  /**
   * Gets statistics about study sessions.
   * @returns Object containing total time, session counts by type, and recent sessions
   */
  getStudyStats(): {
    totalMinutes: number;
    sessionsByType: Record<string, { count: number; totalMinutes: number }>;
    recentSessions: Array<{ session_type: string; subject: string | null; duration_minutes: number | null; started_at: string }>;
  } {
    // Get total time studied
    type TotalRow = { total_minutes: number };
    const totalResult = this.sql<TotalRow>`
      SELECT COALESCE(SUM(duration_minutes), 0) as total_minutes
      FROM study_sessions
      WHERE ended_at IS NOT NULL
    `;
    const totalMinutes = totalResult[0]?.total_minutes ?? 0;

    // Get breakdown by session type
    type TypeRow = { session_type: string; count: number; total_minutes: number };
    const typeResults = this.sql<TypeRow>`
      SELECT session_type, COUNT(*) as count, COALESCE(SUM(duration_minutes), 0) as total_minutes
      FROM study_sessions
      WHERE ended_at IS NOT NULL
      GROUP BY session_type
    `;

    const sessionsByType: Record<string, { count: number; totalMinutes: number }> = {};
    for (const row of typeResults) {
      sessionsByType[row.session_type] = {
        count: row.count,
        totalMinutes: row.total_minutes
      };
    }

    // Get recent sessions
    type RecentRow = { session_type: string; subject: string | null; duration_minutes: number | null; started_at: string };
    const recentSessions = this.sql<RecentRow>`
      SELECT session_type, subject, duration_minutes, started_at
      FROM study_sessions
      ORDER BY started_at DESC
      LIMIT 5
    `;

    return {
      totalMinutes,
      sessionsByType,
      recentSessions
    };
  }

  // ============ RESET METHODS ============

  /**
   * Resets user progress based on the specified type.
   * @param resetType - What to reset: 'all', 'knowledge', 'quizzes', or 'sessions'
   */
  resetProgress(resetType: string): void {
    const validTypes = ['all', 'knowledge', 'quizzes', 'sessions'];
    if (!validTypes.includes(resetType)) {
      throw new Error(`Invalid resetType: ${resetType}. Must be one of: ${validTypes.join(", ")}`);
    }

    if (resetType === 'all' || resetType === 'knowledge') {
      this.sql`DELETE FROM knowledge`;
    }
    if (resetType === 'all' || resetType === 'quizzes') {
      this.sql`DELETE FROM quiz_history`;
    }
    if (resetType === 'all' || resetType === 'sessions') {
      this.sql`DELETE FROM study_sessions`;
    }
    if (resetType === 'all') {
      this.sql`DELETE FROM user_profile`;
      this.sql`DELETE FROM session_preferences`;
    }
  }

  // ============ CONTEXT METHODS ============

  // ============ PLAN PROCESSING METHODS ============

  /**
   * Asks the AI whether the user message is conversational/social or a learning request.
   * Used to route: CONVERSATIONAL → simple flow (one reply + tools); LEARNING → plan flow.
   * Pass lastAssistantMessage when the user message might be a follow-up (e.g. "computer science" after "what is your major?").
   */
  private async classifyIntent(prompt: string, lastAssistantMessage?: string): Promise<"CONVERSATIONAL" | "LEARNING"> {
    const trimmed = prompt.trim();
    if (trimmed.length === 0) return "CONVERSATIONAL";
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/f7f750ff-d56d-4fc6-a13a-a716cd0ba684", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "server.ts:classifyIntent", message: "classifyIntent input", data: { prompt: trimmed.substring(0, 120), lastAssistantMessage: lastAssistantMessage?.substring(0, 120) }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H3" }) }).catch(() => {});
    // #endregion
    try {
      const contextLine = lastAssistantMessage ? CLASSIFIER_CONTEXT_TEMPLATE(lastAssistantMessage) : "";
      const result = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [{
          role: "system",
          content: CLASSIFIER_SYSTEM
        }, {
          role: "user",
          content: CLASSIFIER_USER_TEMPLATE({
            contextLine,
            userMessage: trimmed.substring(0, 300)
          })
        }],
        max_tokens: 20
      });
      const raw = (result as { response?: string })?.response ?? (result as { result?: string })?.result ?? (typeof result === "string" ? result : "");
      const word = raw.trim().toUpperCase().split(/\s+/)[0];
      const intent = word === "LEARNING" ? "LEARNING" : "CONVERSATIONAL";
      // #region agent log
      fetch("http://127.0.0.1:7242/ingest/f7f750ff-d56d-4fc6-a13a-a716cd0ba684", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "server.ts:classifyIntent", message: "classifyIntent result", data: { prompt: trimmed.substring(0, 80), intent, raw: raw.substring(0, 50) }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H3" }) }).catch(() => {});
      // #endregion
      return intent;
    } catch {
      // default to conversational on error
    }
    return "CONVERSATIONAL";
  }

  /**
   * Generates a plan with up to 10 steps for answering any prompt.
   * For simple questions, returns a single step. For complex topics,
   * breaks them down into logical sub-questions/tasks.
   * @param prompt - The user's original question/request
   * @returns Array of step descriptions (1-10 steps)
   */
  async generatePlan(prompt: string): Promise<string[]> {
    const result = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [{
        role: "system",
        content: PLAN_GENERATOR_SYSTEM
      }, {
        role: "user",
        content: PLAN_GENERATOR_USER_TEMPLATE(prompt)
      }],
      max_tokens: 1024
    });

    // Debug: log the actual response structure
    console.log("[generatePlan] Raw result:", JSON.stringify(result));

    // Handle different response formats from Cloudflare AI
    if (result && typeof result === "object") {
      const r = result as Record<string, unknown>;
      
      // Case 1: response is already an array (most common for this prompt)
      if (Array.isArray(r.response)) {
        console.log("[generatePlan] response is already an array with", r.response.length, "steps");
        return (r.response as string[]).slice(0, 10);
      }
      
      // Case 2: response is a string that needs parsing
      if (typeof r.response === "string") {
        console.log("[generatePlan] response is a string, attempting to parse");
        return this.parseStepsFromString(r.response, prompt);
      }
      
      // Case 3: result field instead of response
      if (Array.isArray(r.result)) {
        console.log("[generatePlan] result is already an array with", r.result.length, "steps");
        return (r.result as string[]).slice(0, 10);
      }
      
      if (typeof r.result === "string") {
        console.log("[generatePlan] result is a string, attempting to parse");
        return this.parseStepsFromString(r.result, prompt);
      }
    }
    
    // Case 4: result is a string directly
    if (typeof result === "string") {
      console.log("[generatePlan] result is a string directly, attempting to parse");
      return this.parseStepsFromString(result, prompt);
    }

    // Fallback
    console.log("[generatePlan] Could not extract steps, falling back to single step");
    return [prompt];
  }

  /**
   * Helper to parse steps from a string response
   */
  private parseStepsFromString(text: string, fallbackPrompt: string): string[] {
    try {
      // Try to parse as JSON array directly
      const parsed = JSON.parse(text);
      if (Array.isArray(parsed)) {
        console.log("[parseStepsFromString] Parsed as array with", parsed.length, "steps");
        return parsed.slice(0, 10);
      }
    } catch {
      // If parsing fails, try to extract JSON array from the text
      const jsonMatch = text.match(/\[[\s\S]*?\]/);
      if (jsonMatch) {
        try {
          const parsed = JSON.parse(jsonMatch[0]);
          if (Array.isArray(parsed)) {
            console.log("[parseStepsFromString] Extracted array with", parsed.length, "steps");
            return parsed.slice(0, 10);
          }
        } catch {
          // Fall through
        }
      }
    }
    console.log("[parseStepsFromString] Could not parse, falling back to single step");
    return [fallbackPrompt];
  }

  /**
   * Processes a single step of the plan and returns the result.
   * Each step is processed with context about the original prompt.
   * @param step - The step description to process
   * @param stepIndex - The index of this step (0-based)
   * @returns The AI's response for this step
   */
  async processStep(step: string, stepIndex: number): Promise<string> {
    const result = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [{
        role: "system",
        content: PROCESS_STEP_SYSTEM_TEMPLATE({
          stepIndex: stepIndex + 1,
          totalSteps: this.planSteps.length,
          originalPrompt: this.originalPrompt,
          previousStepsList: stepIndex > 0 ? this.planSteps.slice(0, stepIndex).join(", ") : ""
        })
      }, {
        role: "user",
        content: step
      }],
      max_tokens: 1024
    });

    // Extract the response text - handle different response formats
    let responseText = "";
    if (typeof result === "string") {
      responseText = result;
    } else if (result && typeof result === "object") {
      const r = result as Record<string, unknown>;
      if (typeof r.response === "string") {
        responseText = r.response;
      } else if (typeof r.result === "string") {
        responseText = r.result;
      } else if (typeof r.text === "string") {
        responseText = r.text;
      } else {
        responseText = JSON.stringify(result);
      }
    }

    console.log(`[processStep] Step ${stepIndex + 1} response length:`, responseText.length);
    return responseText;
  }

  /**
   * Extracts a general topic from a user prompt for knowledge tracking.
   * Supports any subject/topic — no hardcoded domains. The knowledge graph
   * can hold anything (e.g. binary trees, shortest path, history, etc.).
   * @param prompt - The user's original question/request
   * @returns Object with subject "General" and cleaned topic, or null if empty
   */
  private extractTopicFromPrompt(prompt: string): { subject: string; topic: string } | null {
    const topic = prompt
      .replace(/^(explain|what is|what are|how does|how do|tell me about|teach me|describe|define|help me understand)\s*/i, "")
      .replace(/\s*(work|works|in detail|fully|please|for me|to me|step by step).*$/i, "")
      .replace(/\s*\?+$/, "")
      .trim();

    if (!topic || topic.length < 2) return null;
    return { subject: "General", topic };
  }

  /**
   * Asks the AI to infer subject and topic for the knowledge graph from the user's prompt.
   * Lets the AI decide how to label the node (e.g. "Data Structures" > "Binary Trees",
   * "Algorithms" > "Shortest Path") so the graph stays general and AI-driven.
   * @param prompt - The user's original question/request
   * @returns AI-suggested { subject, topic } or null on failure
   */
  /**
   * Answers a general question (weather, facts, small talk) by calling the AI without tools.
   * Used when no other tool fits - the model answers naturally instead of refusing.
   */
  async answerGeneralQuestion(question: string): Promise<string> {
    const result = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
      messages: [
        { role: "system", content: GENERAL_QUESTION_SYSTEM },
        { role: "user", content: question }
      ],
      max_tokens: 1024
    });
    const response = (result as { response?: string })?.response ?? (result as { result?: string })?.result ?? (typeof result === "string" ? result : "");
    return typeof response === "string" ? response : String(response);
  }

  private async inferSubjectTopicFromAI(prompt: string): Promise<{ subject: string; topic: string } | null> {
    try {
      const result = await this.env.AI.run("@cf/meta/llama-3.3-70b-instruct-fp8-fast", {
        messages: [{
          role: "system",
          content: KNOWLEDGE_INFER_SYSTEM
        }, {
          role: "user",
          content: KNOWLEDGE_INFER_USER_TEMPLATE(prompt.substring(0, 300))
        }],
        max_tokens: 80
      });

      const raw = (result as { response?: string })?.response ?? (result as { result?: string })?.result ?? (typeof result === "string" ? result : "");
      const jsonMatch = raw.match(/\{[\s\S]*?\}/);
      if (!jsonMatch) return null;

      const parsed = JSON.parse(jsonMatch[0]) as { subject?: string; topic?: string };
      if (typeof parsed?.subject === "string" && typeof parsed?.topic === "string") {
        return { subject: parsed.subject.trim(), topic: parsed.topic.trim() };
      }
    } catch {
      // Fall through to general extraction
    }
    return null;
  }

  /**
   * Combines all step results into a final formatted response.
   * Called after all plan steps have been processed.
   * Also auto-tracks the topic in the knowledge graph at 50% mastery.
   */
  async outputCombinedResult(): Promise<void> {
    // Combine all step results into final response
    const combined = this.planSteps.map((step, i) => {
      const cleanStep = step.replace(/^Step \d+:\s*/i, '');
      return `### ${cleanStep}\n${this.stepResults[i]}`;
    }).join('\n\n');

    // Auto-track this topic in knowledge graph at 50% mastery (plan flow = LEARNING only).
    const topicInfo =
      (await this.inferSubjectTopicFromAI(this.originalPrompt)) ??
      this.extractTopicFromPrompt(this.originalPrompt);
    let trackingMessage = "";

    if (topicInfo) {
      this.updateKnowledge({
        subject: topicInfo.subject,
        topic: topicInfo.topic,
        masteryLevel: 50,
        lastStudied: true,
        notes: `Learned via ${this.planSteps.length}-step explanation`
      });
      console.log(`[outputCombinedResult] Auto-tracked: ${topicInfo.subject} > ${topicInfo.topic} at 50%`);
      trackingMessage = TRACKING_MESSAGE_ADDED(topicInfo.subject, topicInfo.topic) + TRACKING_MESSAGE_WHAT_NEXT;
    } else {
      trackingMessage = TRACKING_MESSAGE_EXPLAIN_MORE;
    }

    // Add to chat messages with follow-up options
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "assistant",
        parts: [{
          type: "text",
          text: combined + trackingMessage
        }],
        metadata: { createdAt: new Date() }
      }
    ]);

    // Reset state
    this.planSteps = [];
    this.stepResults = [];
    this.originalPrompt = "";
    this.isProcessingPlan = false;
  }

  // ============ CONTEXT METHODS ============

  /**
   * Gets the full user context for AI to use.
   * Includes profile, session preferences, knowledge, weak areas, recent quizzes, and study stats.
   * @returns Complete user context object
   */
  getFullContext(): {
    profile: UserProfile | null;
    session: SessionPreferences | null;
    knowledge: Knowledge[];
    weakAreas: Knowledge[];
    recentQuizzes: QuizHistory[];
    quizStats: QuizStats;
    studyStats: {
      totalMinutes: number;
      sessionsByType: Record<string, { count: number; totalMinutes: number }>;
      recentSessions: Array<{ session_type: string; subject: string | null; duration_minutes: number | null; started_at: string }>;
    };
  } {
    return {
      profile: this.getUserProfile(),
      session: this.getSessionPreferences(),
      knowledge: this.getKnowledge(),
      weakAreas: this.getWeakAreas(),
      recentQuizzes: this.getQuizHistory(undefined, 5),
      quizStats: this.getQuizStats(),
      studyStats: this.getStudyStats()
    };
  }

  /**
   * Formats user context as a readable string for "what do you know about me" style questions.
   * Returns structured sections, not raw JSON.
   */
  formatUserContextForDisplay(): string {
    const ctx = this.getFullContext();
    const sections: string[] = [];

    // Profile
    sections.push("**Profile**");
    if (ctx.profile?.name || ctx.profile?.major || ctx.profile?.year) {
      sections.push(`• Name: ${ctx.profile.name ?? "—"}`);
      sections.push(`• Major: ${ctx.profile.major ?? "—"}`);
      sections.push(`• Year: ${ctx.profile.year ?? "—"}`);
      try {
        const methods = ctx.profile.preferred_learning_methods
          ? (JSON.parse(ctx.profile.preferred_learning_methods) as string[]).join(", ")
          : "—";
        sections.push(`• Learning style: ${methods}`);
      } catch {
        sections.push("• Learning style: —");
      }
    } else {
      sections.push("No profile yet.");
    }

    // Filter out junk: topics that look like full sentences or user messages (e.g. "hi how you can help me")
    const isRealTopic = (k: Knowledge) =>
      k.topic.length <= 40 &&
      !/^(hi|hello|how|what|give me|i want|you doing|can you)/i.test(k.topic.trim());

    // Knowledge (topics studied)
    sections.push("\n**Topics studied**");
    const validKnowledge = ctx.knowledge.filter(isRealTopic);
    if (validKnowledge.length > 0) {
      for (const k of validKnowledge.slice(0, 15)) {
        sections.push(`• ${k.subject} > ${k.topic} — ${k.mastery_level}% mastery`);
      }
      if (validKnowledge.length > 15) sections.push(`… and ${validKnowledge.length - 15} more`);
    } else {
      sections.push("None yet.");
    }

    // Weak areas (only show valid topic entries)
    sections.push("\n**Areas to review**");
    const validWeakAreas = ctx.weakAreas.filter(isRealTopic);
    if (validWeakAreas.length > 0) {
      validWeakAreas.slice(0, 5).forEach((k) => sections.push(`• ${k.subject} > ${k.topic}`));
    } else {
      sections.push("None.");
    }

    // Recent quizzes
    sections.push("\n**Recent quizzes**");
    if (ctx.recentQuizzes.length > 0) {
      ctx.recentQuizzes.slice(0, 5).forEach((q) =>
        sections.push(`• ${q.subject}${q.topic ? ` > ${q.topic}` : ""} — ${q.score}%`)
      );
    } else {
      sections.push("None yet.");
    }

    // Quiz stats
    sections.push("\n**Quiz stats**");
    sections.push(`• Total quizzes: ${ctx.quizStats.totalQuizzes}`);
    sections.push(`• Average score: ${ctx.quizStats.averageScore}%`);

    return sections.join("\n");
  }

  /**
   * Called when the Durable Object is instantiated.
   * Initializes all database tables.
   */
  onStart(): void {
    this.initTables();
  }

  /**
   * Handles incoming chat messages using plan-then-execute flow.
   * For every prompt:
   * 1. Generate a plan (1-10 steps)
   * 2. For simple questions (1 step), process with streaming
   * 3. For complex questions (2+ steps), use sequential plan execution
   */
  async onChatMessage(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ) {
    console.log("[DEBUG] 1. onChatMessage called");
    console.log("[DEBUG] 2. Total messages in history:", this.messages.length);

    // Extract the user's prompt from the last message
    const userMessage = this.messages[this.messages.length - 1];
    
    // IMPORTANT: Only process if the last message is from a USER
    // saveMessages() can trigger onChatMessage again, but with assistant message as last
    // We must skip those calls to avoid duplicate responses
    if (!userMessage || userMessage.role !== "user") {
      console.log("[DEBUG] 3. Last message is not from user, skipping (role:", userMessage?.role, ")");
      // Return empty stream to complete the request without doing anything
      const stream = createUIMessageStream({
        execute: async () => {
          // Nothing to do - this was triggered by saveMessages, not a user message
        }
      });
      return createUIMessageStreamResponse({ stream });
    }
    
    let prompt = "";
    if (userMessage.parts) {
      for (const part of userMessage.parts) {
        if (part.type === "text" && part.text) {
          prompt = part.text;
          break;
        }
      }
    }

    console.log("[DEBUG] 3. Extracted prompt:", prompt.substring(0, 100) + (prompt.length > 100 ? "..." : ""));

    // If no prompt extracted, fall back to simple response
    if (!prompt) {
      return this.processSimpleQuestion(onFinish, options);
    }

    // Get last assistant message for context (e.g. "what is your major?" so "computer science" is CONVERSATIONAL).
    let lastAssistantText: string | undefined;
    if (this.messages.length >= 2) {
      const prev = this.messages[this.messages.length - 2];
      if (prev?.role === "assistant" && prev.parts) {
        for (const part of prev.parts) {
          if (part.type === "text" && part.text) {
            lastAssistantText = part.text;
            break;
          }
        }
      }
    }

    // Let the AI decide: conversational (simple flow) vs learning (plan flow).
    const intent = await this.classifyIntent(prompt, lastAssistantText);
    // #region agent log
    fetch("http://127.0.0.1:7242/ingest/f7f750ff-d56d-4fc6-a13a-a716cd0ba684", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ location: "server.ts:onChatMessage", message: "flow choice", data: { intent, flow: intent === "CONVERSATIONAL" ? "simple" : "plan", lastAssistantSnippet: lastAssistantText?.substring(0, 80) }, timestamp: Date.now(), sessionId: "debug-session", hypothesisId: "H5" }) }).catch(() => {});
    // #endregion
    if (intent === "CONVERSATIONAL") {
      console.log("[DEBUG] 4. Intent CONVERSATIONAL, using simple flow");
      return this.processSimpleQuestion(onFinish, options);
    }

    // Generate plan for this prompt (LEARNING)
    console.log("[DEBUG] 4. Intent LEARNING, generating plan...");
    const plan = await this.generatePlan(prompt);
    console.log("[DEBUG] 5. Plan generated with", plan.length, "steps:", plan);

    // For single-step plans, use the simple streaming flow
    if (plan.length <= 1) {
      console.log("[DEBUG] 6. Single-step plan, using simple flow");
      return this.processSimpleQuestion(onFinish, options);
    }

    // For multi-step plans, use plan-then-execute flow
    console.log("[DEBUG] 6. Multi-step plan, using plan-then-execute flow");
    
    // Store plan state
    this.originalPrompt = prompt;
    this.planSteps = plan;
    this.stepResults = new Array(plan.length).fill("");
    this.isProcessingPlan = true;

    // Create acknowledgment message showing the plan
    const planSummary = plan.map((s, i) => `${i + 1}. ${s}`).join('\n');
    const acknowledgmentText = ACKNOWLEDGMENT_TEMPLATE(plan.length, planSummary);

    // Save the acknowledgment message
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "assistant",
        parts: [{
          type: "text",
          text: acknowledgmentText
        }],
        metadata: { createdAt: new Date() }
      }
    ]);

    // Schedule first step with 0-second delay (immediate execution)
    this.schedule(0, "executeTask", "PLAN_STEP:0");
    console.log("[DEBUG] 7. Scheduled first plan step");

    // Return a stream response - the acknowledgment is already saved to messages
    // The stream just needs to complete the HTTP request
    const stream = createUIMessageStream({
      execute: async () => {
        // The acknowledgment is already saved via saveMessages above
        // The scheduler will process steps and output the combined result
        // Nothing to stream here - just let the request complete
      }
    });

    return createUIMessageStreamResponse({ stream });
  }

  /**
   * Processes simple questions using the original streaming flow.
   * Used for single-step plans or when no prompt is extracted.
   */
  private async processSimpleQuestion(
    onFinish: StreamTextOnFinishCallback<ToolSet>,
    options?: { abortSignal?: AbortSignal }
  ) {
    // Initialize Workers AI with the AI binding (FREE Cloudflare models)
    const workersai = createWorkersAI({ binding: this.env.AI });
    
    // Using 70B for better tool calling
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const model = workersai("@cf/meta/llama-3.3-70b-instruct-fp8-fast" as any);

    // Only use our custom tools - MCP is for external integrations we don't need
    const allTools = tools;

    // Get full user context for the system prompt
    const ctx = this.getFullContext();

    const stream = createUIMessageStream({
      execute: async ({ writer }) => {
        console.log("[DEBUG] Simple flow - Stream execute started");
        const startTime = Date.now();
        
        try {
          // Clean up incomplete tool calls to prevent API errors
          const cleanedMessages = cleanupMessages(this.messages);
          console.log("[DEBUG] Simple flow - Cleaned messages:", cleanedMessages.length);

          // Process any pending tool calls from previous messages
          // This handles human-in-the-loop confirmations for tools
          const processedMessages = await processToolCalls({
            messages: cleanedMessages,
            dataStream: writer,
            tools: allTools,
            executions
          });
          console.log("[DEBUG] Simple flow - Processed messages:", processedMessages.length);

          // Build the system prompt with user context
          const systemPrompt = this.buildSystemPrompt(ctx);
          console.log("[DEBUG] Simple flow - System prompt length:", systemPrompt.length, "chars");

          console.log("[DEBUG] Simple flow - Calling streamText with maxTokens: 4096...");
          const result = streamText({
            system: systemPrompt,
            messages: await convertToModelMessages(processedMessages),
            model,
            // Cloudflare Workers AI defaults to 256 tokens - increase to allow longer responses
            maxTokens: 4096,
            tools: allTools,
            toolChoice: "auto", // Let model decide when to use tools vs just respond with text
            // Type boundary: streamText expects specific tool types, but base class uses ToolSet
            // This is safe because our tools satisfy ToolSet interface (verified by 'satisfies' in tools.ts)
            onFinish: (event) => {
              const elapsed = Date.now() - startTime;
              console.log("[DEBUG] Simple flow - streamText finished in", elapsed, "ms");
              console.log("[DEBUG] Simple flow - Response length:", event.text?.length || 0, "chars");
              console.log("[DEBUG] Simple flow - Tool calls:", event.toolCalls?.length || 0);
              console.log("[DEBUG] Simple flow - Finish reason:", event.finishReason);
              (onFinish as unknown as StreamTextOnFinishCallback<typeof allTools>)(event);
            },
            stopWhen: stepCountIs(10),
            abortSignal: options?.abortSignal
          });

          console.log("[DEBUG] Simple flow - Merging stream to writer...");
          writer.merge(result.toUIMessageStream());
          console.log("[DEBUG] Simple flow - Stream merged");
        } catch (error) {
          const elapsed = Date.now() - startTime;
          console.error("[DEBUG] Simple flow - ERROR after", elapsed, "ms:", error);
          throw error;
        }
      }
    });

    return createUIMessageStreamResponse({ stream });
  }

  /**
   * Builds the system prompt with full context: what we have, what's missing,
   * tools and when to use them, ask for missing profile info, remind what you can do.
   */
  private buildSystemPrompt(ctx: ReturnType<typeof this.getFullContext>): string {
    const name = ctx.profile?.name ?? "not set";
    const major = ctx.profile?.major ?? "not set";
    const year = ctx.profile?.year ?? "not set";
    const rawPrefs = ctx.profile?.preferred_learning_methods ?? null;
    let learningMethodsSummary = "not set";
    if (rawPrefs) {
      try {
        const arr = JSON.parse(rawPrefs) as string[];
        learningMethodsSummary = Array.isArray(arr) && arr.length > 0 ? arr.join(", ") : "not set";
      } catch {
        // leave "not set"
      }
    }
    const missing: string[] = [];
    if (!ctx.profile?.name?.trim()) missing.push("name");
    if (!ctx.profile?.major?.trim()) missing.push("major");
    if (!ctx.profile?.year?.trim()) missing.push("year");
    if (!rawPrefs || (() => { try { const a = JSON.parse(rawPrefs); return !Array.isArray(a) || a.length === 0; } catch { return true; } })()) missing.push("preferred_learning_methods (how they like to learn)");
    const missingLine = MISSING_PROFILE_LINE_TEMPLATE(missing);

    const knowledgeSummary = ctx.knowledge.length > 0
      ? ctx.knowledge.slice(0, 10).map(k => `${k.subject} > ${k.topic} (${k.mastery_level}%)`).join("; ")
      : KNOWLEDGE_NONE_YET;
    const weakSummary = ctx.weakAreas.length > 0
      ? ctx.weakAreas.slice(0, 5).map(k => `${k.subject} > ${k.topic}`).join("; ")
      : WEAK_AREAS_NONE;
    const recentQuizzesLine = ctx.recentQuizzes.length > 0
      ? RECENT_QUIZZES_LINE_TEMPLATE(ctx.recentQuizzes.slice(0, 3))
      : RECENT_QUIZZES_NONE;

    return MAIN_SYSTEM_TEMPLATE({
      name,
      major,
      year,
      learningMethodsSummary,
      missingLine,
      knowledgeSummary,
      weakSummary,
      recentQuizzesLine
    });
  }
  /**
   * Executes scheduled tasks, including plan step processing.
   * When processing plan steps, it:
   * 1. Processes the current step via AI
   * 2. Stores the result
   * 3. Schedules the next step (if any)
   * 4. Outputs combined results when all steps complete
   * 
   * @param description - Task description or "PLAN_STEP:N" for plan processing
   * @param _task - The Schedule object from the scheduler
   */
  async executeTask(description: string, _task: Schedule<string>) {
    // Check if this is a plan step task
    if (description.startsWith("PLAN_STEP:")) {
      const stepIndex = parseInt(description.split(":")[1], 10);
      const step = this.planSteps[stepIndex];

      if (!step) {
        console.error(`[executeTask] Invalid step index: ${stepIndex}`);
        return;
      }

      console.log(`[executeTask] Processing plan step ${stepIndex + 1}/${this.planSteps.length}: ${step}`);

      // Process this step
      const stepResult = await this.processStep(step, stepIndex);
      this.stepResults[stepIndex] = stepResult;

      // Check if more steps remain
      const nextIndex = stepIndex + 1;
      if (nextIndex < this.planSteps.length) {
        // Schedule next step with 0-second delay (immediate sequential processing)
        this.schedule(0, "executeTask", `PLAN_STEP:${nextIndex}`);
        console.log(`[executeTask] Scheduled next step: ${nextIndex + 1}/${this.planSteps.length}`);
      } else {
        // All steps complete - combine and output
        console.log(`[executeTask] All ${this.planSteps.length} steps complete, outputting combined result`);
        await this.outputCombinedResult();
      }
      return;
    }

    // Original executeTask logic for regular scheduled tasks (non-plan tasks)
    await this.saveMessages([
      ...this.messages,
      {
        id: generateId(),
        role: "user",
        parts: [
          {
            type: "text",
            text: `Running scheduled task: ${description}`
          }
        ],
        metadata: {
          createdAt: new Date()
        }
      }
    ]);
  }
}

/**
 * Worker entry point that routes incoming requests to the appropriate handler
 */
export default {
  async fetch(request: Request, env: Env, _ctx: ExecutionContext) {
    const url = new URL(request.url);

    // Using Cloudflare Workers AI - no API key needed!
    if (url.pathname === "/check-open-ai-key") {
      return Response.json({
        success: true  // Workers AI doesn't need an API key
      });
    }

    // DEBUG: Test max_tokens directly with Cloudflare API (bypassing SDK)
    if (url.pathname === "/test-max-tokens") {
      try {
        const result = await env.AI.run(
          "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
          {
            messages: [{ role: "user", content: TEST_MAX_TOKENS_USER }],
            max_tokens: 4096
          }
        ) as { response: string };
        return Response.json({
          success: true,
          responseLength: result.response?.length || 0,
          response: result.response,
          note: "This bypasses the SDK - if length > 1200, API works and SDK is the issue"
        });
      } catch (error) {
        return Response.json({
          success: false,
          error: String(error)
        }, { status: 500 });
      }
    }
    
    return (
      // Route the request to our agent or return 404 if not found
      (await routeAgentRequest(request, env)) ||
      new Response("Not found", { status: 404 })
    );
  }
} satisfies ExportedHandler<Env>;
