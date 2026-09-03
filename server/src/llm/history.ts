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
