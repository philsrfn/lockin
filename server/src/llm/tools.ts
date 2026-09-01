/**
 * Tool declarations, per §6. This is the heart of the app: the trainer acts
 * through validated function calls, never through prose.
 *
 * Every one of these maps to a service that the REST routes already use, so
 * there is exactly one code path to each table (§11).
 *
 * Not yet declared, deliberately:
 *   generate_meal_plan — needs fridge inventory (phase 4)
 *   regenerate_week    — needs a stored week plan; today's session is chosen
 *                        by planToday() instead
 */
import type { ToolDeclaration } from './provider';

const str = (description: string) => ({ type: 'string', description });
const num = (description: string) => ({ type: 'number', description });
const int = (description: string) => ({ type: 'integer', description });

export const TOOLS: ToolDeclaration[] = [
  {
    name: 'get_today',
    description:
      "Today's plan, the active city, macros consumed and remaining, and the " +
      'current weight trend. Call this before giving any advice that depends ' +
      'on what he has already done today.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_history',
    description:
      'Recent training sessions with their top sets, bodyweight entries, and ' +
      'logged meals. Use it before judging whether he is progressing or stalling.',
    parameters: {
      type: 'object',
      properties: { days: int('How many days back to read. Default 14, max 90.') },
    },
  },
  {
    name: 'set_context',
    description:
      'Switch the active city. Home, Münster, Mannheim or Leipzig. Do this as ' +
      'soon as he mentions he is somewhere else — the food rules and the gym ' +
      'depend on it.',
    parameters: {
      type: 'object',
      properties: { name: str('Home, Münster, Mannheim or Leipzig') },
      required: ['name'],
    },
  },
  {
    name: 'log_weight',
    description: 'Record a morning bodyweight in kilograms.',
    parameters: {
      type: 'object',
      properties: {
        weightKg: num('Bodyweight in kg'),
        measuredOn: str('YYYY-MM-DD. Omit for today.'),
      },
      required: ['weightKg'],
    },
  },
  {
    name: 'log_set',
    description:
      'Record one working set. Needs an open session — call log_session first ' +
      'if there is none, or use get_today to find the one in progress.',
    parameters: {
      type: 'object',
      properties: {
        exerciseName: str('Exercise name, e.g. "Back Squat"'),
        weightKg: num('Load in kg'),
        reps: int('Reps completed'),
        rir: int('Reps left in reserve. 0 means failure. Omit if he did not say.'),
      },
      required: ['exerciseName', 'weightKg', 'reps'],
    },
  },
  {
    name: 'log_session',
    description:
      'Start a session, or close out the one in progress with an RPE, a note ' +
      'and whether anything hurt. Closing a session is what makes it count ' +
      'towards the week.',
    parameters: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['start', 'finish'], description: 'start or finish' },
        template: { type: 'string', enum: ['A', 'B', 'C'], description: 'Only when starting.' },
        rpe: int('1-10, how hard the whole session was. Only when finishing.'),
        notes: str('Anything worth remembering. Only when finishing.'),
        jointPain: {
          type: 'boolean',
          description: 'Did anything hurt in a joint? Only when finishing. Be accurate — this gates load.',
        },
      },
      required: ['action'],
    },
  },
  {
    name: 'log_meal',
    description: 'Record something he ate, with your best macro estimate.',
    parameters: {
      type: 'object',
      properties: {
        slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
        description: str('What he ate, in his words'),
        kcal: int('Estimated calories'),
        proteinG: int('Estimated protein in grams'),
        source: {
          type: 'string',
          enum: ['moms_food', 'own', 'other'],
          description: "moms_food when it came off his mother's stove",
        },
      },
      required: ['slot', 'description'],
    },
  },
  {
    name: 'swap_exercise',
    description:
      'Replace one exercise in today\'s session with a substitute in the same ' +
      'movement pattern — for a busy machine, or a gym that lacks it. Returns ' +
      'the substitute with the load his own history says to use.',
    parameters: {
      type: 'object',
      properties: {
        from: str('The exercise to replace'),
        to: str('The substitute. Must share the movement pattern.'),
      },
      required: ['from', 'to'],
    },
  },
  {
    name: 'adjust_calorie_target',
    description:
      'Change the daily calorie or protein target, or the goal weight. Floors ' +
      'are enforced below you: a request under them is refused and you must ' +
      'tell him it was refused and why.',
    parameters: {
      type: 'object',
      properties: {
        calorieTarget: int('New daily calorie target'),
        proteinTargetG: int('New daily protein target in grams'),
        goalWeightKg: num('New goal weight in kg'),
        reason: str('Why you are changing it. Required — he should always know.'),
      },
      required: ['reason'],
    },
  },
  {
    name: 'add_rule',
    description:
      'Add a rule he has just stated. hard = always, soft = a preference, ' +
      'never = an absolute prohibition. Only do this when he has actually asked ' +
      'for a standing rule, not for a one-off.',
    parameters: {
      type: 'object',
      properties: {
        tier: { type: 'string', enum: ['hard', 'soft', 'never'] },
        text: str('The rule, in his words'),
        scope: str('A city name to scope it to, or omit for everywhere'),
      },
      required: ['tier', 'text'],
    },
  },
  {
    name: 'deactivate_rule',
    description: 'Turn off a rule. Use get_today or ask him to identify which.',
    parameters: {
      type: 'object',
      properties: { ruleId: int('The rule id') },
      required: ['ruleId'],
    },
  },
];

export const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));
