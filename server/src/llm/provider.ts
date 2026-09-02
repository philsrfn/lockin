/**
 * The provider interface. §1: swapping providers later must be a one-directory
 * change, so nothing outside server/src/llm/ imports @google/genai or knows
 * that Gemini exists.
 */

export type ToolCall = {
  id: string;
  name: string;
  args: Record<string, unknown>;
};

export type ToolResult = {
  id: string;
  name: string;
  result: unknown;
};

export type Turn =
  | { role: 'user'; text: string }
  | {
      role: 'model';
      text: string;
      toolCalls: ToolCall[];
      /**
       * Provider state that must survive the round trip and must not be
       * interpreted here. Gemini's thinking models attach a thought signature
       * to each part and reject a follow-up turn that drops it.
       */
      opaque?: unknown;
    }
  | { role: 'tool'; results: ToolResult[] };

export type ToolDeclaration = {
  name: string;
  description: string;
  /** Plain JSON Schema. */
  parameters: Record<string, unknown>;
};

export type GenerateInput = {
  systemInstruction: string;
  history: Turn[];
  tools?: ToolDeclaration[];
  /** 'fast' for chat and logging, 'smart' for the weekly review. */
  model?: 'fast' | 'smart';
  /** Structured output. Do not combine with tools. */
  responseSchema?: Record<string, unknown>;
  maxOutputTokens?: number;
  temperature?: number;
};

export type Usage = {
  promptTokens: number;
  outputTokens: number;
  totalTokens: number;
};

export type GenerateOutput = {
  text: string;
  toolCalls: ToolCall[];
  opaque?: unknown;
  usage: Usage;
  /** The model string that actually answered. A fallback must never be silent. */
  model: string;
};

export interface LlmProvider {
  generate(input: GenerateInput): Promise<GenerateOutput>;
}

/** Thrown for anything the caller might reasonably want to handle. */
export class LlmError extends Error {
  constructor(
    message: string,
    readonly retryable: boolean,
    readonly source?: unknown,
  ) {
    super(message);
    this.name = 'LlmError';
  }
}
