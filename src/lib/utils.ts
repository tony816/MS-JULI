import type { Question } from "./types";

const CIRCLED_NUMBERS: Record<string, number> = {
  "①": 0,
  "②": 1,
  "③": 2,
  "④": 3,
  "⑤": 4,
  "⑥": 5,
  "⑦": 6,
  "⑧": 7,
  "⑨": 8,
  "⑩": 9,
};

const CIRCLED_LABELS = new Set(Object.keys(CIRCLED_NUMBERS));

export function normalizeShortAnswer(value: string): string {
  return value
    .trim()
    .replace(/\s+/g, " ")
    .toLowerCase();
}

export function normalizeChoiceToken(token: string): string {
  return token.trim().replace(/\s+/g, " ");
}

export function extractIndicesFromText(raw: string, choices: string[] = []): number[] {
  const cleaned = raw
    .replace(/[()\[\]{}]/g, " ")
    .replace(/[·•]/g, " ")
    .replace(/\s+/g, " ")
    .trim();

  if (!cleaned) {
    return [];
  }

  const tokens = cleaned.split(/[\s,\/|;]+/).filter(Boolean);
  const indices: number[] = [];

  for (const token of tokens) {
    const normalizedToken = token.replace(/[.)]$/, "");

    if (CIRCLED_NUMBERS[normalizedToken] !== undefined) {
      indices.push(CIRCLED_NUMBERS[normalizedToken]);
      continue;
    }

    const numericMatch = normalizedToken.match(/\d+/);
    if (numericMatch) {
      const asNumber = Number(numericMatch[0]);
      if (!Number.isNaN(asNumber) && asNumber > 0) {
        indices.push(asNumber - 1);
        continue;
      }
    }

    if (/^[A-Za-z]$/.test(normalizedToken)) {
      const upper = normalizedToken.toUpperCase();
      indices.push(upper.charCodeAt(0) - 65);
      continue;
    }

    const normalizedChoiceToken = normalizeChoiceToken(normalizedToken).toLowerCase();
    const choiceIndex = choices.findIndex(
      (choice) => normalizeChoiceToken(choice).toLowerCase() === normalizedChoiceToken
    );
    if (choiceIndex >= 0) {
      indices.push(choiceIndex);
    }
  }

  if (!indices.length) {
    const fullToken = normalizeChoiceToken(cleaned).toLowerCase();
    const index = choices.findIndex(
      (choice) => normalizeChoiceToken(choice).toLowerCase() === fullToken
    );
    if (index >= 0) {
      indices.push(index);
    }
  }

  return Array.from(new Set(indices)).filter((value) => value >= 0);
}

export function formatChoiceLabel(question: Question, index: number): string {
  const rawLabel = question.choiceLabels?.[index] ?? String(index + 1);
  if (question.type === "ox") {
    return rawLabel;
  }
  if (CIRCLED_LABELS.has(rawLabel)) {
    return rawLabel;
  }
  if (/^[A-Za-z0-9]+$/.test(rawLabel)) {
    return `${rawLabel}.`;
  }
  return rawLabel;
}

export function formatChoiceAnswer(question: Question, answer: number | number[] | null | undefined): string {
  if (answer === null || answer === undefined) {
    return "미답";
  }

  const choices = question.choices ?? [];
  const indices = Array.isArray(answer) ? answer : [answer];
  return indices
    .map((index) => {
      const label = formatChoiceLabel(question, index);
      const choiceText = choices[index];
      if (!choiceText || choiceText === label) {
        return label;
      }
      return `${label} ${choiceText}`;
    })
    .join(", ");
}

export function isOxAnswer(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return ["o", "x", "true", "false", "t", "f", "예", "아니오"].includes(normalized);
}

export function parseOxAnswer(value: string): number | null {
  const normalized = value.trim().toLowerCase();
  if (["o", "true", "t", "예"].includes(normalized)) {
    return 0;
  }
  if (["x", "false", "f", "아니오"].includes(normalized)) {
    return 1;
  }
  return null;
}

export function guessQuestionType(choices: string[], answerRaw: string): "single" | "multi" | "short" | "ox" {
  if (isOxAnswer(answerRaw)) {
    return "ox";
  }

  if (choices.length) {
    const hasMultiDelimiter = /[,/|\s]+/.test(answerRaw.trim()) && answerRaw.trim().length > 1;
    if (hasMultiDelimiter && extractIndicesFromText(answerRaw, choices).length > 1) {
      return "multi";
    }
    return "single";
  }

  return "short";
}
