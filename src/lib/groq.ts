import type { ExamData, Question, UserAnswer } from "./types";
import { gradeExam, isAnswered, type GradeSummary } from "./grading";
import { formatChoiceLabel } from "./utils";

const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";
const GROQ_MAX_TOKENS = 4096;
const GROQ_TEMPERATURE = 0;

interface GroqMessage {
  role: "system" | "user";
  content: string;
}

interface GroqResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

interface GroqGradeResult {
  id?: string;
  correct?: boolean | string | null;
}

interface GroqGradeResponse {
  results?: GroqGradeResult[];
}

interface GradingChoice {
  index: number;
  label: string;
  text: string;
}

interface GradingItem {
  id: string;
  type: Question["type"];
  prompt: string;
  choices?: GradingChoice[];
  correct: {
    indices: number[];
    text: string[];
  };
  user: {
    indices: number[];
    text?: string;
  };
}

const SYSTEM_PROMPT = [
  "You convert raw exam questions into JSON for the exam-grader app.",
  "Return only valid JSON, no markdown.",
  "Use double quotes for keys/strings and no trailing commas.",
  "If the content includes double quotes, replace them with single quotes inside text.",
  "Do not wrap the response in code fences.",
  "Keep the JSON compact to fit token limits.",
  "Do not include explanations if none are provided.",
  "Schema:",
  "{",
  "  \"title\": string,",
  "  \"questions\": [",
  "    {",
  "      \"id\": \"Q1\",",
  "      \"type\": \"single\" | \"multi\" | \"short\" | \"ox\",",
  "      \"prompt\": string,",
  "      \"choices\": string[],",
  "      \"choiceLabels\": string[],",
  "      \"answer\": number | number[],",
  "      \"answerText\": string[],",
  "      \"explanation\": string",
  "    }",
  "  ]",
  "}",
  "Rules:",
  "- Use 0-based indices for answer/answers (0 = first choice).",
  "- For short answers, set answerText as an array of strings.",
  "- For O/X, set answer as 0 (O) or 1 (X).",
  "- Omit optional fields when not needed.",
].join("\n");

const GRADING_SYSTEM_PROMPT = [
  "You grade exam answers for the exam-grader app.",
  "Decide whether each user's answer is correct using the official answers provided.",
  "Input JSON: { items: [ { id, type, prompt, choices?, correct: { indices, text }, user: { indices, text? } } ] }",
  "choices entries are { index, label, text } when present.",
  "Rules:",
  "- Indices are 0-based.",
  "- single/ox: correct if user.indices has exactly one value equal to correct.indices[0].",
  "- multi: correct if user.indices set equals correct.indices set (order does not matter).",
  "- short: correct if user.text matches any correct.text semantically (ignore case/spacing/punctuation; allow common synonyms).",
  "- If there is no official answer, mark correct as false.",
  "Return only JSON with schema: {\"results\":[{\"id\":\"Q1\",\"correct\":true}]}",
  "Return one result per input item in the same order.",
].join("\n");

const GROQ_GRADING_MAX_TOKENS = 2048;

function getExpectedQuestionCount(input: string): number | null {
  const patterns = [
    /(?:^|\n)\s*\*{0,2}\s*문제\s*(\d+)\b/g,
    /(?:^|\n)\s*\*{0,2}\s*Question\s*(\d+)\b/gi,
    /(?:^|\n)\s*\*{0,2}\s*Q\s*(\d+)\b/gi,
  ];
  let max = 0;
  for (const pattern of patterns) {
    for (const match of input.matchAll(pattern)) {
      const value = Number(match[1]);
      if (!Number.isNaN(value)) {
        max = Math.max(max, value);
      }
    }
  }
  return max > 0 ? max : null;
}

function buildMessages(input: string): GroqMessage[] {
  const expectedCount = getExpectedQuestionCount(input);
  const countHint = expectedCount
    ? `The input contains ${expectedCount} questions. Return exactly ${expectedCount} questions with ids Q1..Q${expectedCount} in order. Do not omit any questions.`
    : "";
  const systemContent = countHint ? `${SYSTEM_PROMPT}\n${countHint}` : SYSTEM_PROMPT;
  return [
    { role: "system", content: systemContent },
    {
      role: "user",
      content: ["입력 텍스트:", input.trim()].join("\n"),
    },
  ];
}

function stripCodeFences(text: string): string {
  return text.replace(/```(?:json)?/gi, "").replace(/```/g, "");
}

function stripBom(text: string): string {
  return text.replace(/^\uFEFF/, "");
}

function normalizeQuotes(text: string): string {
  return text.replace(/[“”]/g, "\"").replace(/[‘’]/g, "'");
}

function extractJsonCandidate(text: string): string | null {
  const trimmed = text.trim();
  if (trimmed.startsWith("{") || trimmed.startsWith("[")) {
    return trimmed;
  }

  const objectStart = trimmed.indexOf("{");
  const objectEnd = trimmed.lastIndexOf("}");
  if (objectStart >= 0 && objectEnd > objectStart) {
    return trimmed.slice(objectStart, objectEnd + 1);
  }

  const arrayStart = trimmed.indexOf("[");
  const arrayEnd = trimmed.lastIndexOf("]");
  if (arrayStart >= 0 && arrayEnd > arrayStart) {
    return trimmed.slice(arrayStart, arrayEnd + 1);
  }

  return null;
}

function removeTrailingCommas(text: string): string {
  return text.replace(/,\s*([}\]])/g, "$1");
}

function escapeUnescapedQuotes(text: string): string {
  let result = "";
  let inString = false;
  let escaped = false;

  const isWhitespace = (value: string) => value === " " || value === "\n" || value === "\r" || value === "\t";
  const getNextNonSpace = (start: number) => {
    for (let i = start; i < text.length; i += 1) {
      if (!isWhitespace(text[i])) {
        return text[i];
      }
    }
    return null;
  };

  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];

    if (!inString) {
      if (char === "\"") {
        inString = true;
      }
      result += char;
      continue;
    }

    if (escaped) {
      result += char;
      escaped = false;
      continue;
    }

    if (char === "\\") {
      result += char;
      escaped = true;
      continue;
    }

    if (char === "\"") {
      const next = getNextNonSpace(i + 1);
      if (next === null || next === "," || next === "}" || next === "]" || next === ":") {
        inString = false;
        result += char;
      } else {
        result += "\\\"";
      }
      continue;
    }

    if (char === "\n") {
      result += "\\n";
      continue;
    }

    if (char === "\r") {
      result += "\\r";
      continue;
    }

    if (char === "\t") {
      result += "\\t";
      continue;
    }

    result += char;
  }

  return result;
}

function extractBalancedJson(text: string): string | null {
  const length = text.length;
  for (let start = 0; start < length; start += 1) {
    const startChar = text[start];
    if (startChar !== "{" && startChar !== "[") {
      continue;
    }

    const stack: string[] = [startChar];
    let inString = false;
    let escaped = false;

    for (let i = start + 1; i < length; i += 1) {
      const char = text[i];

      if (inString) {
        if (escaped) {
          escaped = false;
          continue;
        }
        if (char === "\\") {
          escaped = true;
          continue;
        }
        if (char === "\"") {
          inString = false;
        }
        continue;
      }

      if (char === "\"") {
        inString = true;
        continue;
      }

      if (char === "{" || char === "[") {
        stack.push(char);
        continue;
      }

      if (char === "}" || char === "]") {
        const last = stack[stack.length - 1];
        const matches = (char === "}" && last === "{") || (char === "]" && last === "[");
        if (!matches) {
          break;
        }
        stack.pop();
        if (stack.length === 0) {
          return text.slice(start, i + 1);
        }
      }
    }
  }

  return null;
}

function buildParseError(text: string): Error {
  const compact = text.replace(/\s+/g, " ").trim();
  const excerpt = compact.slice(0, 600);
  const suffix = compact.length > 600 ? "..." : "";
  return new Error(`Groq 응답에서 JSON을 파싱하지 못했습니다. 응답 일부: ${excerpt}${suffix}`);
}

function parseJsonFromText(text: string): unknown {
  const cleaned = normalizeQuotes(stripBom(stripCodeFences(text))).trim();
  const candidates: string[] = [];

  if (cleaned) {
    candidates.push(cleaned);
  }

  const extracted = extractJsonCandidate(cleaned);
  if (extracted && extracted !== cleaned) {
    candidates.push(extracted);
  }

  const balanced = extractBalancedJson(cleaned);
  if (balanced && !candidates.includes(balanced)) {
    candidates.push(balanced);
  }

  for (const candidate of candidates) {
    try {
      return JSON.parse(candidate);
    } catch {
      try {
        return JSON.parse(removeTrailingCommas(candidate));
      } catch {
        try {
          return JSON.parse(escapeUnescapedQuotes(candidate));
        } catch {
          try {
            return JSON.parse(escapeUnescapedQuotes(removeTrailingCommas(candidate)));
          } catch {
            continue;
          }
        }
      }
    }
  }

  throw buildParseError(cleaned);
}

function normalizeIndices(values: number[]): number[] {
  return Array.from(new Set(values))
    .filter((value) => typeof value === "number" && Number.isFinite(value))
    .sort((a, b) => a - b);
}

function toIndexArray(value: UserAnswer | number | number[] | null | undefined): number[] {
  if (Array.isArray(value)) {
    return normalizeIndices(value);
  }
  if (typeof value === "number") {
    return normalizeIndices([value]);
  }
  return [];
}

function buildChoiceEntries(question: Question): GradingChoice[] {
  const baseChoices =
    question.type === "ox" && (!question.choices || question.choices.length === 0)
      ? ["O", "X"]
      : question.choices ?? [];

  if (!baseChoices.length) {
    return [];
  }

  return baseChoices.map((text, index) => {
    const label =
      question.type === "ox"
        ? question.choiceLabels?.[index] ?? (index === 0 ? "O" : "X")
        : formatChoiceLabel(question, index);
    return { index, label, text };
  });
}

function buildGradingItems(exam: ExamData, answers: Record<string, UserAnswer>): GradingItem[] {
  const items: GradingItem[] = [];

  for (const question of exam.questions) {
    const userAnswer = answers[question.id] ?? null;
    if (!isAnswered(question, userAnswer)) {
      continue;
    }

    const correctIndices = toIndexArray(question.answer ?? null);
    const userIndices = toIndexArray(userAnswer);
    const userText = typeof userAnswer === "string" ? userAnswer.trim() : "";
    const choices = buildChoiceEntries(question);

    const item: GradingItem = {
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      correct: {
        indices: correctIndices,
        text: question.answerText ? [...question.answerText] : [],
      },
      user: {
        indices: userIndices,
      },
    };

    if (choices.length) {
      item.choices = choices;
    }

    if (userText) {
      item.user.text = userText;
    }

    items.push(item);
  }

  return items;
}

function normalizeCorrectValue(value: unknown): boolean | null {
  if (typeof value === "boolean") {
    return value;
  }
  if (typeof value === "string") {
    const lower = value.trim().toLowerCase();
    if (lower === "true") {
      return true;
    }
    if (lower === "false") {
      return false;
    }
  }
  return null;
}

function parseGradingResults(payload: unknown): Map<string, boolean> {
  if (!payload || typeof payload !== "object") {
    throw new Error("Groq grading response invalid.");
  }

  const results = (payload as GroqGradeResponse).results;
  if (!Array.isArray(results)) {
    throw new Error("Groq grading response invalid.");
  }

  const map = new Map<string, boolean>();
  for (const entry of results) {
    if (!entry) {
      continue;
    }
    const id = typeof entry.id === "string" ? entry.id : "";
    const correct = normalizeCorrectValue(entry.correct);
    if (id && correct !== null) {
      map.set(id, correct);
    }
  }

  if (!map.size) {
    throw new Error("Groq grading response missing results.");
  }

  return map;
}

async function requestGroq(
  messages: GroqMessage[],
  options: {
    useJsonMode?: boolean;
    model?: string;
    maxTokens?: number;
    temperature?: number;
  } = {}
): Promise<string> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("Missing VITE_GROQ_API_KEY.");
  }

  const bodyBase = {
    model: options.model ?? GROQ_MODEL,
    temperature: options.temperature ?? GROQ_TEMPERATURE,
    max_tokens: options.maxTokens ?? GROQ_MAX_TOKENS,
    messages,
  };

  const requestOnce = async (useJsonMode: boolean): Promise<string> => {
    const response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        ...bodyBase,
        ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
      }),
    });

    let payload: GroqResponse | null = null;
    try {
      payload = (await response.json()) as GroqResponse;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail = payload?.error?.message || `Groq request failed (${response.status})`;
      throw new Error(detail);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Groq response missing content.");
    }

    return content;
  };

  if (!options.useJsonMode) {
    return requestOnce(false);
  }

  try {
    return await requestOnce(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    const lowered = message.toLowerCase();
    if (
      lowered.includes("response_format") ||
      lowered.includes("json_object") ||
      lowered.includes("failed_generation") ||
      lowered.includes("failed to generate json")
    ) {
      return requestOnce(false);
    }
    throw error;
  }
}

export async function parseExamWithGroq(input: string): Promise<unknown> {
  const content = await requestGroq(buildMessages(input), { useJsonMode: true });
  return parseJsonFromText(content);
}

export async function gradeExamWithGroq(
  exam: ExamData,
  answers: Record<string, UserAnswer>
): Promise<GradeSummary> {
  const base = gradeExam(exam, answers);
  const items = buildGradingItems(exam, answers);

  if (!items.length) {
    return base;
  }

  const content = await requestGroq(
    [
      { role: "system", content: GRADING_SYSTEM_PROMPT },
      { role: "user", content: JSON.stringify({ items }) },
    ],
    { useJsonMode: true, maxTokens: GROQ_GRADING_MAX_TOKENS }
  );

  const parsed = parseJsonFromText(content);
  const gradingMap = parseGradingResults(parsed);

  const results = base.results.map((result) => {
    const override = gradingMap.get(result.id);
    if (typeof override !== "boolean") {
      return result;
    }
    return { ...result, correct: override };
  });

  const total = results.length;
  const correct = results.filter((item) => item.correct).length;
  const unanswered = results.filter((item) => !item.answered).length;
  const incorrect = total - correct - unanswered;
  const accuracy = total ? Math.round((correct / total) * 100) : 0;

  return {
    total,
    correct,
    incorrect,
    unanswered,
    accuracy,
    results,
  };
}
