/**
 * Gemini behind the provider interface. The only file that imports the SDK.
 */
import { GoogleGenAI } from '@google/genai';
import { env } from '../env';
import {
  type GenerateInput,
  type GenerateOutput,
  LlmError,
  type LlmProvider,
  type ToolCall,
  type Turn,
} from './provider';

type Part = Record<string, unknown>;

const client = new GoogleGenAI({ apiKey: env.geminiApiKey });

function partsFor(turn: Turn): { role: string; parts: Part[] } {
  switch (turn.role) {
    case 'user':
      return { role: 'user', parts: [{ text: turn.text }] };

    case 'model':
      // Echo the provider's own parts back verbatim when we have them: Gemini's
      // thinking models attach a thought signature and reject a follow-up that
      // drops it. Reconstructing the parts by hand loses it.
      if (Array.isArray(turn.opaque) && turn.opaque.length > 0) {
        return { role: 'model', parts: turn.opaque as Part[] };
      }
      return { role: 'model', parts: [{ text: turn.text || ' ' }] };

    case 'tool':
      return {
        role: 'user',
        parts: turn.results.map((result) => ({
          functionResponse: {
            id: result.id,
            name: result.name,
            // The SDK wants an object here, never a bare value.
            response:
              result.result && typeof result.result === 'object'
                ? (result.result as object)
                : { value: result.result },
          },
        })),
      };
  }
}

export const geminiProvider: LlmProvider = {
  async generate(input: GenerateInput): Promise<GenerateOutput> {
    const model = input.model === 'smart' ? env.geminiModelSmart : env.geminiModelFast;

    const config: Record<string, unknown> = {
      systemInstruction: input.systemInstruction,
      maxOutputTokens: input.maxOutputTokens ?? 4096,
    };

    if (input.temperature !== undefined) config.temperature = input.temperature;

    if (input.tools?.length) {
      config.tools = [
        {
          functionDeclarations: input.tools.map((tool) => ({
            name: tool.name,
            description: tool.description,
            parametersJsonSchema: tool.parameters,
          })),
        },
      ];
    }

    if (input.responseSchema) {
      config.responseMimeType = 'application/json';
      config.responseJsonSchema = input.responseSchema;
    }

    let response;
    try {
      response = await client.models.generateContent({
        model,
        contents: input.history.map(partsFor),
        config,
      });
    } catch (error) {
      const status = (error as { status?: number }).status ?? 0;
      throw new LlmError(
        `Gemini call failed: ${(error as Error).message}`,
        status === 0 || status === 429 || status >= 500,
        error,
      );
    }

    const parts = (response.candidates?.[0]?.content?.parts ?? []) as Part[];

    const toolCalls: ToolCall[] = parts
      .filter((part) => 'functionCall' in part)
      .map((part, index) => {
        const call = part.functionCall as { id?: string; name?: string; args?: unknown };
        return {
          id: call.id ?? `call_${index}`,
          name: call.name ?? '',
          args: (call.args as Record<string, unknown>) ?? {},
        };
      });

    const usage = response.usageMetadata;

    return {
      text: (response.text ?? '').trim(),
      toolCalls,
      opaque: parts,
      usage: {
        promptTokens: usage?.promptTokenCount ?? 0,
        outputTokens: usage?.candidatesTokenCount ?? 0,
        totalTokens: usage?.totalTokenCount ?? 0,
      },
    };
  },
};
