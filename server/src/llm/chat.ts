/**
 * The chat loop: model → tool calls → model, until it has something to say.
 *
 * Every turn is persisted to chat_messages so the trainer remembers the
 * conversation across app launches, and so a tool call made yesterday is still
 * visible context today.
 */
import type { Ctx } from '../db';
import { pool, query } from '../db';
import { assembleContext } from './context';
import { runTool } from './handlers';
import { trainerSystemInstruction } from './prompts/trainer';
import { geminiProvider } from './gemini';
import { LlmError, type ToolCall, type ToolResult, type Turn } from './provider';
import { TOOLS } from './tools';

/** How many model→tool→model rounds before we stop and answer with what we have. */
const MAX_TOOL_ROUNDS = 5;
const HISTORY_TURNS = 24;

export type ChatMessage = {
  id: number;
  role: 'user' | 'model' | 'tool';
  createdAt: string;
  text: string;
  toolCalls?: { name: string; ok: boolean }[];
};

type MessageRow = {
  id: number;
  role: string;
  content: Record<string, unknown>;
  created_at: Date;
};

async function persist(
  ctx: Ctx,
  role: Turn['role'],
  content: Record<string, unknown>,
): Promise<void> {
  await ctx.db.query('insert into chat_messages (user_id, role, content) values ($1, $2, $3)', [
    ctx.userId,
    role,
    JSON.stringify(content),
  ]);
}

async function loadHistory(ctx: Ctx): Promise<Turn[]> {
  const { rows } = await ctx.db.query<MessageRow>(
    `select id, role, content, created_at from chat_messages
     where user_id = $1
     order by id desc limit $2`,
    [ctx.userId, HISTORY_TURNS],
  );

  return rows
    .reverse()
    .map((row): Turn | null => {
      const content = row.content;
      if (row.role === 'user') return { role: 'user', text: String(content.text ?? '') };
      if (row.role === 'model') {
        return {
          role: 'model',
          text: String(content.text ?? ''),
          toolCalls: (content.toolCalls as ToolCall[]) ?? [],
          opaque: content.opaque,
        };
      }
      if (row.role === 'tool') {
        return { role: 'tool', results: (content.results as ToolResult[]) ?? [] };
      }
      return null;
    })
    .filter((turn): turn is Turn => turn !== null);
}

/** What the app shows in the chat tab. */
export async function history(ctx: Ctx, limit = 50): Promise<ChatMessage[]> {
  const { rows } = await ctx.db.query<MessageRow>(
    `select id, role, content, created_at from chat_messages
     where user_id = $1 and role in ('user', 'model')
     order by id desc limit $2`,
    [ctx.userId, limit],
  );

  return rows
    .reverse()
    .map((row) => ({
      id: row.id,
      role: row.role as ChatMessage['role'],
      createdAt: row.created_at.toISOString(),
      text: String(row.content.text ?? ''),
      toolCalls: (row.content.ranTools as { name: string; ok: boolean }[]) ?? undefined,
    }))
    // A model turn that only called tools has no text worth showing.
    .filter((message) => message.text.trim().length > 0);
}

export type ChatReply = {
  text: string;
  ranTools: { name: string; ok: boolean }[];
  usage: { promptTokens: number; outputTokens: number; totalTokens: number };
};

export async function sendMessage(ctx: Ctx, text: string): Promise<ChatReply> {
  const trimmed = text.trim();
  if (!trimmed) throw new LlmError('Empty message', false);

  const priorTurns = await loadHistory(ctx);
  await persist(ctx, 'user', { text: trimmed });

  const systemInstruction = trainerSystemInstruction(await assembleContext(ctx));
  const turns: Turn[] = [...priorTurns, { role: 'user', text: trimmed }];

  const ranTools: { name: string; ok: boolean }[] = [];
  const usage = { promptTokens: 0, outputTokens: 0, totalTokens: 0 };

  for (let round = 0; round <= MAX_TOOL_ROUNDS; round += 1) {
    const output = await geminiProvider.generate({
      purpose: 'chat',
      systemInstruction,
      history: turns,
      tools: TOOLS,
      model: 'fast',
    });

    usage.promptTokens += output.usage.promptTokens;
    usage.outputTokens += output.usage.outputTokens;
    usage.totalTokens += output.usage.totalTokens;

    const modelTurn: Turn = {
      role: 'model',
      text: output.text,
      toolCalls: output.toolCalls,
      opaque: output.opaque,
    };
    turns.push(modelTurn);

    if (output.toolCalls.length === 0) {
      await persist(ctx, 'model', { text: output.text, opaque: output.opaque, ranTools });
      return { text: output.text, ranTools, usage };
    }

    await persist(ctx, 'model', {
      text: output.text,
      toolCalls: output.toolCalls,
      opaque: output.opaque,
    });

    const results: ToolResult[] = [];
    for (const call of output.toolCalls) {
      const result = await runTool(ctx, call);
      ranTools.push({ name: call.name, ok: result.ok !== false });
      results.push({ id: call.id, name: call.name, result });
    }

    turns.push({ role: 'tool', results });
    await persist(ctx, 'tool', { results });
  }

  // Ran out of rounds. Say so rather than returning silence.
  const fallback =
    'I got stuck working through that — say it again and I will keep it simpler.';
  await persist(ctx, 'model', { text: fallback, ranTools });
  return { text: fallback, ranTools, usage };
}
