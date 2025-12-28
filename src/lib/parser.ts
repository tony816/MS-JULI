import type {
  EditableExam,
  EditableQuestion,
  ExamData,
  ParseIssue,
  Question,
  QuestionType,
} from "./types";
import {
  extractIndicesFromText,
  guessQuestionType,
  isOxAnswer,
  normalizeChoiceToken,
  parseOxAnswer,
} from "./utils";

interface PlainBlock {
  id: string;
  promptLines: string[];
  choices: string[];
  choiceLabels: Array<string | undefined>;
  answerRaw: string;
  explanationLines: string[];
}

interface ChoiceToken {
  label?: string;
  text: string;
}

export interface ParseResult {
  exam: ExamData | null;
  editable: EditableExam | null;
  issues: ParseIssue[];
}

export function parseInput(raw: string, filename?: string): ParseResult {
  const trimmed = raw.trim();
  if (!trimmed) {
    return {
      exam: null,
      editable: null,
      issues: [{ level: "error", message: "입력값이 비어 있습니다." }],
    };
  }

  const looksJson =
    filename?.toLowerCase().endsWith(".json") ||
    trimmed.startsWith("{") ||
    trimmed.startsWith("[");

  if (looksJson) {
    try {
      const parsed = JSON.parse(trimmed);
      const { exam, issues } = normalizeJsonInput(parsed);
      return {
        exam,
        editable: exam ? toEditableExam(exam) : null,
        issues,
      };
    } catch {
      return {
        exam: null,
        editable: null,
        issues: [{ level: "error", message: "JSON 파싱에 실패했습니다." }],
      };
    }
  }

  const { exam, issues } = parsePlainText(trimmed);
  return {
    exam,
    editable: exam ? toEditableExam(exam) : null,
    issues,
  };
}

export function editableToExam(editable: EditableExam): { exam: ExamData; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  const questions: Question[] = editable.questions.map((item, index) => {
    const id = item.id.trim() || `Q${index + 1}`;
    const prompt = item.prompt.trim();
    const explanation = item.explanation.trim();
    const { choices, labels } = parseChoicesFromText(item.choicesText);

    if (!prompt) {
      issues.push({ level: "warn", message: "문제 지문이 비어 있습니다.", questionId: id });
    }

    const answerRaw = item.answerText.trim();

    if (item.type === "short") {
      const answerText = splitShortAnswerTokens(answerRaw);

      if (!answerText.length) {
        issues.push({ level: "warn", message: "정답이 비어 있습니다.", questionId: id });
      }

      return {
        id,
        type: "short",
        prompt,
        answerText,
        explanation: explanation || undefined,
      };
    }

    if (item.type === "ox") {
      const parsed = parseOxAnswer(answerRaw) ?? parseOxAnswer(answerRaw.replace(/\s/g, ""));
      let answer: number | undefined;

      if (parsed !== null) {
        answer = parsed;
      } else if (/\d+/.test(answerRaw)) {
        const indexValue = extractIndicesFromText(answerRaw, ["O", "X"])[0];
        if (indexValue !== undefined) {
          answer = indexValue;
        }
      }

      if (answer === undefined) {
        issues.push({ level: "warn", message: "O/X 정답을 확인하세요.", questionId: id });
      }

      return {
        id,
        type: "ox",
        prompt,
        choices: ["O", "X"],
        choiceLabels: ["O", "X"],
        answer,
        explanation: explanation || undefined,
      };
    }

    if (!choices.length) {
      issues.push({ level: "warn", message: "보기가 없습니다.", questionId: id });
    }

    const indices = extractIndicesFromText(answerRaw, choices);

    if (item.type === "multi") {
      if (!indices.length) {
        issues.push({ level: "warn", message: "복수 정답을 확인하세요.", questionId: id });
      }

      return {
        id,
        type: "multi",
        prompt,
        choices,
        choiceLabels: labels,
        answer: indices,
        explanation: explanation || undefined,
      };
    }

    if (!indices.length) {
      issues.push({ level: "warn", message: "정답을 확인하세요.", questionId: id });
    }

    return {
      id,
      type: "single",
      prompt,
      choices,
      choiceLabels: labels,
      answer: indices[0],
      explanation: explanation || undefined,
    };
  });

  return {
    exam: {
      title: editable.title.trim() || "무제 시험",
      questions: ensureUniqueIds(questions),
    },
    issues,
  };
}

export function toEditableExam(exam: ExamData): EditableExam {
  return {
    title: exam.title,
    questions: exam.questions.map((question) => ({
      id: question.id,
      type: question.type,
      prompt: question.prompt,
      choicesText: formatChoicesForEditor(question),
      answerText: formatAnswerForEditor(question),
      explanation: question.explanation ?? "",
    })),
  };
}

function formatAnswerForEditor(question: Question): string {
  if (question.type === "short") {
    return (question.answerText ?? []).join(" | ");
  }

  if (question.type === "multi") {
    return Array.isArray(question.answer)
      ? question.answer.map((index) => question.choiceLabels?.[index] ?? String(index + 1)).join(", ")
      : "";
  }

  if (question.type === "ox") {
    if (typeof question.answer === "number") {
      return question.answer === 0 ? "O" : "X";
    }
    return "";
  }

  return typeof question.answer === "number"
    ? question.choiceLabels?.[question.answer] ?? String(question.answer + 1)
    : "";
}

function parseChoicesFromText(choicesText: string): { choices: string[]; labels?: string[] } {
  const lines = choicesText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const choices: string[] = [];
  const labels: Array<string | undefined> = [];

  for (const line of lines) {
    const token = parseChoiceLine(line);
    if (token) {
      choices.push(normalizeChoiceToken(token.text));
      labels.push(token.label?.trim());
    } else {
      choices.push(normalizeChoiceToken(line));
      labels.push(undefined);
    }
  }

  const hasLabels = labels.some((label) => Boolean(label));
  return {
    choices,
    labels: hasLabels ? labels.map((label) => label || undefined) : undefined,
  };
}

function formatChoicesForEditor(question: Question): string {
  const choices = question.choices ?? [];
  const labels = question.choiceLabels ?? [];

  return choices
    .map((choice, index) => {
      const label = formatChoiceLabelForEditor(labels[index]);
      return label ? `${label} ${choice}` : choice;
    })
    .join("\n");
}

function formatChoiceLabelForEditor(label?: string): string | null {
  if (!label) {
    return null;
  }
  if (/[.)]$/.test(label)) {
    return label;
  }
  if (/^[①②③④⑤⑥⑦⑧⑨⑩]$/.test(label)) {
    return label;
  }
  if (/^[OX]$/i.test(label)) {
    return label.toUpperCase();
  }
  if (/^[A-Za-z0-9]+$/.test(label)) {
    return `${label}.`;
  }
  return label;
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function stripChoiceLabel(raw: string, label: string): string {
  const trimmed = raw.trim();
  const normalizedLabel = label.trim();
  if (!trimmed || !normalizedLabel) {
    return trimmed;
  }

  const escaped = escapeRegExp(normalizedLabel);
  const prefixPatterns = [
    new RegExp(`^${escaped}[\\)\\.\\:]*\\s+`, "i"),
    new RegExp(`^\\(${escaped}\\)\\s+`, "i"),
    new RegExp(`^\\[${escaped}\\]\\s+`, "i"),
  ];

  for (const pattern of prefixPatterns) {
    const next = trimmed.replace(pattern, "").trim();
    if (next !== trimmed && next) {
      return next;
    }
  }

  const suffixPatterns = [
    new RegExp(`\\s+\\(${escaped}\\)$`, "i"),
    new RegExp(`\\s+\\[${escaped}\\]$`, "i"),
    new RegExp(`\\s+${escaped}$`, "i"),
  ];

  for (const pattern of suffixPatterns) {
    const next = trimmed.replace(pattern, "").trim();
    if (next !== trimmed && next) {
      return next;
    }
  }

  return trimmed;
}

function parseTrailingChoiceLabel(raw: string): { text: string; label?: string } {
  const trimmed = raw.trim();
  if (!trimmed) {
    return { text: trimmed };
  }
  const match = trimmed.match(
    /^(.*?)(?:\s+|\s*[\(\[])([A-Za-z]|[0-9]{1,2}|[①②③④⑤⑥⑦⑧⑨⑩])[\)\]]?$/
  );
  if (!match) {
    return { text: trimmed };
  }
  const text = match[1]?.trim() ?? "";
  const label = match[2]?.trim();
  if (!text || !label) {
    return { text: trimmed };
  }
  return { text, label };
}

function normalizeChoicesFromJson(
  rawChoices: string[],
  rawChoiceLabels?: string[]
): { choices: string[]; choiceLabels?: string[] } {
  const choices: string[] = [];
  const labelsFromChoice: Array<string | undefined> = [];
  const parsedFlags: boolean[] = [];
  const trailingLabels: Array<string | undefined> = [];
  const trailingChoices: Array<string | undefined> = [];
  let trailingCount = 0;

  rawChoices.forEach((raw) => {
    const trimmed = String(raw ?? "").trim();
    const token = parseChoiceLine(trimmed);
    if (token) {
      choices.push(normalizeChoiceToken(token.text));
      labelsFromChoice.push(token.label?.trim());
      parsedFlags.push(true);
      trailingLabels.push(undefined);
      trailingChoices.push(undefined);
      return;
    }

    choices.push(normalizeChoiceToken(trimmed));
    labelsFromChoice.push(undefined);
    parsedFlags.push(false);

    const trailing = parseTrailingChoiceLabel(trimmed);
    if (trailing.label) {
      trailingLabels.push(trailing.label);
      trailingChoices.push(trailing.text);
      trailingCount += 1;
    } else {
      trailingLabels.push(undefined);
      trailingChoices.push(undefined);
    }
  });

  const providedLabels =
    rawChoiceLabels && rawChoiceLabels.length === rawChoices.length
      ? rawChoiceLabels.map((label) => label.trim())
      : undefined;

  let choiceLabels =
    providedLabels ||
    (labelsFromChoice.some((label) => Boolean(label))
      ? labelsFromChoice.map((label) => label || undefined)
      : undefined);

  let normalizedChoices = choices;
  if (choiceLabels) {
    const mergedLabels = choiceLabels.map((label, index) => label || trailingLabels[index]);
    if (mergedLabels.some((label) => Boolean(label))) {
      choiceLabels = mergedLabels;
    }
  } else if (trailingCount >= 2) {
    choiceLabels = trailingLabels.some((label) => Boolean(label))
      ? trailingLabels.map((label) => label || undefined)
      : undefined;
  }

  if (choiceLabels) {
    normalizedChoices = normalizedChoices.map((choice, index) => {
      if (parsedFlags[index]) {
        return choice;
      }
      const trailingChoice = trailingChoices[index];
      if (trailingChoice) {
        return normalizeChoiceToken(trailingChoice);
      }
      const label = choiceLabels?.[index];
      if (!label) {
        return choice;
      }
      const stripped = stripChoiceLabel(String(rawChoices[index] ?? ""), label);
      return normalizeChoiceToken(stripped || choice);
    });

    if (!choiceLabels.some((label) => Boolean(label))) {
      choiceLabels = undefined;
    }
  }

  return { choices: normalizedChoices, choiceLabels };
}

function collectNumericAnswers(value: unknown): number[] {
  if (typeof value === "number") {
    return [value];
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => collectNumericAnswers(entry));
  }
  if (typeof value === "string") {
    const trimmed = value.trim();
    if (!trimmed) {
      return [];
    }
    if (/^\d+$/.test(trimmed)) {
      return [Number(trimmed)];
    }
    const tokens = trimmed.split(/[\s,\/|;]+/).filter(Boolean);
    return tokens
      .map((token) => Number(token))
      .filter((token) => !Number.isNaN(token));
  }
  return [];
}

function inferAnswerIndexBase(rawQuestions: unknown[]): "zero" | "one" | null {
  let sawZero = false;
  let sawMax = false;

  rawQuestions.forEach((raw) => {
    if (!raw || typeof raw !== "object") {
      return;
    }
    const item = raw as Record<string, unknown>;
    const choiceCount = Array.isArray(item.choices) ? item.choices.length : 0;
    if (!choiceCount) {
      return;
    }
    const numbers = collectNumericAnswers(item.answer ?? item.answerText);
    numbers.forEach((value) => {
      if (value === 0) {
        sawZero = true;
      }
      if (value === choiceCount) {
        sawMax = true;
      }
    });
  });

  if (sawZero && !sawMax) {
    return "zero";
  }
  if (sawMax && !sawZero) {
    return "one";
  }
  return null;
}

function shouldPreferOneBased(choiceLabels?: string[]): boolean {
  if (!choiceLabels || !choiceLabels.length) {
    return false;
  }
  return choiceLabels.some((label) => Boolean(label) && !/^\d+$/.test(label));
}

function normalizeJsonInput(parsed: unknown): { exam: ExamData | null; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  let title = "무제 시험";
  let rawQuestions: unknown[] = [];

  if (Array.isArray(parsed)) {
    rawQuestions = parsed;
  } else if (typeof parsed === "object" && parsed) {
    const obj = parsed as Record<string, unknown>;
    title = typeof obj.title === "string" ? obj.title : title;
    if (Array.isArray(obj.questions)) {
      rawQuestions = obj.questions;
    }
  }

  if (!rawQuestions.length) {
    issues.push({ level: "error", message: "문제 데이터가 없습니다." });
    return { exam: null, issues };
  }

  const indexBase = inferAnswerIndexBase(rawQuestions);
  const questions: Question[] = rawQuestions.map((raw, index) =>
    normalizeJsonQuestion(raw, index, issues, indexBase)
  );

  return {
    exam: {
      title,
      questions: ensureUniqueIds(questions),
    },
    issues,
  };
}

function normalizeJsonQuestion(
  raw: unknown,
  index: number,
  issues: ParseIssue[],
  indexBase?: "zero" | "one" | null
): Question {
  const fallbackId = `Q${index + 1}`;
  if (!raw || typeof raw !== "object") {
    issues.push({ level: "warn", message: "문제 형식이 올바르지 않습니다.", questionId: fallbackId });
    return { id: fallbackId, type: "short", prompt: "", answerText: [] };
  }

  const item = raw as Record<string, unknown>;
  const id = typeof item.id === "string" && item.id.trim() ? item.id.trim() : fallbackId;
  const prompt = typeof item.prompt === "string" ? item.prompt : "";
  const type = normalizeQuestionType(item.type, item, issues, id);
  const explanation = typeof item.explanation === "string" ? item.explanation : undefined;

  const rawChoices = Array.isArray(item.choices)
    ? item.choices.map((choice) => String(choice))
    : [];
  const rawChoiceLabels = Array.isArray(item.choiceLabels)
    ? item.choiceLabels.map((label) => String(label).trim())
    : undefined;
  const { choices: normalizedChoices, choiceLabels } = normalizeChoicesFromJson(
    rawChoices,
    rawChoiceLabels
  );
  const effectiveIndexBase =
    indexBase === "one" || indexBase === "zero"
      ? indexBase
      : shouldPreferOneBased(choiceLabels)
        ? "one"
        : undefined;

  if ((type === "single" || type === "multi") && !normalizedChoices.length) {
    issues.push({ level: "warn", message: "보기가 없습니다.", questionId: id });
  }

  if (type === "short") {
    const answerText = normalizeShortAnswers(item);
    if (!answerText.length) {
      issues.push({ level: "warn", message: "정답이 비어 있습니다.", questionId: id });
    }

    return {
      id,
      type,
      prompt,
      answerText,
      explanation,
    };
  }

  if (type === "ox") {
    const oxAnswer = normalizeOxAnswer(item.answer ?? item.answerText, effectiveIndexBase);
    if (oxAnswer === undefined) {
      issues.push({ level: "warn", message: "O/X 정답을 확인하세요.", questionId: id });
    }

    return {
      id,
      type,
      prompt,
      choices: ["O", "X"],
      choiceLabels: ["O", "X"],
      answer: oxAnswer,
      explanation,
    };
  }

  const parsedIndices = normalizeChoiceAnswer(
    item.answer ?? item.answerText,
    normalizedChoices,
    effectiveIndexBase
  );
  if (!parsedIndices.length) {
    issues.push({ level: "warn", message: "정답을 확인하세요.", questionId: id });
  }

  if (type === "multi") {
    return {
      id,
      type,
      prompt,
      choices: normalizedChoices,
      choiceLabels,
      answer: parsedIndices,
      explanation,
    };
  }

  return {
    id,
    type: "single",
    prompt,
    choices: normalizedChoices,
    choiceLabels,
    answer: parsedIndices[0],
    explanation,
  };
}

function normalizeQuestionType(
  rawType: unknown,
  item: Record<string, unknown>,
  issues: ParseIssue[],
  questionId: string
): QuestionType {
  if (typeof rawType === "string") {
    const normalized = rawType.toLowerCase();
    if (["single", "multi", "short", "ox", "truefalse", "tf"].includes(normalized)) {
      if (normalized === "truefalse" || normalized === "tf") {
        return "ox";
      }
      return normalized as QuestionType;
    }
  }

  const hasChoices = Array.isArray(item.choices) && item.choices.length > 0;
  const hasShort = item.answerText || typeof item.answer === "string";
  if (hasChoices) {
    return "single";
  }
  if (hasShort) {
    return "short";
  }

  issues.push({ level: "warn", message: "문제 타입을 추정했습니다.", questionId });
  return "short";
}

function normalizeShortAnswers(item: Record<string, unknown>): string[] {
  if (Array.isArray(item.answerText)) {
    return item.answerText.map((value) => String(value).trim()).filter(Boolean);
  }
  if (typeof item.answerText === "string") {
    return splitShortAnswerTokens(item.answerText);
  }
  if (typeof item.answer === "string") {
    return splitShortAnswerTokens(item.answer);
  }
  return [];
}

function normalizeOxAnswer(value: unknown, indexBase?: "zero" | "one"): number | undefined {
  if (typeof value === "number") {
    if (indexBase === "one") {
      if (value === 1) {
        return 0;
      }
      if (value === 2) {
        return 1;
      }
    }
    return value === 0 ? 0 : 1;
  }
  if (typeof value === "string") {
    const parsed = parseOxAnswer(value);
    if (parsed !== null) {
      return parsed;
    }
    const fromIndex = extractIndicesFromText(value, ["O", "X"])[0];
    if (fromIndex !== undefined) {
      return fromIndex;
    }
  }
  return undefined;
}

function normalizeChoiceAnswer(
  value: unknown,
  choices: string[],
  indexBase?: "zero" | "one"
): number[] {
  const normalizeIndex = (index: number): number | null => {
    if (!Number.isFinite(index)) {
      return null;
    }
    if (indexBase === "one") {
      if (choices.length > 0 && index >= 1 && index <= choices.length) {
        return index - 1;
      }
      if (index === 0) {
        return 0;
      }
      return index;
    }
    if (indexBase === "zero") {
      return index;
    }
    if (choices.length > 0 && index === choices.length) {
      return index - 1;
    }
    return index;
  };

  if (Array.isArray(value)) {
    const indices: number[] = [];
    value.forEach((entry) => {
      if (typeof entry === "number") {
        const normalized = normalizeIndex(entry);
        if (normalized !== null) {
          indices.push(normalized);
        }
        return;
      }
      if (typeof entry === "string") {
        indices.push(...extractIndicesFromText(entry, choices));
        return;
      }
      if (Array.isArray(entry)) {
        indices.push(...normalizeChoiceAnswer(entry, choices, indexBase));
      }
    });
    return Array.from(new Set(indices)).filter((idx) => idx >= 0);
  }
  if (typeof value === "number") {
    const normalized = normalizeIndex(value);
    return normalized === null ? [] : [normalized];
  }
  if (typeof value === "string") {
    return extractIndicesFromText(value, choices);
  }
  return [];
}

interface AnswerKeyEntry {
  answer: string;
  explanation?: string;
}

function splitAnswerSection(raw: string): { questionText: string; answerText: string | null } {
  const lines = raw.replace(/\r\n/g, "\n").split("\n");
  let splitIndex = -1;

  for (let i = 0; i < lines.length; i += 1) {
    const trimmed = lines[i].trim();
    if (!trimmed) {
      continue;
    }
    if (/:/.test(trimmed)) {
      continue;
    }
    const normalized = trimmed.replace(/^#{1,6}\s*/, "").trim();
    if (/^(정답|정답\s*(?:&|및|\/)\s*해설|Answer\s*Key)$/i.test(normalized)) {
      splitIndex = i;
      break;
    }
  }

  if (splitIndex < 0) {
    return { questionText: raw, answerText: null };
  }

  return {
    questionText: lines.slice(0, splitIndex).join("\n"),
    answerText: lines.slice(splitIndex + 1).join("\n"),
  };
}

function parseAnswerKey(raw: string): Map<string, AnswerKeyEntry> {
  const entries = new Map<string, AnswerKeyEntry>();
  const lines = raw.replace(/\r\n/g, "\n").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (isSectionDivider(trimmed) || isSectionHeading(trimmed)) {
      continue;
    }

    const cleaned = stripMarkdown(trimmed);
    const match = cleaned.match(/^(\d+)\s*[\)\.]?\s*(.+)$/);
    if (!match) {
      continue;
    }

    const key = `Q${match[1]}`;
    const parsed = parseAnswerEntry(match[2].trim());
    if (parsed) {
      entries.set(key, parsed);
    }
  }

  return entries;
}

function parseAnswerEntry(raw: string): AnswerKeyEntry | null {
  if (!raw) {
    return null;
  }

  const boldMatch = raw.match(/\*\*(.+?)\*\*/);
  if (boldMatch) {
    const answer = boldMatch[1].trim();
    const remainder = raw.replace(boldMatch[0], "").trim();
    const explanation = remainder ? stripWrappingParens(stripMarkdown(remainder)) : undefined;
    return { answer, explanation };
  }

  const cleaned = stripMarkdown(raw);
  const exampleMatch = cleaned.match(/^(?:예[:\)])\s*(.+)$/);
  if (exampleMatch) {
    return { answer: exampleMatch[1].trim() };
  }

  const splitMatch = cleaned.match(/^(.+?)\s*(?:\((.+)\))?\s*$/);
  if (splitMatch) {
    const candidate = splitMatch[1].trim();
    const detail = splitMatch[2]?.trim();
    if (detail && isShortAnswerToken(candidate)) {
      return { answer: candidate, explanation: detail };
    }
  }

  return { answer: cleaned.trim() };
}

function isShortAnswerToken(value: string): boolean {
  const trimmed = value.trim();
  if (trimmed.length <= 24) {
    return true;
  }
  return /^[A-Za-z]$/.test(trimmed) || /^(O|X)$/i.test(trimmed);
}

function stripWrappingParens(value: string): string {
  const trimmed = value.trim();
  if (trimmed.startsWith("(") && trimmed.endsWith(")")) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function stripMarkdown(line: string): string {
  return line
    .replace(/^\s*[-*+>]\s+/, "")
    .replace(/\*\*/g, "")
    .replace(/__/g, "")
    .replace(/`/g, "")
    .trim();
}

function isSectionDivider(line: string): boolean {
  return /^[-–—]{3,}$/.test(line.trim());
}

function isSectionHeading(line: string): boolean {
  if (/^#{1,6}\s+/.test(line)) {
    return true;
  }
  const normalized = stripMarkdown(line).toLowerCase();
  return /^(객관식|ox|빈칸|사례형|정답|해설)/.test(normalized);
}

function splitShortAnswerTokens(raw: string): string[] {
  const trimmed = raw.trim();
  if (!trimmed) {
    return [];
  }
  const tokens = trimmed
    .split(/[|,;/]+/)
    .map((value) => value.trim())
    .filter(Boolean);

  if (tokens.length <= 1) {
    return tokens;
  }

  const unique = new Set(tokens);
  if (!unique.has(trimmed)) {
    unique.add(trimmed);
  }
  return Array.from(unique);
}

function parsePlainText(raw: string): { exam: ExamData | null; issues: ParseIssue[] } {
  const issues: ParseIssue[] = [];
  const blocks: PlainBlock[] = [];
  let current: PlainBlock | null = null;
  let lastWasBlank = true;

  const commitCurrent = () => {
    if (!current) {
      return;
    }
    blocks.push(current);
    current = null;
  };

  const startBlock = (id: string, prompt?: string) => {
    commitCurrent();
    current = {
      id,
      promptLines: prompt ? [prompt] : [],
      choices: [],
      choiceLabels: [],
      answerRaw: "",
      explanationLines: [],
    };
  };

  const { questionText, answerText } = splitAnswerSection(raw);
  const answerKey = answerText ? parseAnswerKey(answerText) : new Map<string, AnswerKeyEntry>();
  const lines = questionText.replace(/\r\n/g, "\n").split("\n");

  for (const line of lines) {
    const trimmed = line.trim();

    if (!trimmed) {
      lastWasBlank = true;
      continue;
    }

    const cleaned = stripMarkdown(trimmed);

    const answerMatch = cleaned.match(/^(정답|Answer)\s*[:\)\-]\s*(.+)$/i);
    if (answerMatch) {
      if (!current) {
        startBlock(`Q${blocks.length + 1}`);
      }
      current.answerRaw = answerMatch[2].trim();
      lastWasBlank = false;
      continue;
    }

    const explanationMatch = cleaned.match(/^(해설|Explanation)\s*[:\)\-]\s*(.+)$/i);
    if (explanationMatch) {
      if (!current) {
        startBlock(`Q${blocks.length + 1}`);
      }
      current.explanationLines.push(explanationMatch[2].trim());
      lastWasBlank = false;
      continue;
    }

    const questionStart = parseQuestionStart(cleaned, !current || lastWasBlank);
    if (questionStart) {
      startBlock(questionStart.id, questionStart.prompt);
      lastWasBlank = false;
      continue;
    }

    const choiceToken = parseChoiceLine(trimmed) ?? parseChoiceLine(cleaned);
    if (choiceToken && current) {
      current.choices.push(choiceToken.text);
      current.choiceLabels.push(choiceToken.label);
      lastWasBlank = false;
      continue;
    }

    if (isSectionDivider(trimmed) || isSectionHeading(trimmed)) {
      lastWasBlank = true;
      continue;
    }

    if (!current) {
      startBlock(`Q${blocks.length + 1}`, cleaned);
    } else if (current.choices.length) {
      const lastIndex = current.choices.length - 1;
      current.choices[lastIndex] = `${current.choices[lastIndex]} ${cleaned}`.trim();
    } else {
      current.promptLines.push(cleaned);
    }
    lastWasBlank = false;
  }

  commitCurrent();

  if (!blocks.length) {
    issues.push({ level: "error", message: "문제 데이터를 찾지 못했습니다." });
    return { exam: null, issues };
  }

  const questions = blocks.map((block, index) => {
    const id = block.id.trim() || `Q${index + 1}`;
    const prompt = block.promptLines.join("\n").trim();
    let explanation = block.explanationLines.join(" ").trim();
    const answerEntry = answerKey.get(id) ?? answerKey.get(`Q${index + 1}`);
    let answerRaw = block.answerRaw.trim();
    if (!answerRaw && answerEntry) {
      answerRaw = answerEntry.answer.trim();
    }
    if (!explanation && answerEntry?.explanation) {
      explanation = answerEntry.explanation.trim();
    }
    const choices = block.choices.map((choice) => normalizeChoiceToken(choice));
    const choiceLabels = block.choiceLabels.some((label) => label) ? block.choiceLabels : undefined;
    const type = guessQuestionType(choices, answerRaw);

    if (!prompt) {
      issues.push({ level: "warn", message: "문제 지문이 비어 있습니다.", questionId: id });
    }

    if (!answerRaw) {
      issues.push({ level: "warn", message: "정답이 비어 있습니다.", questionId: id });
    }

    if ((type === "single" || type === "multi") && !choices.length) {
      issues.push({ level: "warn", message: "보기가 없습니다.", questionId: id });
    }

    if (type === "short") {
      const answerText = answerRaw ? splitShortAnswerTokens(answerRaw) : [];

      return {
        id,
        type,
        prompt,
        answerText,
        explanation: explanation || undefined,
      };
    }

    if (type === "ox") {
      const answer = answerRaw ? parseOxAnswer(answerRaw) ?? extractIndicesFromText(answerRaw, ["O", "X"])[0] : undefined;
      if (answer === undefined) {
        issues.push({ level: "warn", message: "O/X 정답을 확인하세요.", questionId: id });
      }

      return {
        id,
        type,
        prompt,
        choices: ["O", "X"],
        choiceLabels: ["O", "X"],
        answer,
        explanation: explanation || undefined,
      };
    }

    const parsedIndices = answerRaw ? extractIndicesFromText(answerRaw, choices) : [];

    if (type === "multi") {
      if (!parsedIndices.length) {
        issues.push({ level: "warn", message: "복수 정답을 확인하세요.", questionId: id });
      }
      return {
        id,
        type,
        prompt,
        choices,
        choiceLabels,
        answer: parsedIndices,
        explanation: explanation || undefined,
      };
    }

    if (!parsedIndices.length) {
      issues.push({ level: "warn", message: "정답을 확인하세요.", questionId: id });
    }

    return {
      id,
      type,
      prompt,
      choices,
      choiceLabels,
      answer: parsedIndices[0],
      explanation: explanation || undefined,
    };
  });

  return {
    exam: {
      title: "간편 모드",
      questions: ensureUniqueIds(questions),
    },
    issues,
  };
}

function parseQuestionStart(line: string, allowNumeric: boolean): { id: string; prompt: string } | null {
  let match = line.match(/^(?:문제|Question)\s*#?\s*(\d+)\s*[\)\.:]?\s*(.*)$/i);
  if (match) {
    return { id: `Q${match[1]}`, prompt: match[2]?.trim() ?? "" };
  }

  match = line.match(/^Q\s*(\d+)\s*[\)\.:]?\s*(.*)$/i);
  if (match) {
    return { id: `Q${match[1]}`, prompt: match[2]?.trim() ?? "" };
  }

  match = line.match(/^#\s*(\d+)\s*(.*)$/i);
  if (match) {
    return { id: `Q${match[1]}`, prompt: match[2]?.trim() ?? "" };
  }

  if (allowNumeric) {
    match = line.match(/^(\d+)\s*[\)\.:]\s*(.*)$/);
    if (match) {
      return { id: `Q${match[1]}`, prompt: match[2]?.trim() ?? "" };
    }
  }

  return null;
}

function parseChoiceLine(line: string): ChoiceToken | null {
  const circledMatch = line.match(/^([①②③④⑤⑥⑦⑧⑨⑩])\s*(.+)$/);
  if (circledMatch) {
    return { label: circledMatch[1], text: circledMatch[2].trim() };
  }

  const numericMatch = line.match(/^(\d+)\s*[\)\.]\s*(.+)$/);
  if (numericMatch) {
    return { label: numericMatch[1], text: numericMatch[2].trim() };
  }

  const letterMatch = line.match(/^([A-Z])\s*[\)\.]\s*(.+)$/i);
  if (letterMatch) {
    return { label: letterMatch[1].toUpperCase(), text: letterMatch[2].trim() };
  }

  const bulletMatch = line.match(/^[-•]\s*(.+)$/);
  if (bulletMatch) {
    return { text: bulletMatch[1].trim() };
  }

  return null;
}

function ensureUniqueIds(questions: Question[]): Question[] {
  const seen = new Map<string, number>();
  return questions.map((question) => {
    const base = question.id;
    const count = seen.get(base) ?? 0;
    seen.set(base, count + 1);
    if (count === 0) {
      return question;
    }
    return { ...question, id: `${base}-${count + 1}` };
  });
}

