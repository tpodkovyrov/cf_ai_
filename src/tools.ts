/**
 * Tool definitions for the AI study assistant
 * These tools allow the AI to interact with user data, track progress, and manage study sessions
 */
import { tool, type ToolSet } from "ai";
import { z } from "zod/v3";

import type { Chat } from "./server";
import { getCurrentAgent } from "agents";
import { scheduleSchema } from "agents/schedule";
import { LearningMethod, QuizType } from "./types";
import {
  TOOL_DESC_ANSWER_GENERAL_QUESTION,
  TOOL_DESC_GET_USER_CONTEXT,
  TOOL_DESC_UPDATE_USER_PROFILE,
  TOOL_DESC_UPDATE_SESSION_PREFERENCES,
  TOOL_DESC_UPDATE_KNOWLEDGE,
  TOOL_DESC_GET_KNOWLEDGE,
  TOOL_DESC_GET_WEAK_AREAS,
  TOOL_DESC_RECORD_QUIZ_RESULT,
  TOOL_DESC_GET_QUIZ_HISTORY,
  TOOL_DESC_START_STUDY_SESSION,
  TOOL_DESC_END_STUDY_SESSION,
  TOOL_DESC_RESET_PROGRESS,
  TOOL_DESC_SCHEDULE_TASK,
  TOOL_DESC_GET_SCHEDULED_TASKS,
  TOOL_DESC_CANCEL_SCHEDULED_TASK,
  NEXT_ASK_MAJOR,
  NEXT_ASK_YEAR,
  NEXT_ASK_LEARNING_METHODS,
  NEXT_ASK_GOAL,
  NEXT_ASK_LEARN_TOPIC,
  NEXT_ASK_LEARN_CONCEPT,
  NEXT_START_TEACHING,
  NEXT_ASK_EXAM_NAME,
  NEXT_ASK_EXAM_DEPTH,
  NEXT_ASK_EXAM_TIME,
  NEXT_CREATE_STUDY_PLAN,
  NEXT_ASK_QUIZ_TOPIC,
  NEXT_ASK_QUIZ_NUM_QUESTIONS,
  NEXT_ASK_QUIZ_TYPE,
  NEXT_ASK_QUIZ_HINTS,
  NEXT_START_QUIZ,
  RESET_CANCELLED_MESSAGE,
  QUIZ_RECORDED_TEMPLATE
} from "./prompts";

// ============ GENERAL RESPONSE TOOL (fallback when no other tool fits) ============

/**
 * Handles weather, facts, general knowledge, small talk - any question that doesn't fit other tools.
 * Calls the AI without tools so it answers naturally instead of refusing.
 */
const answerGeneralQuestion = tool({
  description: TOOL_DESC_ANSWER_GENERAL_QUESTION,
  inputSchema: z.object({
    question: z.string().describe("The user's question (e.g. weather, facts, general knowledge)")
  }),
  execute: async ({ question }) => {
    const { agent } = getCurrentAgent<Chat>();
    return agent!.answerGeneralQuestion(question);
  }
});

// ============ CONTEXT TOOLS ============

/**
 * Get complete user context including profile, knowledge, weak areas, and recent activity.
 * Call only when you need to refresh or verify current context; the system already provides profile summary in your prompt.
 */
const getUserContext = tool({
  description: TOOL_DESC_GET_USER_CONTEXT,
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();
    return agent!.formatUserContextForDisplay();
  }
});

// ============ PROFILE TOOLS ============

/**
 * Save or update user's profile information.
 * Call only when the user has provided NEW information to save (name, major, year, or learning preferences). Do not call with existing or empty values.
 */
const updateUserProfile = tool({
  description: TOOL_DESC_UPDATE_USER_PROFILE,
  inputSchema: z.object({
    name: z.string().optional().describe("User's name"),
    major: z.string().optional().describe("User's major/field of study"),
    year: z.string().optional().describe("User's year (Freshman, Sophomore, Junior, Senior, Graduate)"),
    preferredLearningMethods: z.array(
      z.enum(["examples", "theory", "practice", "flashcards", "summaries", "socratic"])
    ).optional().describe("User's preferred learning methods (can select 2-3)")
  }),
  execute: async (data) => {
    const { agent } = getCurrentAgent<Chat>();
    // Cast learning methods to LearningMethod enum type
    const profileData = {
      ...data,
      preferredLearningMethods: data.preferredLearningMethods as LearningMethod[] | undefined
    };
    agent!.updateUserProfile(profileData);
    
    // Get current profile to determine next question
    const profile = agent!.getUserProfile();
    
    // Determine what to ask next and return instruction
    let nextAction = "";
    if (!profile?.major) {
      nextAction = NEXT_ASK_MAJOR(data.name ?? "there");
    } else if (!profile?.year) {
      nextAction = NEXT_ASK_YEAR;
    } else if (!profile?.preferred_learning_methods) {
      nextAction = NEXT_ASK_LEARNING_METHODS;
    } else {
      nextAction = NEXT_ASK_GOAL;
    }
    
    const saved = Object.entries(data)
      .filter(([, v]) => v !== undefined)
      .map(([k, v]) => Array.isArray(v) ? `${k}=[${v.join(", ")}]` : `${k}=${v}`)
      .join(", ");
    return `Saved: ${saved}. ${nextAction}`;
  }
});

// ============ SESSION PREFERENCES TOOLS ============

/**
 * Save session preferences (goal, topic choices, quiz settings).
 * Call when user makes selections during onboarding or changes their session goals.
 */
const updateSessionPreferences = tool({
  description: TOOL_DESC_UPDATE_SESSION_PREFERENCES,
  inputSchema: z.object({
    goal: z.enum(["learn", "exam", "quiz"]).optional().describe("User's goal for this session"),
    learnTopic: z.string().optional().describe("Topic user wants to learn"),
    learnConcept: z.string().optional().describe("Specific concept within the topic"),
    examName: z.string().optional().describe("Name of the exam to prepare for"),
    examDepth: z.enum(["overview", "moderate", "deep"]).optional().describe("How in-depth to study"),
    examTimeLeft: z.string().optional().describe("Time remaining until exam"),
    quizTopic: z.string().optional().describe("Topic for the quiz"),
    quizNumQuestions: z.number().optional().describe("Number of quiz questions"),
    quizType: z.enum(["multiple_choice", "free_response", "mixed"]).optional().describe("Type of quiz questions"),
    quizHintsAllowed: z.boolean().optional().describe("Whether hints are allowed during quiz"),
    onboardingComplete: z.boolean().optional().describe("Whether onboarding is complete")
  }),
  execute: async (data) => {
    const { agent } = getCurrentAgent<Chat>();
    agent!.updateSessionPreferences(data);
    
    // Get current session to determine next question
    const session = agent!.getSessionPreferences();
    
    let nextAction = "";
    
    if (data.goal === "learn" || session?.goal === "learn") {
      if (!session?.learn_topic && !data.learnTopic) {
        nextAction = NEXT_ASK_LEARN_TOPIC;
      } else if (!session?.learn_concept && !data.learnConcept) {
        nextAction = NEXT_ASK_LEARN_CONCEPT;
      } else {
        nextAction = NEXT_START_TEACHING;
      }
    } else if (data.goal === "exam" || session?.goal === "exam") {
      if (!session?.exam_name && !data.examName) {
        nextAction = NEXT_ASK_EXAM_NAME;
      } else if (!session?.exam_depth && !data.examDepth) {
        nextAction = NEXT_ASK_EXAM_DEPTH;
      } else if (!session?.exam_time_left && !data.examTimeLeft) {
        nextAction = NEXT_ASK_EXAM_TIME;
      } else {
        nextAction = NEXT_CREATE_STUDY_PLAN;
      }
    } else if (data.goal === "quiz" || session?.goal === "quiz") {
      if (!session?.quiz_topic && !data.quizTopic) {
        nextAction = NEXT_ASK_QUIZ_TOPIC;
      } else if (!session?.quiz_num_questions && !data.quizNumQuestions) {
        nextAction = NEXT_ASK_QUIZ_NUM_QUESTIONS;
      } else if (!session?.quiz_type && !data.quizType) {
        nextAction = NEXT_ASK_QUIZ_TYPE;
      } else if (session?.quiz_hints_allowed === null && data.quizHintsAllowed === undefined) {
        nextAction = NEXT_ASK_QUIZ_HINTS;
      } else {
        nextAction = NEXT_START_QUIZ;
      }
    } else if (!session?.goal && !data.goal) {
      nextAction = NEXT_ASK_GOAL;
    }
    
    return `Session saved. ${nextAction}`;
  }
});

// ============ KNOWLEDGE TOOLS ============

/**
 * Update user's knowledge tree after they study or learn a topic.
 * Records mastery level, confidence, and any weak areas identified.
 */
const updateKnowledge = tool({
  description: TOOL_DESC_UPDATE_KNOWLEDGE,
  inputSchema: z.object({
    subject: z.string().describe("Subject area like 'Data Structures' or 'Calculus'"),
    topic: z.string().describe("Specific topic like 'Binary Trees' or 'Derivatives'"),
    masteryLevel: z.number().min(0).max(100).optional().describe("New mastery level 0-100"),
    confidence: z.number().min(0).max(100).optional().describe("User's self-reported confidence 0-100"),
    incrementStudyCount: z.boolean().optional().describe("Whether to increment times_studied counter"),
    weakAreas: z.array(z.string()).optional().describe("Specific weak points within the topic"),
    notes: z.string().optional().describe("AI observations about user's understanding")
  }),
  execute: async (data) => {
    const { agent } = getCurrentAgent<Chat>();
    agent!.updateKnowledge({
      subject: data.subject,
      topic: data.topic,
      masteryLevel: data.masteryLevel,
      confidence: data.confidence,
      timesStudied: data.incrementStudyCount ? 1 : undefined,
      lastStudied: data.incrementStudyCount,
      weakAreas: data.weakAreas,
      notes: data.notes
    });
    return `Knowledge updated: ${data.subject} > ${data.topic}${data.masteryLevel !== undefined ? ` (${data.masteryLevel}% mastery)` : ""}`;
  }
});

const getKnowledge = tool({
  description: TOOL_DESC_GET_KNOWLEDGE,
  inputSchema: z.object({
    subject: z.string().optional().describe("Filter by subject, or omit for all subjects")
  }),
  execute: async ({ subject }) => {
    const { agent } = getCurrentAgent<Chat>();
    const knowledge = subject 
      ? agent!.getKnowledgeBySubject(subject)
      : agent!.getKnowledge();
    
    if (knowledge.length === 0) {
      return "No topics studied yet.";
    }
    return knowledge;
  }
});

const getWeakAreas = tool({
  description: TOOL_DESC_GET_WEAK_AREAS,
  inputSchema: z.object({
    limit: z.number().optional().describe("Maximum number of weak areas to return, default 10")
  }),
  execute: async ({ limit = 10 }) => {
    const { agent } = getCurrentAgent<Chat>();
    const weakAreas = agent!.getWeakAreas(limit);
    
    if (weakAreas.length === 0) {
      return "No weak areas found - great job!";
    }
    return weakAreas;
  }
});

// ============ QUIZ TOOLS ============

/**
 * Record quiz results and update knowledge mastery based on performance.
 */
const recordQuizResult = tool({
  description: TOOL_DESC_RECORD_QUIZ_RESULT,
  inputSchema: z.object({
    subject: z.string().describe("Subject of the quiz"),
    topic: z.string().optional().describe("Specific topic quizzed"),
    quizType: z.enum(["multiple_choice", "free_response", "mixed"]).describe("Type of quiz"),
    score: z.number().min(0).max(100).describe("Score as percentage 0-100"),
    totalQuestions: z.number().describe("Total number of questions"),
    correctAnswers: z.number().describe("Number of correct answers"),
    missedConcepts: z.array(z.string()).describe("Concepts the user got wrong or struggled with"),
    timeSpentSeconds: z.number().optional().describe("Time spent on quiz in seconds"),
    hintsUsed: z.number().optional().describe("Number of hints used")
  }),
  execute: async (result) => {
    const { agent } = getCurrentAgent<Chat>();
    agent!.recordQuiz({
      subject: result.subject,
      topic: result.topic,
      quizType: result.quizType as QuizType,
      score: result.score,
      totalQuestions: result.totalQuestions,
      correctAnswers: result.correctAnswers,
      missedConcepts: result.missedConcepts,
      timeSpentSeconds: result.timeSpentSeconds,
      hintsUsed: result.hintsUsed
    });
    return QUIZ_RECORDED_TEMPLATE({
      score: result.score,
      subject: result.subject,
      topic: result.topic,
      missedConcepts: result.missedConcepts
    });
  }
});

const getQuizHistory = tool({
  description: TOOL_DESC_GET_QUIZ_HISTORY,
  inputSchema: z.object({
    subject: z.string().optional().describe("Filter by subject"),
    limit: z.number().optional().describe("Number of quizzes to return, default 20")
  }),
  execute: async ({ subject, limit = 20 }) => {
    const { agent } = getCurrentAgent<Chat>();
    const history = agent!.getQuizHistory(subject, limit);
    
    if (history.length === 0) {
      return "No quiz history yet.";
    }
    return history;
  }
});

// ============ STUDY SESSION TOOLS ============

/**
 * Start tracking a study session.
 */
const startStudySession = tool({
  description: TOOL_DESC_START_STUDY_SESSION,
  inputSchema: z.object({
    sessionType: z.enum(["learn", "review", "quiz", "exam_prep"]).describe("Type of study session"),
    subject: z.string().optional().describe("Subject being studied"),
    topic: z.string().optional().describe("Specific topic being studied")
  }),
  execute: async (data) => {
    const { agent } = getCurrentAgent<Chat>();
    const sessionId = agent!.startSession(data.sessionType, data.subject, data.topic);
    return { sessionId, message: `Study session started (ID: ${sessionId})` };
  }
});

/**
 * End a study session and save a summary.
 */
const endStudySession = tool({
  description: TOOL_DESC_END_STUDY_SESSION,
  inputSchema: z.object({
    sessionId: z.number().describe("ID of the session to end"),
    summary: z.string().describe("Brief summary of what was covered in the session")
  }),
  execute: async ({ sessionId, summary }) => {
    const { agent } = getCurrentAgent<Chat>();
    agent!.endSession(sessionId, summary);
    return `Study session ${sessionId} ended and saved.`;
  }
});

// ============ RESET TOOLS ============

/**
 * Reset user's progress. Only use when user explicitly asks to start fresh.
 */
const resetProgress = tool({
  description: TOOL_DESC_RESET_PROGRESS,
  inputSchema: z.object({
    resetType: z.enum(["all", "knowledge", "quizzes", "sessions"]).describe("What to reset"),
    userConfirmed: z.boolean().describe("User must explicitly confirm - must be true to proceed")
  }),
  execute: async ({ resetType, userConfirmed }) => {
    if (!userConfirmed) {
      return RESET_CANCELLED_MESSAGE;
    }
    const { agent } = getCurrentAgent<Chat>();
    agent!.resetProgress(resetType);
    return `Progress reset: ${resetType}. ${resetType === "all" ? "All data has been cleared." : `${resetType} data has been cleared.`}`;
  }
});

// ============ SCHEDULING TOOLS (kept from original) ============

/**
 * Schedule a task to be executed at a later time.
 */
const scheduleTask = tool({
  description: TOOL_DESC_SCHEDULE_TASK,
  inputSchema: scheduleSchema,
  execute: async ({ when, description }) => {
    const { agent } = getCurrentAgent<Chat>();

    function throwError(msg: string): string {
      throw new Error(msg);
    }
    if (when.type === "no-schedule") {
      return "Not a valid schedule input";
    }
    const input =
      when.type === "scheduled"
        ? when.date
        : when.type === "delayed"
          ? when.delayInSeconds
          : when.type === "cron"
            ? when.cron
            : throwError("not a valid schedule input");
    try {
      agent!.schedule(input!, "executeTask", description);
    } catch (error) {
      console.error("error scheduling task", error);
      return `Error scheduling task: ${error}`;
    }
    return `Task scheduled for type "${when.type}" : ${input}`;
  }
});

/**
 * List all scheduled tasks.
 */
const getScheduledTasks = tool({
  description: TOOL_DESC_GET_SCHEDULED_TASKS,
  inputSchema: z.object({}),
  execute: async () => {
    const { agent } = getCurrentAgent<Chat>();

    try {
      const tasks = agent!.getSchedules();
      if (!tasks || tasks.length === 0) {
        return "No scheduled tasks found.";
      }
      return tasks;
    } catch (error) {
      console.error("Error listing scheduled tasks", error);
      return `Error listing scheduled tasks: ${error}`;
    }
  }
});

/**
 * Cancel a scheduled task by its ID.
 */
const cancelScheduledTask = tool({
  description: TOOL_DESC_CANCEL_SCHEDULED_TASK,
  inputSchema: z.object({
    taskId: z.string().describe("The ID of the task to cancel")
  }),
  execute: async ({ taskId }) => {
    const { agent } = getCurrentAgent<Chat>();
    try {
      await agent!.cancelSchedule(taskId);
      return `Task ${taskId} has been successfully canceled.`;
    } catch (error) {
      console.error("Error canceling scheduled task", error);
      return `Error canceling task ${taskId}: ${error}`;
    }
  }
});

// ============ EXPORT ALL TOOLS ============

export const tools = {
  // General fallback - use when no other tool fits (weather, facts, small talk)
  answerGeneralQuestion,
  // Profile - most important for onboarding
  updateUserProfile,
  // Context
  getUserContext,
  // Session
  updateSessionPreferences,
  // Knowledge
  updateKnowledge,
  getKnowledge,
  getWeakAreas,
  // Quiz
  recordQuizResult,
  getQuizHistory,
  // Study Sessions
  startStudySession,
  endStudySession,
  // Reset
  resetProgress
  // NOTE: Scheduling tools removed - not relevant for study app
} satisfies ToolSet;

/**
 * Empty executions object - all tools have execute functions
 */
export const executions = {};
