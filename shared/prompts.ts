import { COLORS } from './types.ts';
import type { AskRequest, Level } from './types.ts';

const LEVEL_GUIDE: Record<Level, string> = {
  beginner: 'The learner is new to this. Use everyday analogies, avoid jargon, and define each new term the moment you use it.',
  intermediate: 'The learner knows the basics. Move briskly through foundations and spend most time on the mechanism and the worked example.',
  advanced: 'The learner is comfortable with the field. Be precise, include the key formula or rule, and point out a common subtlety.',
};

export const STEP_COUNT = 5;

// ---------------------------------------------------------------------------
// Stage 1: outline (small, flat JSON)
// ---------------------------------------------------------------------------

export interface Outline {
  refusal?: string;
  title: string;
  summary: string;
  example: string;
  steps: { title: string; goal: string }[];
  quiz: { q: string; options: string[]; answer: number; why: string }[];
}

export function outlineMessages(topic: string, level: Level) {
  const system = `You are Chalkline, an expert tutor planning a 2-minute whiteboard lesson.
${LEVEL_GUIDE[level]}
Plan exactly ${STEP_COUNT} steps that build on each other: 1) hook and the question we will answer, 2) the core idea, 3) how it works, 4) one worked example using the running example with real values, 5) recap and the one thing to remember.
"example" is ONE concrete running example with real values that steps 3 and 4 will draw. Pick one that shows the process over several stages rather than finishing at once (for example "find 57 in the sorted list 3, 8, 15, 23, 42, 57, 91", which needs two halvings).
"goal" says what that step must teach and what it should draw or demonstrate, in one sentence (for example "cross out the left half", "graph the balance over 4 years", "move the two cards to swap them").
Write 3 quiz questions that check understanding, with 3 or 4 options each; "answer" is the 0-based index of the correct option; "why" is one sentence.
Be factually careful. If the topic asks for dangerous, hateful or sexual content, set "refusal" to a one-sentence reason; otherwise set it to "".
Return ONLY a JSON object with this shape, no other text:
{"refusal":"","title":"...","summary":"one sentence","example":"...","steps":[{"title":"...","goal":"..."}],"quiz":[{"q":"...","options":["...","...","..."],"answer":0,"why":"..."}]}`;
  return [
    { role: 'system', content: system },
    { role: 'user', content: `Topic: "${topic}"\nLevel: ${level}` },
  ];
}

export const outlineSchema = {
  type: 'object',
  properties: {
    refusal: { type: 'string' },
    title: { type: 'string' },
    summary: { type: 'string' },
    example: { type: 'string' },
    steps: {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' }, goal: { type: 'string' } },
        required: ['title', 'goal'],
      },
    },
    quiz: {
      type: 'array',
      items: {
        type: 'object',
        properties: {
          q: { type: 'string' },
          options: { type: 'array', items: { type: 'string' } },
          answer: { type: 'integer' },
          why: { type: 'string' },
        },
        required: ['q', 'options', 'answer', 'why'],
      },
    },
  },
  required: ['refusal', 'title', 'summary', 'example', 'steps', 'quiz'],
};

// ---------------------------------------------------------------------------
// Stage 2: one step (compact line format), generated in parallel per step
// ---------------------------------------------------------------------------

const BOARD_RULES = `WHITEBOARD (100 wide, 62 tall, (0,0) top-left; x,y are the CENTRE of an item)
DRAW commands, one per line:
  DRAW: text id=<id> text="<at most 6 words>" x=<n> y=<n> size=sm|md|lg color=<c>
  DRAW: box id=<id> text="<label>" x=<n> y=<n> w=<6-30> h=<6-10> color=<c>
  DRAW: circle id=<id> text="<label>" x=<n> y=<n> r=<4-9> color=<c>
  DRAW: arrow from=<id> to=<id> text="<optional short label>" color=<c>
  DRAW: line from=<id> to=<id> color=<c>
  DRAW: graph id=<id> text="<title>" x=<n> y=<n> w=<24-60> h=<16-36> points="<x:y x:y x:y ...>" color=<c>
                                     (line chart of real numbers, e.g. points="0:1000 1:1100 2:1210 3:1331")
  DRAW: underline target=<id> color=<c>
  DRAW: highlight target=<id>        (points at an existing item while this sentence is spoken)
  DRAW: cross target=<id>            (strikes an item out: eliminated, ruled out, wrong, cancelled)
  DRAW: move target=<id> x=<n> y=<n> (slides an existing item so its centre ends at x,y: swaps, steps, combining)
  DRAW: erase target=<id>
Colors: ${COLORS.join(', ')}. Ids are short kebab-case words. Only reference ids you created in this step.
Layout: the heading goes at the top (x=50 y=5 size=lg). Use the area y=14 to y=58. Leave at least 3 units between items. At most 10 items.
Draw the REAL thing: actual numbers in array cells, the actual equation, named parts, actual values in the example. A row of boxes (w=8 h=7, 10 units apart) shows a list or sequence well.
DEMONSTRATE, don't just label: show the process changing the board. Use cross when something is eliminated or ruled out, move when things swap, combine or travel, highlight to point at what you are talking about, and graph whenever numbers grow, shrink or relate to each other.`;

export function stepMessages(topic: string, level: Level, outline: Outline, index: number) {
  const step = outline.steps[index];
  const plan = outline.steps.map((s, i) => `${i + 1}. ${s.title}: ${s.goal}`).join('\n');
  const opening =
    index === 0
      ? `This is the first step: open with a hook. Write the lesson title "${outline.title}" as the heading.`
      : `The board is wiped before this step. Write the step title "${step.title}" as the heading. Do not greet the learner again; continue naturally from step ${index}.`;
  const system = `You are Chalkline, a tutor teaching "${outline.title}" at a whiteboard while talking. ${LEVEL_GUIDE[level]}
You are writing ONLY step ${index + 1} of ${outline.steps.length}.

Lesson plan:
${plan}
Running example: ${outline.example}

Write 3 or 4 beats. A beat is one SAY line (one or two spoken sentences, 15 to 25 words) followed by 1 to 3 DRAW lines that happen while it is spoken.
SAY lines are read aloud by a speech engine: plain conversational English, no markdown, no emoji, symbols written as words ("x squared", "greater than"). Refer to what you draw ("this box", "the arrow") so voice and board feel connected. Be factually careful.
${opening}

${BOARD_RULES}

Output ONLY SAY and DRAW lines, nothing else.`;

  const example = `Example of the format (different topic, do not copy):
SAY: Sunlight looks white, but it is really a mix of every colour of light travelling together.
DRAW: text id=title text="Why is the sky blue?" x=50 y=5 size=lg
DRAW: circle id=sun text="Sun" x=14 y=28 r=7 color=orange
SAY: When that light hits tiny air molecules, short blue waves bounce around far more than red ones do.
DRAW: box id=air text="Air molecules" x=50 y=28 w=22 h=8 color=blue
DRAW: arrow from=sun to=air text="white light"
SAY: So blue light reaches your eyes from every direction, and that is why the whole sky glows blue.
DRAW: circle id=eye text="You" x=86 y=28 r=6
DRAW: arrow from=air to=eye text="scattered blue" color=blue
DRAW: highlight target=air`;

  return [
    { role: 'system', content: system },
    { role: 'user', content: `${example}\n\nNow write step ${index + 1}: "${step.title}". Goal: ${step.goal}\nTopic: ${topic}` },
  ];
}

// ---------------------------------------------------------------------------
// Follow-up questions
// ---------------------------------------------------------------------------

export function askMessages(req: AskRequest) {
  const board = req.board.length
    ? req.board.map((b) => `- ${b.id}: "${b.label}"`).join('\n')
    : '(the board is empty)';
  const selected = req.selectedId ? req.board.find((b) => b.id === req.selectedId) : undefined;
  const circled = req.board.filter((b) => req.circled?.includes(b.id));

  const system = `You are Chalkline, the tutor who is teaching "${req.lessonTitle}" (topic: ${req.topic}) at a whiteboard.
The learner paused the lesson to ask a question. Your answer is read aloud, then the lesson resumes.

Rules:
- Answer in at most 80 words of plain spoken English: no markdown, no lists, no emoji. Write symbols as words.
- Ground the answer in what the learner has just heard and what is on the board. Refer to board items by their label.
- If the question shows a misconception, gently name it and correct it.
- If the question is off-topic, answer in one sentence and steer back to the lesson.
- If you are not sure, say so plainly rather than guessing.
- Decline harmful requests in one sentence.
- "highlight": up to 2 board item ids (from the list below) worth pointing at while you answer, or an empty array.

Current step: ${req.stepTitle}
What the learner has heard in this step: ${req.context || '(nothing yet)'}
Board items (id: label):
${board}
${selected ? `The learner selected the item "${selected.label}" (id ${selected.id}) before asking.` : ''}
${circled.length ? `The learner drew on the board to mark: ${circled.map((b) => `"${b.label}"`).join(', ')}. "This" or "the part I marked" refers to these.` : ''}
Return ONLY a JSON object: {"answer": string, "highlight": string[]}.`;

  const history = req.history.slice(-6).map((m) => ({
    role: m.role === 'user' ? 'user' : 'assistant',
    content: m.text,
  }));
  return [{ role: 'system', content: system }, ...history, { role: 'user', content: req.question }];
}

export const askSchema = {
  type: 'object',
  properties: {
    answer: { type: 'string' },
    highlight: { type: 'array', items: { type: 'string' } },
  },
  required: ['answer', 'highlight'],
};
