export type QuestionType = "single" | "multi" | "short" | "ox";
export type AppStep = "input" | "preview" | "exam" | "result";

export interface Question {
  id: string;
  type: QuestionType;
  prompt: string;
  choices?: string[];
  choiceLabels?: string[];
  answer?: number | number[];
  answerText?: string[];
  explanation?: string;
}

export interface ExamData {
  title: string;
  questions: Question[];
}

export type UserAnswer = number | number[] | string | null;

export interface EditableQuestion {
  id: string;
  type: QuestionType;
  prompt: string;
  choicesText: string;
  answerText: string;
  explanation: string;
}

export interface EditableExam {
  title: string;
  questions: EditableQuestion[];
}

export type IssueLevel = "error" | "warn";

export interface ParseIssue {
  level: IssueLevel;
  message: string;
  questionId?: string;
}

