const GROQ_ENDPOINT = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = "llama-3.1-8b-instant";
const GROQ_MAX_TOKENS = 2000;
const GROQ_TEMPERATURE = 0;

interface GroqMessage {
  role: "system" | "user";
  content: string;
}

interface GroqResponse {
  choices?: Array<{ message?: { content?: string | null } }>;
  error?: { message?: string };
}

const SYSTEM_PROMPT = [
  "You convert raw exam questions into JSON for the exam-grader app.",
  "Return only valid JSON, no markdown.",
  "Use double quotes for keys/strings and no trailing commas.",
  "If the content includes double quotes, replace them with single quotes inside text.",
  "Do not wrap the response in code fences.",
  "Keep the JSON compact to fit token limits.",
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

function buildMessages(input: string): GroqMessage[] {
  return [
    { role: "system", content: SYSTEM_PROMPT },
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

export async function parseExamWithGroq(input: string): Promise<unknown> {
  const apiKey = import.meta.env.VITE_GROQ_API_KEY;
  if (!apiKey) {
    throw new Error("VITE_GROQ_API_KEY가 설정되지 않았습니다.");
  }

  const requestGroq = async (useJsonMode: boolean): Promise<string> => {
    const body = {
      model: GROQ_MODEL,
      temperature: GROQ_TEMPERATURE,
      max_tokens: GROQ_MAX_TOKENS,
      messages: buildMessages(input),
      ...(useJsonMode ? { response_format: { type: "json_object" } } : {}),
    };

    const response = await fetch(GROQ_ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    });

    let payload: GroqResponse | null = null;
    try {
      payload = (await response.json()) as GroqResponse;
    } catch {
      payload = null;
    }

    if (!response.ok) {
      const detail = payload?.error?.message || `Groq 요청 실패 (${response.status})`;
      throw new Error(detail);
    }

    const content = payload?.choices?.[0]?.message?.content;
    if (!content) {
      throw new Error("Groq 응답이 비어 있습니다.");
    }

    return content;
  };

  let content: string;
  try {
    content = await requestGroq(true);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.includes("response_format") || message.includes("json_object")) {
      content = await requestGroq(false);
    } else {
      throw error;
    }
  }

  return parseJsonFromText(content);
}
