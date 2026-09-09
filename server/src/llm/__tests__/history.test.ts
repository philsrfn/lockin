import { describe, expect, it } from 'vitest';
import type { Turn } from '../provider';
import { compactOldToolResults, usableHistory } from '../history';

const user = (text: string): Turn => ({ role: 'user', text });
const says = (text: string): Turn => ({ role: 'model', text, toolCalls: [] });
const calls = (name: string): Turn => ({
  role: 'model',
  text: '',
  toolCalls: [{ id: '1', name, args: {} }],
});
const results = (name: string): Turn => ({
  role: 'tool',
  results: [{ id: '1', name, result: { ok: true } }],
});

describe('usableHistory', () => {
  it('leaves a well-formed conversation alone', () => {
    const turns = [user('hi'), says('hello'), user('log 90kg'), says('done')];

    expect(usableHistory(turns)).toEqual(turns);
  });

  it('leaves a complete tool exchange alone', () => {
    const turns = [user('log it'), calls('log_set'), results('log_set'), says('logged')];

    expect(usableHistory(turns)).toEqual(turns);
  });

  it('drops a leading tool call, which is the bug that broke chat', () => {
    // The 24-row window landed here: a request to call a tool with nothing
    // before it that could have prompted it. Gemini refuses the whole call and
    // the athlete's message is never answered.
    const turns = [calls('log_meal'), results('log_meal'), says('logged'), user('thanks')];

    // Everything before the first user turn goes, including the model's answer.
    expect(usableHistory(turns)).toEqual([user('thanks')]);
  });

  it('drops a leading tool response too', () => {
    const turns = [results('log_meal'), says('logged'), user('next'), says('ok')];

    expect(usableHistory(turns)).toEqual([user('next'), says('ok')]);
  });

  it('drops a leading plain model turn', () => {
    const turns = [says('good morning'), user('morning'), says('how did it feel')];

    expect(usableHistory(turns)).toEqual([user('morning'), says('how did it feel')]);
  });

  it('drops a call whose results never arrived', () => {
    // The next turn appended is the athlete's new message, and a function call
    // followed by a user turn is the same violation from the other end.
    const turns = [user('log it'), says('sure'), user('now'), calls('log_set')];

    expect(usableHistory(turns)).toEqual([user('log it'), says('sure'), user('now')]);
  });

  it('drops an exchange the model never got to answer', () => {
    const turns = [user('log it'), calls('log_set'), results('log_set')];

    expect(usableHistory(turns)).toEqual([user('log it')]);
  });

  it('unwinds several unfinished rounds at once', () => {
    const turns = [
      user('do it'),
      says('working'),
      calls('a'),
      results('a'),
      calls('b'),
      results('b'),
    ];

    expect(usableHistory(turns)).toEqual([user('do it'), says('working')]);
  });

  it('gives up rather than send something invalid', () => {
    // Trimming both ends can leave nothing. Losing the model's context is a
    // worse answer; losing the athlete's message is not an answer at all.
    expect(usableHistory([calls('log_set')])).toEqual([]);
    expect(usableHistory([results('log_set'), calls('log_set')])).toEqual([]);
    expect(usableHistory([])).toEqual([]);
  });

  it('never reorders, only drops', () => {
    const turns = [
      calls('a'),
      results('a'),
      says('first'),
      user('second'),
      calls('b'),
      results('b'),
      says('third'),
    ];

    const kept = usableHistory(turns);

    // Every turn kept appears in the original, in the same order.
    expect(turns.filter((turn) => kept.includes(turn))).toEqual(kept);
    expect(kept[0]).toEqual(user('second'));
  });

  it('always starts on a user turn and never ends mid-exchange', () => {
    // Every window a sliding limit can produce, checked against the two rules.
    const conversation = [
      user('a'),
      calls('t1'),
      results('t1'),
      says('b'),
      user('c'),
      says('d'),
      user('e'),
      calls('t2'),
      results('t2'),
      says('f'),
    ];

    for (let from = 0; from < conversation.length; from += 1) {
      for (let to = from; to <= conversation.length; to += 1) {
        const kept = usableHistory(conversation.slice(from, to));
        if (kept.length === 0) continue;

        expect(kept[0]!.role).toBe('user');
        const last = kept[kept.length - 1]!;
        expect(last.role === 'tool').toBe(false);
        expect(last.role === 'model' && last.toolCalls.length > 0).toBe(false);
      }
    }
  });
});

describe('what an old tool result is worth carrying', () => {
  const user = (text: string): Turn => ({ role: 'user', text });
  const asks = (name: string): Turn => ({
    role: 'model',
    text: '',
    toolCalls: [{ id: 'c1', name, args: {} }],
  });
  const answers = (name: string, result: unknown): Turn => ({
    role: 'tool',
    results: [{ id: 'c1', name, result }],
  });
  const says = (text: string): Turn => ({ role: 'model', text, toolCalls: [] });

  const conversation = (): Turn[] => [
    user('wie viel protein noch'),
    asks('get_today'),
    answers('get_today', { proteinRemaining: 120, kcalRemaining: 1400 }),
    says('Noch 120 g.'),
    user('und jetzt'),
    asks('get_today'),
    answers('get_today', { proteinRemaining: 40, kcalRemaining: 300 }),
    says('Noch 40 g.'),
  ];

  it('keeps the newest exchange exactly as it was', () => {
    const kept = compactOldToolResults(conversation()).at(-2);

    expect(kept).toMatchObject({
      results: [{ name: 'get_today', result: { proteinRemaining: 40 } }],
    });
  });

  it('replaces the older snapshot, which is the one that lies', () => {
    // Both say "protein remaining". Only one of them is true, and nothing in
    // the transcript marks which — so the older payload is a number the model
    // can read out as current.
    const old = compactOldToolResults(conversation())[2];

    expect(old).toMatchObject({ results: [{ name: 'get_today' }] });
    expect(JSON.stringify(old)).not.toContain('120');
  });

  it('still says the tool ran, and how to get the answer back', () => {
    const old = compactOldToolResults(conversation())[2] as {
      results: { result: { ok: boolean; stale: string } }[];
    };

    expect(old.results[0]!.result.ok).toBe(true);
    expect(old.results[0]!.result.stale).toMatch(/again/i);
  });

  it('leaves everything that is not a tool result alone', () => {
    const before = conversation();
    const after = compactOldToolResults(before);

    expect(after.filter((turn) => turn.role !== 'tool')).toEqual(
      before.filter((turn) => turn.role !== 'tool'),
    );
  });

  it('changes nothing in a conversation shorter than the live window', () => {
    const short: Turn[] = [user('hi'), asks('get_today'), answers('get_today', { a: 1 })];

    expect(compactOldToolResults(short)).toEqual(short);
  });
});
