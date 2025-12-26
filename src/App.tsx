import { useEffect, useMemo, useState } from "react";
import type { ChangeEvent } from "react";
import type {
  AppStep,
  EditableExam,
  EditableQuestion,
  QuestionType,
  UserAnswer,
} from "./lib/types";
import { editableToExam, parseInput, toEditableExam } from "./lib/parser";
import { gradeExam, isAnswered } from "./lib/grading";
import { clearState, loadState, saveState } from "./lib/storage";
import { sampleJson, sampleText } from "./lib/samples";
import { formatChoiceLabel } from "./lib/utils";

const QUESTION_TYPE_OPTIONS: { value: QuestionType; label: string }[] = [
  { value: "single", label: "객관식(단일)" },
  { value: "multi", label: "객관식(복수)" },
  { value: "short", label: "주관식" },
  { value: "ox", label: "O/X" },
];

type InputTab = "file" | "text" | "manual";

type ResultFilter = "all" | "incorrect" | "flagged" | "unanswered";

export default function App() {
  const [step, setStep] = useState<AppStep>("input");
  const [inputTab, setInputTab] = useState<InputTab>("file");
  const [fileName, setFileName] = useState<string>("");
  const [fileContent, setFileContent] = useState<string>("");
  const [textContent, setTextContent] = useState<string>("");
  const [inputError, setInputError] = useState<string>("");
  const [parseIssues, setParseIssues] = useState<string[]>([]);
  const [editableExam, setEditableExam] = useState<EditableExam | null>(null);
  const [examData, setExamData] = useState<EditableExam | null>(null);
  const [answers, setAnswers] = useState<Record<string, UserAnswer>>({});
  const [flags, setFlags] = useState<Record<string, boolean>>({});
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [theme, setTheme] = useState<"light" | "dark">("light");
  const [filter, setFilter] = useState<ResultFilter>("all");
  const [showAnswersInEditor, setShowAnswersInEditor] = useState<boolean>(false);

  const createBlankQuestion = (index: number): EditableQuestion => ({
    id: `Q${index + 1}`,
    type: "short",
    prompt: "",
    choicesText: "",
    answerText: "",
    explanation: "",
  });

  const createEmptyExam = (): EditableExam => ({
    title: "무제 시험",
    questions: [createBlankQuestion(0)],
  });

  const ensureEditableExam = () => {
    setEditableExam((prev) => prev ?? createEmptyExam());
  };

  const updateQuestionAt = (index: number, updates: Partial<EditableQuestion>) => {
    setEditableExam((prev) => {
      if (!prev) {
        return prev;
      }
      const nextQuestions = [...prev.questions];
      nextQuestions[index] = { ...nextQuestions[index], ...updates };
      return { ...prev, questions: nextQuestions };
    });
  };

  const removeQuestionAt = (index: number) => {
    setEditableExam((prev) => {
      if (!prev) {
        return prev;
      }
      const nextQuestions = [...prev.questions];
      nextQuestions.splice(index, 1);
      return { ...prev, questions: nextQuestions };
    });
  };

  const addQuestion = () => {
    setEditableExam((prev) => {
      if (!prev) {
        return createEmptyExam();
      }
      return {
        ...prev,
        questions: [...prev.questions, createBlankQuestion(prev.questions.length)],
      };
    });
  };

  useEffect(() => {
    const stored = loadState();
    if (stored?.exam) {
      setExamData(toEditableExam(stored.exam));
      setAnswers(stored.answers ?? {});
      setFlags(stored.flags ?? {});
      setCurrentIndex(stored.currentIndex ?? 0);
      setStep(stored.step ?? "exam");
      setTheme(stored.theme ?? "light");
    }
  }, []);

  useEffect(() => {
    document.documentElement.dataset.theme = theme;
  }, [theme]);

  useEffect(() => {
    if (!examData || (step !== "exam" && step !== "result")) {
      return;
    }
    const { exam } = editableToExam(examData);
    saveState({
      step,
      exam,
      answers,
      flags,
      currentIndex,
      theme,
    });
  }, [examData, answers, flags, currentIndex, step, theme]);

  const exam = useMemo(() => {
    if (!examData) {
      return null;
    }
    return editableToExam(examData).exam;
  }, [examData]);

  const summary = useMemo(() => {
    if (!exam) {
      return null;
    }
    return gradeExam(exam, answers);
  }, [exam, answers]);

  const examQuestionCount = exam?.questions.length ?? 0;
  const answeredCount = exam
    ? exam.questions.filter((question) => isAnswered(question, answers[question.id] ?? null)).length
    : 0;

  const handleFileChange = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => {
      setFileContent(String(reader.result ?? ""));
    };
    reader.readAsText(file);
  };

  const handleParse = (content: string, filename?: string) => {
    setInputError("");
    setExamData(null);
    setAnswers({});
    setFlags({});
    setCurrentIndex(0);
    setShowAnswersInEditor(false);
    const result = parseInput(content, filename);
    if (!result.exam || !result.editable) {
      setInputError(result.issues.map((issue) => issue.message).join("\n"));
      return;
    }
    setEditableExam(result.editable);
    setParseIssues(result.issues.map((issue) => issue.message));
    setStep("preview");
  };

  const handleStartExam = () => {
    if (!editableExam) {
      return;
    }
    const { exam: normalizedExam, issues } = editableToExam(editableExam);
    setParseIssues(issues.map((issue) => issue.message));
    if (!normalizedExam.questions.length) {
      setInputError("문제 데이터를 확인하세요.");
      return;
    }
    setExamData(toEditableExam(normalizedExam));
    setAnswers({});
    setFlags({});
    setCurrentIndex(0);
    setInputError("");
    setStep("exam");
  };

  const handleReset = () => {
    clearState();
    setEditableExam(null);
    setExamData(null);
    setAnswers({});
    setFlags({});
    setCurrentIndex(0);
    setStep("input");
    setInputError("");
    setParseIssues([]);
    setShowAnswersInEditor(false);
  };

  const handleAnswerChange = (questionId: string, value: UserAnswer) => {
    setAnswers((prev) => ({ ...prev, [questionId]: value }));
  };

  const handleToggleFlag = (questionId: string) => {
    setFlags((prev) => ({ ...prev, [questionId]: !prev[questionId] }));
  };

  const handleExportWrongNotes = (format: "json" | "text") => {
    if (!exam || !summary) {
      return;
    }

    const wrongResults = summary.results.filter((result) => !result.correct);
    if (format === "json") {
      const payload = {
        title: exam.title,
        total: summary.total,
        incorrect: summary.incorrect,
        wrongNotes: wrongResults,
      };
      downloadFile("wrong-notes.json", JSON.stringify(payload, null, 2), "application/json");
      return;
    }

    const textPayload = wrongResults
      .map((result) => {
        return [
          `문항 ${result.id}`,
          result.prompt,
          `내 답: ${result.userAnswerLabel}`,
          `정답: ${result.correctAnswerLabel}`,
          result.explanation ? `해설: ${result.explanation}` : "",
          "-".repeat(24),
        ]
          .filter(Boolean)
          .join("\n");
      })
      .join("\n");

    downloadFile("wrong-notes.txt", textPayload || "오답이 없습니다.", "text/plain");
  };

  const editorMeta = editableExam ? (
    <>
      <div className="input-block">
        <label className="label">시험 제목</label>
        <input
          className="input"
          value={editableExam.title}
          onChange={(event) =>
            setEditableExam({
              ...editableExam,
              title: event.target.value,
            })
          }
        />
      </div>

      {inputError && <div className="alert error">{inputError}</div>}

      {parseIssues.length > 0 && (
        <div className="alert warn">
          {parseIssues.map((issue, index) => (
            <div key={`${issue}-${index}`}>{issue}</div>
          ))}
        </div>
      )}

      <div className="button-row">
        <button className="btn ghost" onClick={() => setShowAnswersInEditor((prev) => !prev)}>
          {showAnswersInEditor ? "정답/해설 숨기기" : "정답/해설 표시"}
        </button>
      </div>

      <div className="pill-row">
        <div className="pill">총 문항: {editableExam.questions.length}</div>
        <div className="pill">
          객관식: {editableExam.questions.filter((q) => q.type === "single" || q.type === "multi").length}
        </div>
        <div className="pill">주관식: {editableExam.questions.filter((q) => q.type === "short").length}</div>
        <div className="pill">O/X: {editableExam.questions.filter((q) => q.type === "ox").length}</div>
      </div>
    </>
  ) : null;

  const questionEditor = editableExam ? (
    <>
      <div className="stack">
        {editableExam.questions.map((question, index) => (
          <div key={`${question.id}-${index}`} className="card question-card">
            <div className="question-head">
              <h3>문항 {index + 1}</h3>
              <button className="btn outline" onClick={() => removeQuestionAt(index)}>
                문항 삭제
              </button>
            </div>

            <div className="grid two">
              <div>
                <label className="label">문항 ID</label>
                <input
                  className="input"
                  value={question.id}
                  onChange={(event) => updateQuestionAt(index, { id: event.target.value })}
                />
              </div>
              <div>
                <label className="label">문제 타입</label>
                <select
                  className="input"
                  value={question.type}
                  onChange={(event) => updateQuestionAt(index, { type: event.target.value as QuestionType })}
                >
                  {QUESTION_TYPE_OPTIONS.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </div>
            </div>

            <div className="input-block">
              <label className="label">문제 지문</label>
              <textarea
                className="textarea"
                rows={3}
                value={question.prompt}
                onChange={(event) => updateQuestionAt(index, { prompt: event.target.value })}
              />
            </div>

            <div className="input-block">
              <label className="label">보기 (줄바꿈으로 구분)</label>
              <textarea
                className="textarea"
                rows={3}
                value={question.choicesText}
                onChange={(event) => updateQuestionAt(index, { choicesText: event.target.value })}
              />
            </div>

            {showAnswersInEditor ? (
              <div className="grid two">
                <div>
                  <label className="label">정답</label>
                  <input
                    className="input"
                    value={question.answerText}
                    onChange={(event) => updateQuestionAt(index, { answerText: event.target.value })}
                    placeholder="예) 2, 3 또는 서울 | 서울특별시"
                  />
                </div>
                <div>
                  <label className="label">해설</label>
                  <input
                    className="input"
                    value={question.explanation}
                    onChange={(event) => updateQuestionAt(index, { explanation: event.target.value })}
                    placeholder="해설이 있으면 입력"
                  />
                </div>
              </div>
            ) : (
              <div className="muted">정답/해설은 숨김 상태입니다.</div>
            )}
          </div>
        ))}
      </div>

      <button className="btn outline" onClick={addQuestion}>
        문항 추가
      </button>
    </>
  ) : null;

  const currentQuestion = exam ? exam.questions[currentIndex] : null;

  return (
    <div className="app-shell">
      <header className="hero">
        <div className="hero-text">
          <span className="badge">Offline-ready</span>
          <h1>기출 문제 풀이 & 채점 스튜디오</h1>
          <p>파일 업로드 또는 텍스트 붙여넣기 후 자동 시험 UI 생성 → 풀이 → 채점 결과까지 한 번에.</p>
        </div>
        <div className="hero-actions">
          <button className="btn ghost" onClick={() => setTheme(theme === "light" ? "dark" : "light")}>
            {theme === "light" ? "다크모드" : "라이트모드"}
          </button>
          {exam && (
            <button className="btn outline" onClick={handleReset}>
              새 시험 가져오기
            </button>
          )}
        </div>
      </header>

      <main className="main">
        {step === "input" && (
          <section className="card stack">
            <div className="section-head">
              <div>
                <h2>입력 모드 선택</h2>
                <p>파일 업로드, 텍스트 붙여넣기, 직접 입력으로 문제를 가져오세요.</p>
              </div>
              <div className="tab-row">
                <button
                  className={`tab ${inputTab === "file" ? "active" : ""}`}
                  onClick={() => setInputTab("file")}
                >
                  파일 업로드
                </button>
                <button
                  className={`tab ${inputTab === "text" ? "active" : ""}`}
                  onClick={() => setInputTab("text")}
                >
                  텍스트 붙여넣기
                </button>
                <button
                  className={`tab ${inputTab === "manual" ? "active" : ""}`}
                  onClick={() => {
                    setInputTab("manual");
                    setInputError("");
                    setParseIssues([]);
                    setShowAnswersInEditor(true);
                    ensureEditableExam();
                  }}
                >
                  직접 입력
                </button>
              </div>
            </div>

            {inputTab === "file" && (
              <div className="input-block">
                <input className="file" type="file" accept=".json,.txt" onChange={handleFileChange} />
                <div className="muted">지원 확장자: .json, .txt</div>
                {fileName && <div className="pill">선택됨: {fileName}</div>}
              </div>
            )}

            {inputTab === "text" && (
              <div className="input-block">
                <textarea
                  className="textarea"
                  rows={10}
                  placeholder="문제 텍스트 또는 JSON을 붙여넣으세요."
                  value={textContent}
                  onChange={(event) => setTextContent(event.target.value)}
                />
                <div className="muted">정답/해설은 "정답:" / "해설:" 라인으로 입력하면 인식합니다.</div>
              </div>
            )}

            {inputTab === "manual" && editableExam && (
              <div className="stack">
                <div className="section-head">
                  <div>
                    <h3>직접 입력</h3>
                    <p>문항, 정답, 해설을 바로 입력하세요.</p>
                  </div>
                  <div className="button-row">
                    <button
                      className="btn ghost"
                      onClick={() => {
                        setEditableExam(createEmptyExam());
                        setInputError("");
                        setParseIssues([]);
                      }}
                    >
                      새로 입력
                    </button>
                    <button className="btn primary" onClick={handleStartExam}>
                      시험 시작
                    </button>
                  </div>
                </div>
                {editorMeta}
                {questionEditor}
              </div>
            )}

            {inputTab !== "manual" && inputError && <div className="alert error">{inputError}</div>}

            {inputTab !== "manual" && (
              <div className="button-row">
                <button
                  className="btn primary"
                  onClick={() =>
                    handleParse(
                      inputTab === "file" ? fileContent : textContent,
                      inputTab === "file" ? fileName : undefined
                    )
                  }
                >
                  가져오기
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    setInputTab("text");
                    setTextContent(sampleText);
                  }}
                >
                  샘플(텍스트) 불러오기
                </button>
                <button
                  className="btn ghost"
                  onClick={() => {
                    setInputTab("text");
                    setTextContent(sampleJson);
                  }}
                >
                  샘플(JSON) 불러오기
                </button>
              </div>
            )}
          </section>
        )}

        {step === "preview" && editableExam && (
          <section className="stack">
            <div className="card">
              <div className="section-head">
                <div>
                  <h2>파싱 미리보기</h2>
                  <p>문항 수와 정답/보기를 확인하고, 바로 수정하세요.</p>
                </div>
                <div className="button-row">
                  <button className="btn ghost" onClick={() => setStep("input")}>
                    뒤로
                  </button>
                  <button className="btn primary" onClick={handleStartExam}>
                    시험 시작
                  </button>
                </div>
              </div>
              {editorMeta}
            </div>

            {questionEditor}
          </section>
        )}

        {step === "exam" && exam && currentQuestion && (
          <section className="exam-layout">
            <aside className="card nav-panel">
              <div className="nav-head">
                <h2>{exam.title}</h2>
                <div className="muted">
                  진행률: {answeredCount}/{examQuestionCount}
                </div>
                <div className="progress">
                  <div
                    className="progress-bar"
                    style={{ width: `${examQuestionCount ? (answeredCount / examQuestionCount) * 100 : 0}%` }}
                  />
                </div>
              </div>

              <div className="nav-grid">
                {exam.questions.map((question, index) => {
                  const answered = isAnswered(question, answers[question.id] ?? null);
                  const flagged = flags[question.id];
                  return (
                    <button
                      key={question.id}
                      className={`nav-item ${answered ? "answered" : ""} ${flagged ? "flagged" : ""} ${index === currentIndex ? "active" : ""}`}
                      onClick={() => setCurrentIndex(index)}
                    >
                      {index + 1}
                    </button>
                  );
                })}
              </div>

              <div className="button-row">
                <button
                  className="btn outline"
                  onClick={() => {
                    setEditableExam(examData ?? toEditableExam(exam));
                    setStep("preview");
                  }}
                >
                  시험 편집
                </button>
                <button className="btn ghost" onClick={() => setAnswers({})}>
                  답안 초기화
                </button>
              </div>
              <div className="button-row">
                <button className="btn primary" onClick={() => setStep("result")}>
                  전체 채점하기
                </button>
              </div>
            </aside>

            <div className="card question-play">
              <div className="question-header">
                <div>
                  <div className="pill">문항 {currentIndex + 1}</div>
                  <h3>{currentQuestion.prompt}</h3>
                </div>
                <button
                  className={`btn flag ${flags[currentQuestion.id] ? "active" : ""}`}
                  onClick={() => handleToggleFlag(currentQuestion.id)}
                >
                  {flags[currentQuestion.id] ? "플래그됨" : "플래그"}
                </button>
              </div>

              {currentQuestion.type === "short" && (
                <div className="input-block">
                  <label className="label">단답 입력</label>
                  <input
                    className="input"
                    value={typeof answers[currentQuestion.id] === "string" ? (answers[currentQuestion.id] as string) : ""}
                    onChange={(event) => handleAnswerChange(currentQuestion.id, event.target.value)}
                    placeholder="정답을 입력하세요"
                  />
                </div>
              )}

              {(currentQuestion.type === "single" || currentQuestion.type === "ox") && (
                <div className="choice-grid">
                  {(currentQuestion.type === "ox" ? ["O", "X"] : currentQuestion.choices ?? []).map((choice, index) => (
                    <label key={`${currentQuestion.id}-choice-${index}`} className="choice">
                      <input
                        type="radio"
                        name={currentQuestion.id}
                        checked={answers[currentQuestion.id] === index}
                        onChange={() => handleAnswerChange(currentQuestion.id, index)}
                      />
                      <span>
                        {currentQuestion.type === "ox"
                          ? formatChoiceLabel(currentQuestion, index)
                          : `${formatChoiceLabel(currentQuestion, index)} ${choice}`}
                      </span>
                    </label>
                  ))}
                </div>
              )}

              {currentQuestion.type === "multi" && (
                <div className="choice-grid">
                  {(currentQuestion.choices ?? []).map((choice, index) => {
                    const currentAnswers = Array.isArray(answers[currentQuestion.id])
                      ? (answers[currentQuestion.id] as number[])
                      : [];
                    const checked = currentAnswers.includes(index);
                    return (
                      <label key={`${currentQuestion.id}-multi-${index}`} className="choice">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => {
                            const next = checked
                              ? currentAnswers.filter((value) => value !== index)
                              : [...currentAnswers, index];
                            handleAnswerChange(currentQuestion.id, next);
                          }}
                        />
                        <span>
                          {formatChoiceLabel(currentQuestion, index)} {choice}
                        </span>
                      </label>
                    );
                  })}
                </div>
              )}

              {currentQuestion.type !== "short" &&
                currentQuestion.type !== "multi" &&
                (!currentQuestion.choices || currentQuestion.choices.length === 0) && (
                  <div className="alert warn">보기가 없습니다. 편집 화면에서 확인하세요.</div>
                )}

              <div className="button-row space-between">
                <button
                  className="btn outline"
                  onClick={() => setCurrentIndex(Math.max(0, currentIndex - 1))}
                  disabled={currentIndex === 0}
                >
                  이전
                </button>
                <button
                  className="btn outline"
                  onClick={() => setCurrentIndex(Math.min(examQuestionCount - 1, currentIndex + 1))}
                  disabled={currentIndex === examQuestionCount - 1}
                >
                  다음
                </button>
              </div>
            </div>
          </section>
        )}

        {step === "result" && exam && summary && (
          <section className="stack">
            <div className="card">
              <div className="section-head">
                <div>
                  <h2>채점 결과</h2>
                  <p>{exam.title}</p>
                </div>
                <div className="button-row">
                  <button className="btn ghost" onClick={() => setStep("exam")}>
                    풀이로 돌아가기
                  </button>
                  <button
                    className="btn outline"
                    onClick={() => {
                      setAnswers({});
                      setFlags({});
                      setCurrentIndex(0);
                      setStep("exam");
                    }}
                  >
                    재응시
                  </button>
                </div>
              </div>

              <div className="summary-grid">
                <div className="summary-card">
                  <div className="summary-title">총점</div>
                  <div className="summary-value">{summary.accuracy}%</div>
                  <div className="summary-meta">정답률</div>
                </div>
                <div className="summary-card">
                  <div className="summary-title">정답</div>
                  <div className="summary-value ok">{summary.correct}</div>
                  <div className="summary-meta">/ {summary.total}</div>
                </div>
                <div className="summary-card">
                  <div className="summary-title">오답</div>
                  <div className="summary-value bad">{summary.incorrect}</div>
                  <div className="summary-meta">다시 보기 추천</div>
                </div>
                <div className="summary-card">
                  <div className="summary-title">미답</div>
                  <div className="summary-value">{summary.unanswered}</div>
                  <div className="summary-meta">답안을 확인하세요</div>
                </div>
              </div>

              <div className="filter-row">
                <div className="pill">필터</div>
                {([
                  { id: "all", label: "전체" },
                  { id: "incorrect", label: "오답만" },
                  { id: "flagged", label: "플래그" },
                  { id: "unanswered", label: "미답" },
                ] as { id: ResultFilter; label: string }[]).map((option) => (
                  <button
                    key={option.id}
                    className={`chip ${filter === option.id ? "active" : ""}`}
                    onClick={() => setFilter(option.id)}
                  >
                    {option.label}
                  </button>
                ))}

                <div className="button-row">
                  <button className="btn outline" onClick={() => handleExportWrongNotes("text")}>
                    오답노트(텍스트)
                  </button>
                  <button className="btn outline" onClick={() => handleExportWrongNotes("json")}>
                    오답노트(JSON)
                  </button>
                </div>
              </div>
            </div>

            <div className="stack">
              {summary.results
                .filter((result) => {
                  if (filter === "incorrect") {
                    return !result.correct && result.answered;
                  }
                  if (filter === "flagged") {
                    return flags[result.id];
                  }
                  if (filter === "unanswered") {
                    return !result.answered;
                  }
                  return true;
                })
                .map((result, index) => (
                  <div
                    key={`${result.id}-${index}`}
                    className={`card result-card ${result.correct ? "ok" : result.answered ? "bad" : "unanswered"}`}
                  >
                    <div className="result-head">
                      <div className="pill">문항 {result.id}</div>
                      <div className={`result-status ${result.correct ? "ok" : result.answered ? "bad" : "unanswered"}`}>
                        {result.correct ? "정답" : result.answered ? "오답" : "미답"}
                      </div>
                      {flags[result.id] && <div className="pill">플래그</div>}
                    </div>
                    <h3>{result.prompt}</h3>
                    <div className="result-row">
                      <span className="label">내 답</span>
                      <span>{result.userAnswerLabel}</span>
                    </div>
                    <div className="result-row">
                      <span className="label">정답</span>
                      <span>{result.correctAnswerLabel}</span>
                    </div>
                    {result.explanation && (
                      <details>
                        <summary>해설 보기</summary>
                        <p>{result.explanation}</p>
                      </details>
                    )}
                  </div>
                ))}
            </div>
          </section>
        )}
      </main>
    </div>
  );
}

function downloadFile(filename: string, content: string, type: string) {
  const blob = new Blob([content], { type });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = filename;
  link.click();
  URL.revokeObjectURL(url);
}

