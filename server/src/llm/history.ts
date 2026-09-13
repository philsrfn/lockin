/**
 * Trimming a conversation to something a provider will accept.
 *
 * A tool exchange is three turns: the model asking, the results coming back,
 * the model answering. Chat history is stored one row per turn and replayed as
 * a sliding window over the most recent rows — and that window boundary lands
 * wherever it lands. When it landed inside an exchange, Gemini refused the
 * whole call:
 *
 *   Please ensure that function call turn comes immediately after a user turn
 *   or after a function response turn.
 *
 * Which is fair: a request to call a tool, with nothing before it that could
 * have prompted it, is not a conversation. The athlete saw the raw error and
 * their message was never answered.
 *
 * So the window is repaired rather than trusted. Pure, and tested, because
 * this is the kind of rule that is easy to get subtly wrong and impossible to
 * notice until somebody's message disappears.
 */
import type { Turn } from './provider';

/**
 * How many turns at the end of the window keep their tool results in full.
 *
 * Four is one complete exchange plus the turn that prompted it — enough for
 * the model to finish what it is doing and refer to what a tool just told it.
 */
export const LIVE_TURNS = 4;

/**
 * What an old tool result is replaced by.
 *
 * Not deleted: the model should still be able to see that it looked something
 * up, or that a write went through. Only the payload goes, and the note says
 * how to get it back — which is the point, because the payload was the
 * problem rather than the size.
 */
const STALE = {
  ok: true,
  stale: 'Ran earlier in this conversation. Call the tool again for current numbers.',
} as const;

/**
 * Old tool payloads, replaced by the fact that they ran.
 *
 * A tool result is a snapshot. `get_today` returns remaining macros, today's
 * plan, the weight trend; `get_history` returns a fortnight. Replayed as
 * conversation, yesterday's snapshot sits in the transcript looking exactly
 * like today's, and nothing in it says which is which — so the model can read
 * out a protein number that was true when it was fetched and is not now. The
 * fresh numbers are already in the system instruction, assembled per request;
 * the copy in the transcript is only ever the older one.
 *
 * It is also the bulk of the prompt. Tool turns are by far the largest thing
 * in a stored conversation, and they are the part with the least to say.
 */
export function compactOldToolResults(turns: Turn[], live = LIVE_TURNS): Turn[] {
  const boundary = turns.length - live;

  return turns.map((turn, index) => {
    if (turn.role !== 'tool' || index >= boundary) return turn;
    return {
      role: 'tool',
      results: turn.results.map((result) => ({ ...result, result: STALE })),
    };
  });
}

const hasToolCalls = (turn: Turn): boolean => turn.role === 'model' && turn.toolCalls.length > 0;

/**
 * The longest suffix of `turns` that a provider will accept: it begins on a
 * user turn and does not stop half way through a tool exchange.
 *
 * Turns are dropped rather than reordered. A window that cannot be repaired
 * comes back empty, which costs the model its context and never costs the
 * athlete their message.
 */
export function usableHistory(turns: Turn[]): Turn[] {
  // Must open on a user turn. A model turn first is either a bare answer with
  // nothing to answer, or — the case that broke — a tool call with no prompt.
  let start = 0;
  while (start < turns.length && turns[start]!.role !== 'user') start += 1;

  let usable = turns.slice(start);

  /*
   * Must not end mid-exchange. Two ways it can:
   *
   *   ... model(call)              the results never arrived
   *   ... model(call), tool        the model never got to answer
   *
   * Either way the next turn appended is the athlete's new message, and a
   * function call followed by a user turn is the same violation from the other
   * end. An unfinished exchange is not context worth keeping.
   */
  while (usable.length > 0) {
    const last = usable[usable.length - 1]!;
    if (last.role === 'tool' || hasToolCalls(last)) {
      usable = usable.slice(0, -1);
      continue;
    }
    break;
  }

  // Dropping the tail can strand a leading model turn; settle it.
  return usable[0]?.role === 'user' ? usable : [];
}
