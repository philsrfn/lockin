/**
 * Every model call goes through here.
 *
 * The provider interface is deliberately ignorant of who is asking — §1 wants
 * swapping providers to be a one-directory change, and a provider that knew
 * about athletes would not be swappable. So the meter sits above it: check the
 * budget, make the call, record what it cost.
 */
import type { Ctx } from '../db';
import { assertWithinBudget, recordUsage } from '../services/usage';
import { geminiProvider } from './gemini';
import type { GenerateInput, GenerateOutput } from './provider';

export async function generateFor(ctx: Ctx, input: GenerateInput): Promise<GenerateOutput> {
  // Before, not after. After is a bill.
  await assertWithinBudget(ctx);

  const output = await geminiProvider.generate(input);

  // Best effort: a failure to write the meter must not lose the answer the
  // athlete is waiting for. It is logged by the provider either way.
  try {
    await recordUsage(ctx, input.purpose ?? 'unknown', output.usage);
  } catch {
    // Deliberately swallowed — see above.
  }

  return output;
}
