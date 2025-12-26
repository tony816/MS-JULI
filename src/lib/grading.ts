import type { ExamData, Question, UserAnswer } from "./types";
import { formatChoiceAnswer, normalizeShortAnswer } from "./utils";

export interface QuestionResult {
  id: string;
  prompt: string;
  type: Question["type"];
  correct: boolean;
  answered: boolean;
  userAnswerLabel: string;
  correctAnswerLabel: string;
  explanation?: string;
}

export interface GradeSummary {
  total: number;
  correct: number;
  incorrect: number;
  unanswered: number;
  accuracy: number;
  results: QuestionResult[];
}

export function gradeExam(
  exam: ExamData,
  answers: Record<string, UserAnswer>
): GradeSummary {
  const results = exam.questions.map((question) => {
    const userAnswer = answers[question.id] ?? null;
    const answered = isAnswered(question, userAnswer);
    const correct = answered ? isCorrectAnswer(question, userAnswer) : false;

    return {
      id: question.id,
      prompt: question.prompt,
      type: question.type,
      correct,
      answered,
      userAnswerLabel: formatUserAnswer(question, userAnswer),
      correctAnswerLabel: formatCorrectAnswer(question),
      explanation: question.explanation,
    };
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

export function isAnswered(question: Question, answer: UserAnswer): boolean {
  if (question.type === "short") {
    return typeof answer === "string" && normalizeShortAnswer(answer).length > 0;
  }
  if (question.type === "multi") {
    return Array.isArray(answer) && answer.length > 0;
  }
  return typeof answer === "number";
}

function isCorrectAnswer(question: Question, answer: UserAnswer): boolean {
  if (question.type === "short") {
    if (typeof answer !== "string") {
      return false;
    }
    const normalized = normalizeShortAnswer(answer);
    const accepted = (question.answerText ?? []).map((value) => normalizeShortAnswer(value));
    return accepted.includes(normalized);
  }

  if (question.type === "multi") {
    if (!Array.isArray(answer) || !Array.isArray(question.answer)) {
      return false;
    }
    const userSet = Array.from(new Set(answer)).sort((a, b) => a - b);
    const correctSet = Array.from(new Set(question.answer)).sort((a, b) => a - b);
    return userSet.length === correctSet.length && userSet.every((value, idx) => value === correctSet[idx]);
  }

  if (typeof answer !== "number" || typeof question.answer !== "number") {
    return false;
  }

  return answer === question.answer;
}

function formatUserAnswer(question: Question, answer: UserAnswer): string {
  if (!isAnswered(question, answer)) {
    return "미답";
  }

  if (question.type === "short") {
    return typeof answer === "string" ? answer.trim() : "";
  }

  if (question.type === "multi") {
    return formatChoiceAnswer(question, Array.isArray(answer) ? answer : []);
  }

  return formatChoiceAnswer(question, typeof answer === "number" ? answer : null);
}

function formatCorrectAnswer(question: Question): string {
  if (question.type === "short") {
    const text = question.answerText ?? [];
    return text.length ? text.join(" / ") : "(정답 없음)";
  }

  if (question.type === "multi") {
    return formatChoiceAnswer(question, Array.isArray(question.answer) ? question.answer : []);
  }

  return formatChoiceAnswer(question, typeof question.answer === "number" ? question.answer : null);
}

