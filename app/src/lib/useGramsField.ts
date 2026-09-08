import { useEffect, useState } from 'react';

/**
 * A grams field that behaves like a number people are editing, not appending.
 *
 * Two things went wrong without this. The field was pre-filled with a
 * suggestion and focused on open, so `selectTextOnFocus` never fired — the
 * first keystroke landed after the suggestion, and "100" plus "50" became
 * 1050. And nothing capped the length, so it was possible to type 1050250 and
 * watch the sheet offer to log 651155 kcal with the button still enabled.
 *
 * So: the suggestion arrives selected, and the value is bounded. The bound
 * here is a typo guard — the real rule is MAX_PORTION_G on the server, which
 * refuses regardless of what any client sends.
 */
export const MAX_GRAMS_INPUT = 3000;

export function useGramsField(suggested: number | null | undefined) {
  const [grams, setGrams] = useState('');
  // Undefined hands control back to the platform after the first interaction;
  // holding it would pin the cursor and make the field unusable.
  const [selection, setSelection] = useState<{ start: number; end: number } | undefined>();

  useEffect(() => {
    if (suggested == null) return;
    const initial = String(suggested);
    setGrams(initial);
    setSelection({ start: 0, end: initial.length });
  }, [suggested]);

  return {
    grams,
    amount: Number(grams) || 0,
    valid: Number(grams) > 0 && Number(grams) <= MAX_GRAMS_INPUT,
    props: {
      value: grams,
      selection,
      keyboardType: 'number-pad' as const,
      onSelectionChange: () => setSelection(undefined),
      onChangeText: (next: string) => {
        // Digits only, four at most, and never above the guard. Leading zeros
        // are dropped so 0250 does not become a number nobody typed.
        const digits = next.replace(/[^0-9]/g, '').slice(0, 4);
        if (digits === '') return setGrams('');
        setGrams(String(Math.min(Number(digits), MAX_GRAMS_INPUT)));
      },
    },
  };
}
