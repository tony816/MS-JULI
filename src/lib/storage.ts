import type { AppStep, ExamData, UserAnswer } from "./types";

export interface StoredState {
  step: AppStep;
  exam: ExamData | null;
  answers: Record<string, UserAnswer>;
  flags: Record<string, boolean>;
  currentIndex: number;
  theme: "light" | "dark";
}

const STORAGE_KEY = "exam-grader-state-v1";

export function loadState(): StoredState | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) {
      return null;
    }
    return JSON.parse(raw) as StoredState;
  } catch {
    return null;
  }
}

export function saveState(state: StoredState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // Ignore storage failures.
  }
}

export function clearState(): void {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // Ignore storage failures.
  }
}

