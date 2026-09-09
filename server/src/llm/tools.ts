/**
 * Tool declarations, per §6. This is the heart of the app: the trainer acts
 * through validated function calls, never through prose.
 *
 * Every one of these maps to a service that the REST routes already use, so
 * there is exactly one code path to each table (§11).
 *
 * The trainer may change anything that is a preference or a plan. What it may
 * not change is what those are measured against: the §7 floors refuse it and
 * it has to say so, and the numbers progression runs on — load increments,
 * rest, the rep maths — stay derived in code per §1. A tool that let the model
 * set an increment would be handing it the one job §1 keeps away from it.
 *
 * Not declared, deliberately:
 *   regenerate_week — needs a stored week plan; today's session is chosen by
 *                     planToday() instead
 *   anything destructive at the account level — deleting an account or a
 *                     history is not a thing to do because a sentence sounded
 *                     like it asked for it
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
      'on what they have already done today.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'get_history',
    description:
      'Recent training sessions with their top sets, bodyweight entries, and ' +
      'logged meals. Use it before judging whether they are progressing or stalling.',
    parameters: {
      type: 'object',
      properties: { days: int('How many days back to read. Default 14, max 90.') },
    },
  },
  {
    name: 'set_context',
    description:
      // The places are the athlete's own and differ per account, so this
      // cannot name them. They are listed in the CURRENT CONTEXT block of the
      // system instruction; match what the athlete says against that.
      'Switch the active place. Use one of the names listed in the context ' +
      'block. Do this as soon as they mention they are somewhere else — the ' +
      'food rules and the equipment depend on it.',
    parameters: {
      type: 'object',
      properties: { name: str('The place name, exactly as the context block spells it') },
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
        rir: int('Reps left in reserve. 0 means failure. Omit if they did not say.'),
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
    description: 'Record something they ate, with your best macro estimate.',
    parameters: {
      type: 'object',
      properties: {
        slot: { type: 'string', enum: ['breakfast', 'lunch', 'dinner', 'snack'] },
        description: str('What they ate, in their words'),
        kcal: int('Estimated calories'),
        proteinG: int('Estimated protein in grams'),
        source: {
          type: 'string',
          enum: ['moms_food', 'own', 'other'],
          description: "moms_food when somebody else cooked it — a parent, a canteen",
        },
      },
      required: ['slot', 'description'],
    },
  },
  {
    name: 'log_cardio',
    description:
      'Record cardio: a zone-2 treadmill session, intervals, football, a run, ' +
      'a walk. Minutes is the only number that matters — distance and heart ' +
      'rate go in when they happen to have them.',
    parameters: {
      type: 'object',
      properties: {
        kind: {
          type: 'string',
          enum: ['zone2', 'intervals', 'sport', 'walk', 'other'],
          description:
            'zone2 = steady and conversational, intervals = hard, sport = football ' +
            'or similar, walk = does not count towards the weekly target',
        },
        minutes: int('How long, in minutes'),
        description: str('What it was, in their words'),
        distanceKm: int('Kilometres, if they said'),
        avgHr: int('Average heart rate, if they said'),
        rpe: int('How hard it felt, 1-10, if they said'),
      },
      required: ['kind', 'minutes'],
    },
  },
  {
    name: 'swap_exercise',
    description:
      'Replace one exercise in today\'s session with a substitute in the same ' +
      'movement pattern — for a busy machine, or a gym that lacks it. Returns ' +
      'the substitute with the load their own history says to use.',
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
      'tell them it was refused and why.',
    parameters: {
      type: 'object',
      properties: {
        calorieTarget: int('New daily calorie target'),
        proteinTargetG: int('New daily protein target in grams'),
        goalWeightKg: num('New goal weight in kg'),
        reason: str('Why you are changing it. Required — they should always know.'),
      },
      required: ['reason'],
    },
  },
  {
    name: 'add_rule',
    description:
      'Add a rule they have just stated. hard = always, soft = a preference, ' +
      'never = an absolute prohibition. Only do this when they have actually asked ' +
      'for a standing rule, not for a one-off.',
    parameters: {
      type: 'object',
      properties: {
        tier: { type: 'string', enum: ['hard', 'soft', 'never'] },
        text: str('The rule, in their words'),
        scope: str('A city name to scope it to, or omit for everywhere'),
      },
      required: ['tier', 'text'],
    },
  },
  {
    name: 'undo_entry',
    description:
      'Remove something logged by mistake — a meal entered twice, a set typed ' +
      'into the wrong exercise. Ids come from get_today: meals are in ' +
      'macros.meals, sets are in openSession.sets. Only ever remove what they ' +
      'asked you to remove; a mistake in the log is theirs to identify.',
    parameters: {
      type: 'object',
      properties: {
        kind: { type: 'string', enum: ['meal', 'set'], description: 'What to remove' },
        id: int('The id of that meal or set'),
      },
      required: ['kind', 'id'],
    },
  },
  {
    name: 'add_place',
    description:
      'Add a place they train, when they mention one that does not exist yet — ' +
      'a new city, a hotel gym, a friend\'s garage. set_context only switches ' +
      'between places that already exist. Say what the place has if they told ' +
      'you: the substitute list is filtered by it.',
    parameters: {
      type: 'object',
      properties: {
        name: str('What they call it, e.g. Berlin'),
        equipment: {
          type: 'array',
          description: "What is there: barbell, dumbbell, machine, cable, rack, bench, pullup_bar.",
          items: { type: 'string' },
        },
      },
      required: ['name'],
    },
  },
  {
    name: 'set_training_days',
    description:
      'How many days a week they can train. Changes what the weekly targets ' +
      'expect of them, so use it when their life changes rather than letting ' +
      'them fail a target that no longer fits.',
    parameters: {
      type: 'object',
      properties: { days: int('Training days per week, 1-7') },
      required: ['days'],
    },
  },
  {
    name: 'get_program',
    description:
      'The programme they are on: every day, and the movements on each. Read ' +
      'this before changing a programme — editing replaces the whole thing, ' +
      'so you have to know what is in it first.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'set_program',
    description:
      'Switch to a different programme, by name. Their own programmes and the ' +
      'built-in ones are both valid. Sessions already logged keep the day they ' +
      'were logged against.',
    parameters: {
      type: 'object',
      properties: { name: str('The programme name, as get_program lists them') },
      required: ['name'],
    },
  },
  {
    name: 'edit_program',
    description:
      'Create a programme, or replace the days and movements of one they ' +
      'already own. This is how "I train pull with my friends on Tuesdays" or ' +
      '"my gym has no hack squat" becomes their actual plan.\n' +
      'Pass every day you want the programme to end up with — this replaces, ' +
      'it does not merge. Keep the `code` of a day that already exists so the ' +
      'sessions logged against it stay attached to it; leave it out for a new ' +
      'day. Built-in programmes cannot be edited: to change one, create a new ' +
      'programme from it by passing `basedOn`.\n' +
      'You do not set load increments or rest times. Those follow the movement ' +
      'and are computed below you.',
    parameters: {
      type: 'object',
      properties: {
        name: str('What the programme is called'),
        basedOn: str('Copy the days of this programme first. Omit to edit theirs or start empty.'),
        days: {
          type: 'array',
          description: 'Every day of the programme, in the order it rotates.',
          items: {
            type: 'object',
            properties: {
              code: str('Only for a day that already exists. Omit for a new one.'),
              name: str('What the day is called, e.g. Pull'),
              exercises: {
                type: 'array',
                items: {
                  type: 'object',
                  properties: {
                    name: str('Exercise name, exactly as the library spells it'),
                    sets: int('Working sets, 1-10'),
                    repMin: int('Bottom of the rep range'),
                    repMax: int('Top of the rep range'),
                  },
                  required: ['name', 'sets', 'repMin', 'repMax'],
                },
              },
            },
            required: ['name', 'exercises'],
          },
        },
      },
      required: ['name', 'days'],
    },
  },
  {
    name: 'generate_meal_plan',
    description:
      // No parameters on purpose. §9 exists because a mis-detected ingredient
      // becomes a meal nobody can cook; letting the model pass an ingredient
      // list would reintroduce exactly that, one step further back.
      'Plan the rest of today\'s food from the fridge list the athlete last ' +
      'confirmed, against the macros they have LEFT. You cannot supply the ' +
      'ingredients — it reads the list they confirmed on the Fridge screen. ' +
      'If it refuses because there is no list or the list is old, say so and ' +
      'ask them to photograph the fridge again. If the result says mentionAge, ' +
      'tell them how old the list is before you give them the plan.',
    parameters: { type: 'object', properties: {} },
  },
  {
    name: 'deactivate_rule',
    description: 'Turn off a rule. Use get_today or ask them to identify which.',
    parameters: {
      type: 'object',
      properties: { ruleId: int('The rule id') },
      required: ['ruleId'],
    },
  },
];

export const TOOL_NAMES = new Set(TOOLS.map((tool) => tool.name));
