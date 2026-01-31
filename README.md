# AI Study Assistant (Cloudflare Agents)

## Summary

**What it is:** A chat-based AI study assistant that runs on Cloudflare. You talk to it in a browser; it can teach you topics, help you prep for exams, run quizzes, and track what you’ve learned.

**How it works in short:**

1. **You send a message** in the React chat UI. The request hits a Cloudflare Worker, which routes it to a **Durable Object** (one per chat session). That object holds your **SQLite** data: profile, preferences, knowledge graph, quiz history, and study sessions.

2. **The AI classifies your message:**
   - **Conversational** (greetings, profile answers, “quiz me on X”, general questions) → one **streaming** reply with tools. The model can call tools in the same turn (e.g. save profile, run a quiz, answer a general question).
   - **Learning** (“explain X”, “teach me Y”) → the assistant **plans** 1–10 steps, runs each step with the AI, then **combines** the answers and **adds the topic** to your knowledge graph at 50% mastery.

3. **AI and state:** All AI calls use **Workers AI** (no OpenAI key needed). Tools read/write the Durable Object’s SQLite so your progress is persisted per session.

**In one sentence:** The app is a stateful, tool-using study assistant on Cloudflare that either answers in one streaming turn (conversational) or runs a multi-step learning plan and records what you learned.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [How It Works](#how-it-works)
- [Data Model](#data-model)
- [Tools](#tools)
- [Prompts](#prompts)
- [Frontend](#frontend)
- [Server (Chat Agent)](#server-chat-agent)
- [Configuration](#configuration)
- [Scripts & Deployment](#scripts--deployment)
- [Testing](#testing)
- [Project Structure](#project-structure)

---

## Overview

- What it does: Chat-based study assistant. Users can:
  1. Study a concept — multi-step explanations with optional knowledge tracking. Support user learning preference
     2.Study for an exam — set exam name, depth, time; get a study plan and concepts to learn
     3.Take a quiz — topic, number of questions, type (multiple choice / free response / mixed), hints on/off; results update mastery and weak areas.
  2. Ask general questions about anything not realated to the studying
  3. Review user weak knowledge areas
  4. Get information about user(what info is stored)
     7.Persistence Per-user state (profile, session preferences, knowledge, quiz history, study sessions) is stored in **Durable Object–backed SQLite** (one DB per chat session/DO instance).
  5. AI**: Uses **Cloudflare Workers AI\*\* (`@cf/meta/llama-3.3-70b-instruct-fp8-fast`) for all model calls (no OpenAI API key required in production). Intent classification, plan generation, step processing, general Q&A, and main chat all use this binding.

App flows works like this: Each user message is **classified** (CONVERSATIONAL vs LEARNING). Conversational uses a single **streaming** chat turn with tools. Learning uses a **plan** (1–10 steps), then steps are run sequentially; results are combined and the topic is auto-added to the knowledge graph at 50% mastery that will be updated later if user practice concept.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        Cloudflare Worker                          │
│  • Serves static assets (Vite build → public)                     │
│  • /check-open-ai-key → always { success: true } (Workers AI)     │
│  • /test-max-tokens → debug endpoint for raw AI.run() however works only with default
│  • All other routes → routeAgentRequest(request, env)             │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Agents SDK (routeAgentRequest)                                   │
│  • Resolves Durable Object "Chat" for the request                 │
│  • Forwards to Chat instance (AIChatAgent)                        │
└───────────────────────────────┬─────────────────────────────────┘
                                │
                                ▼
┌─────────────────────────────────────────────────────────────────┐
│  Durable Object: Chat (src/server.ts)                             │
│  • One instance per chat session (sticky to DO id)                │
│  • SQLite DB: user_profile, session_preferences, knowledge,       │
│    quiz_history, study_sessions                                   │
│  • onChatMessage() → classify → simple flow OR plan flow         │
│  • processSimpleQuestion(): streamText + tools                     │
│  • Plan flow: generatePlan() → schedule PLAN_STEP:0..N →         │
│    executeTask() runs each step, then outputCombinedResult()      │
│  • env.AI = Workers AI binding (run inference)                    │
└─────────────────────────────────────────────────────────────────┘
```

- **Frontend**: React app (Vite). Renders in browser, talks to the same origin; the Worker serves HTML/JS and proxies agent requests to the Chat DO.

---

## Tech Stack

| Layer           | Technology                                                 |
| --------------- | ---------------------------------------------------------- |
| Runtime         | Cloudflare Workers                                         |
| State           | Durable Objects + D1-style SQLite (DO storage)             |
| AI              | Workers AI (`workers-ai-provider` + `ai` SDK `streamText`) |
| Agent framework | `agents` (Cloudflare), `@cloudflare/ai-chat`               |
| Frontend        | React 19, Vite 7, TypeScript                               |
| Styling         | Tailwind CSS 4, Radix primitives, Phosphor Icons           |
| Markdown        | `marked` + `streamdown` (streaming markdown)               |
| Validation      | Zod (tool schemas)                                         |

---

## How It Works

### 1. Request path

1. User sends a message in the React UI.
2. `useAgentChat` (from `@cloudflare/ai-chat/react`) sends the message to the Worker.
3. Worker routes to the **Chat** Durable Object via `routeAgentRequest`.
4. Chat’s `onChatMessage` is invoked with the current message list (including the new user message).

### 2. Guard: only react to user messages

- If the last message is **not** from the user (e.g. after we appended an assistant message), `onChatMessage` returns an empty stream and does nothing (avoids duplicate replies).

### 3. Intent classification

- **Input**: Last user message text + (optionally) last assistant message (for follow-ups like “What’s your major?” → “Computer science”).
- **Model**: Same Workers AI model, with `CLASSIFIER_SYSTEM` and `CLASSIFIER_USER_TEMPLATE` (see [Prompts](#prompts)).
- **Output**: `CONVERSATIONAL` or `LEARNING`.
- **CONVERSATIONAL**: Greetings, profile answers, “quiz me on X”, small talk, general questions → handled in one streaming turn with tools.
- **LEARNING**: “Explain X”, “Teach me Y”, “How does Z work?” → multi-step plan flow.

### 4. Conversational flow (simple)

- **processSimpleQuestion**:
  - Cleans messages with `cleanupMessages` (drops incomplete tool calls).
  - Runs `processToolCalls` to resolve any human-in-the-loop tool results (in this app, `executions` is empty; all tools have `execute`).
  - Builds system prompt via `buildSystemPrompt(ctx)` (profile, missing fields, knowledge summary, weak areas, recent quizzes).
  - Calls `streamText` with Workers AI, `tools` from `tools.ts`, `toolChoice: "auto"`, `maxTokens: 4096`, `stopWhen: stepCountIs(10)`.
  - Merges the model stream into the UI message stream.
- The model can call tools (e.g. `updateUserProfile`, `getUserContext`, `recordQuizResult`, `answerGeneralQuestion`) in the same turn; results are streamed back and the assistant can reply in text.

### 5. Learning flow (plan-then-execute)

- **generatePlan(prompt)**:
  - One-shot call to Workers AI with `PLAN_GENERATOR_SYSTEM` and `PLAN_GENERATOR_USER_TEMPLATE`.
  - Response is parsed as a JSON array of step strings (1–10 steps); fallback is `[prompt]`.
- If the plan has **one step**, we still use **processSimpleQuestion** (one streaming turn).
- If the plan has **2+ steps**:
  - Store `originalPrompt`, `planSteps`, `stepResults`, `isProcessingPlan`.
  - Append an **acknowledgment** message (e.g. “I’ll answer this in 3 parts: …”).
  - Schedule **PLAN_STEP:0** with `this.schedule(0, "executeTask", "PLAN_STEP:0")`.
  - Return a stream that completes immediately (no further streamed content from this request).

### 6. Plan step execution (executeTask)

- When the scheduler runs `executeTask(description, _task)`:
  - If `description` is `PLAN_STEP:N`:
    - **processStep(step, N)** runs: one AI call with `PROCESS_STEP_SYSTEM_TEMPLATE` and the step text; response is stored in `stepResults[N]`.
    - If there is a next step, schedule `PLAN_STEP:N+1` with delay 0.
    - If this was the last step, call **outputCombinedResult()**.
- **outputCombinedResult()**:
  - Concatenates step results into one markdown reply (headings per step).
  - Infers **subject/topic** for the knowledge graph via `inferSubjectTopicFromAI(originalPrompt)` (or fallback `extractTopicFromPrompt`).
  - If a topic is found, **updateKnowledge** at 50% mastery and append a short “I’ve added X > Y to your knowledge graph” + “What’s next?” text.
  - Appends one assistant message with the combined text + tracking line.
  - Clears `planSteps`, `stepResults`, `originalPrompt`, `isProcessingPlan`.

### 7. General questions (no tool fits)

- The main system prompt instructs the model to use **answerGeneralQuestion** for weather, facts, small talk, and anything that doesn’t fit other tools.
- **answerGeneralQuestion(question)** is a tool that calls Workers AI with `GENERAL_QUESTION_SYSTEM` and the user question, then returns the model reply as a string (so the assistant can output it as its next message).

---

## Data Model

All tables live in the Durable Object’s SQLite. Created in **initTables()** on DO startup.

| Table                   | Purpose                                                                                                                                                                                     |
| ----------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **user_profile**        | Single row (id=1): name, major, year, preferred_learning_methods (JSON array), last_active.                                                                                                 |
| **session_preferences** | Single row (id=1): goal (learn/exam/quiz), learn_topic/learn_concept, exam_name/exam_depth/exam_time_left, quiz_topic/quiz_num_questions/quiz_type/quiz_hints_allowed, onboarding_complete. |
| **knowledge**           | Per (subject, topic): mastery_level, confidence, times_studied, times_quizzed, last_studied, last_quizzed, weak_areas (JSON), notes. UNIQUE(subject, topic).                                |
| **quiz_history**        | One row per quiz: subject, topic, quiz_type, score, total_questions, correct_answers, missed_concepts (JSON), time_spent_seconds, hints_used, quiz_date.                                    |
| **study_sessions**      | Session_type (learn/review/quiz/exam_prep), subject, topic, duration_minutes, summary, started_at, ended_at.                                                                                |

Enums (in code and CHECK constraints where used): **Goal** (learn, exam, quiz), **LearningMethod** (examples, theory, practice, flashcards, summaries, socratic), **ExamDepth** (overview, moderate, deep), **QuizType** (multiple_choice, free_response, mixed), **SessionType**, **ResetType**.

---

## Tools

Defined in **src/tools.ts** with Zod schemas. Every tool has an **execute** function (no human-in-the-loop in this app; `toolsRequiringConfirmation` in `app.tsx` is empty).

| **answerGeneralQuestion** | Fallback for weather, facts, small talk. Calls Workers AI with GENERAL_QUESTION_SYSTEM; returns the model reply.  
| **getUserContext** | Returns `formatUserContextForDisplay()`: profile, topics studied, weak areas, recent quizzes, quiz stats.  
| **updateUserProfile** | Upserts name, major, year, preferredLearningMethods. Returns “Saved: …” plus next onboarding prompt (e.g. ask major/year).  
| **updateSessionPreferences** | Upserts goal and branch-specific fields (learn/exam/quiz). Returns “Session saved.” plus next question or “start teaching/quiz”.
| **updateKnowledge** | Upsert knowledge row: subject, topic, masteryLevel, confidence, incrementStudyCount, weakAreas, notes.  
| **getKnowledge** | List knowledge, optional filter by subject.  
| **getWeakAreas** | Topics with mastery &lt; 60 or confidence &lt; 50, up to limit.  
| **recordQuizResult** | Insert quiz_history, then update knowledge (merge weak areas, weighted mastery). Returns formatted “Quiz recorded: …”.  
| **getQuizHistory** | Recent quizzes, optional subject filter, limit.  
| **startStudySession** | Insert study_sessions row, return sessionId.  
| **endStudySession** | Set ended_at, summary, duration_minutes for sessionId.  
| **resetProgress** | resetType: all knowledge | quizzes | sessions; requires userConfirmed. Deletes from the relevant tables.

Scheduling tools (`scheduleTask`, `getScheduledTasks`, `cancelScheduledTask`) are implemented in code but **not** exported in the `tools` object used by the agent (comment: “not relevant for study app”).

---

## Prompts

All in **src/prompts.ts**.

1. **`CLASSIFIER_*`** — Intent classification → CONVERSATIONAL | LEARNING; includes context so short answers (e.g. “CS”) after “What’s your major?” are CONVERSATIONAL.
2. **`PLAN_GENERATOR_*`** — Input = user prompt; output = JSON array of step strings (1–10).
3. **`PROCESS_STEP_*`** — One step of the plan; includes step index, total steps, original prompt, previous steps.
4. **`KNOWLEDGE_INFER_*`** — From a learning prompt, output JSON `{ "subject": "...", "topic": "..." }` for the knowledge graph.
5. **`MAIN_SYSTEM_TEMPLATE`** / **`BASE_RULES`** — System prompt for the main chat: profile summary, missing profile fields, knowledge/weak/recent-quiz lines, tool usage rules (answerGeneralQuestion for anything that doesn’t fit, getUserContext, updateUserProfile, recordQuizResult, etc.), teaching style, quiz format.
6. **`MISSING_PROFILE_LINE_TEMPLATE`**, **`KNOWLEDGE_NONE_YET`**, **`WEAK_AREAS_NONE`**, **`RECENT_QUIZZES_*`** — Injected into main system prompt.
7. **`GENERAL_QUESTION_SYSTEM`** — System for answerGeneralQuestion (brief, helpful, no refusal).
8. **`TOOL_DESC_*`** — Tool descriptions for the model.
9. **`NEXT_ASK_*`** — Instructions returned after updateUserProfile / updateSessionPreferences (e.g. “NEXT: Ask what’s your major”).
10. **`ACKNOWLEDGMENT_TEMPLATE`**, **`TRACKING_MESSAGE_*`** — Plan acknowledgment and “added to knowledge graph” / “what’s next?” copy.
11. **`QUIZ_RECORDED_TEMPLATE`**, **`RESET_CANCELLED_MESSAGE`** — Tool return messages.

---

## Server (Chat Agent)

- **Class**: **Chat** extends **AIChatAgent&lt;Env&gt;** from `@cloudflare/ai-chat`. Env has `Chat` (DO namespace) and `AI` (Workers AI binding).
- **Lifecycle**: **onStart()** calls **initTables()** (creates the five tables if not exist).
- **Storage**: Messages and DB state are stored on the Durable Object instance (SQLite and agent state).
- **Public methods** used by tools (via getCurrentAgent&lt;Chat&gt;()): getUserProfile, updateUserProfile, getSessionPreferences, updateSessionPreferences, getKnowledge, getKnowledgeBySubject, getTopicMastery, updateKnowledge, getWeakAreas, recordQuiz, getQuizHistory, getQuizStats, startSession, endSession, getStudyStats, resetProgress, getFullContext, formatUserContextForDisplay, answerGeneralQuestion. Scheduling: schedule, getSchedules, cancelSchedule (used by scheduling tools when enabled), **executeTask** for plan steps and generic scheduled tasks.
- **Private helpers**: classifyIntent, generatePlan, parseStepsFromString, processStep, extractTopicFromPrompt, inferSubjectTopicFromAI, outputCombinedResult, buildSystemPrompt.
- **Message handling**: **onChatMessage** extracts last user text, classifies intent, then either **processSimpleQuestion** (streaming) or plan flow (ack + schedule PLAN_STEP:0). **processSimpleQuestion** uses **cleanupMessages**, **processToolCalls**, **buildSystemPrompt**, then **streamText** with Workers AI and merges the stream.
- **Worker export**: Default fetch handler checks pathname for `/check-open-ai-key` and `/test-max-tokens`, otherwise calls **routeAgentRequest(request, env)**; 404 if no route.

---

## Configuration

- **wrangler.jsonc**: name `cloudfare`, main `src/server.ts`, compatibility_date and nodejs_compat, **ai** binding with `remote: true`, **durable_objects** binding for class **Chat**, **migrations** for v1 with **new_sqlite_classes: ["Chat"]**, **assets** directory `public`, observability enabled.
- **vite.config.ts**: Cloudflare plugin, React, Tailwind; alias `@` → `src`.
- **env.d.ts**: Generated by Wrangler; declares Env (OPENAI_API_KEY, Chat, AI). Workers AI is used regardless of OPENAI_API_KEY in this app.
- **.dev.vars.example**: Example OPENAI_API_KEY (optional when using Workers AI only).

---

## Scripts & Deployment

- **npm run dev** / **npm start**: `vite dev` — local dev server (Vite + Cloudflare plugin).
- **npm run deploy**: `vite build && wrangler deploy` — build frontend and deploy Worker + assets.
- **npm run test**: Vitest with Cloudflare pool.
- **npm run types**: `wrangler types env.d.ts --include-runtime false`.
- **npm run format**: Prettier.
- **npm run check**: Prettier check + Biome lint + tsc.

---

## Debugging

- **tests/index.test.ts**: Uses `cloudflare:test` and the Worker’s default fetch. One test: request to `http://example.com` expects response body `"Not found"` and status 404 (no agent route matched).

---

## Project Structure

```
cf_ai/
├── .cursor/rules/          # Cursor IDE rules (e.g. cloudflare.mdc)
├── .dev.vars.example      # Example env (OPENAI_API_KEY optional)
├── .github/workflows/      # CI (e.g. sanity-check.yml)
├── .vscode/settings.json
├── index.html              # Single-page app shell, theme script, favicon
├── package.json
├── tsconfig.json
├── vite.config.ts         # Vite + Cloudflare + React + Tailwind
├── vitest.config.ts
├── wrangler.jsonc         # Worker, DO, AI binding, migrations, assets
├── env.d.ts                # Wrangler-generated Env types
├── biome.json
├── components.json
├── public/
│   └── favicon.ico
├── patches/                # patch-package (e.g. MCP SDK)
├── src/
│   ├── client.tsx         # React root, Providers, theme class on html
│   ├── app.tsx             # Main chat UI, useAgentChat, messages, input, tool cards
│   ├── server.ts           # Chat DO class, Worker fetch, all DB + AI logic
│   ├── tools.ts            # Tool definitions + executions (empty)
│   ├── types.ts            # Enums + interfaces (Goal, UserProfile, Knowledge, etc.)
│   ├── prompts.ts          # All prompt strings and templates
│   ├── utils.ts            # processToolCalls, cleanupMessages
│   ├── shared.ts           # APPROVAL (Yes/No strings for tool confirmation)
│   ├── styles.css          # Tailwind, theme, markdown styles
│   ├── lib/utils.ts        # cn() (clsx + tailwind-merge)
│   ├── providers/
│   │   ├── index.tsx       # ModalProvider, TooltipProvider
│   │   ├── ModalProvider.tsx
│   │   └── TooltipProvider.tsx
│   ├── components/         # Button, Card, Avatar, Toggle, Textarea, etc.
│   │   ├── memoized-markdown.tsx
│   │   ├── tool-invocation-card/ToolInvocationCard.tsx
│   │   └── ...
│   └── hooks/              # useTheme, useClickOutside, useMenuNavigation
└── tests/
    ├── index.test.ts
    └── tsconfig.json
```

---

## Summary

This app is a **full-featured AI study assistant** on Cloudflare: Durable Objects for stateful chat and SQLite, Workers AI for all inference, and a React UI. Intent classification decides between a single **conversational** turn (streaming + tools) and a **learning** plan (multi-step explanations with auto knowledge tracking). All study-related tools (profile, session, knowledge, quiz, study sessions, reset) are implemented and wired; scheduling tools exist in code but are not exposed in the agent’s tool set.
