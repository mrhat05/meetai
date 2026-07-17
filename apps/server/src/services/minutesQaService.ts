import Groq from 'groq-sdk';

export type QaHistoryTurn = {
  role: 'user' | 'assistant';
  content: string;
};

type AnswerMinutesQuestionInput = {
  title: string;
  transcript: string;
  summaryMarkdown: string;
  question: string;
  history: QaHistoryTurn[];
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MAX_TRANSCRIPT_CHARS = 24_000;
const MAX_HISTORY_TURNS = 8;

// Deterministic answer used by the automated test suite (AI_STUB=1).
const STUB_ANSWER = 'Stub answer: the team agreed to ship on Friday.';

/**
 * Answers a question grounded strictly in one meeting's minutes
 * (transcript + AI summary). Throws on provider failure so the route
 * can map it to a 502.
 */
export async function answerMinutesQuestion({
  title,
  transcript,
  summaryMarkdown,
  question,
  history,
}: AnswerMinutesQuestionInput): Promise<string> {
  if (process.env.AI_STUB === '1') {
    return STUB_ANSWER;
  }

  const boundedTranscript =
    transcript.length > MAX_TRANSCRIPT_CHARS
      ? `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n[transcript truncated]`
      : transcript;

  const systemPrompt = [
    'You are a meeting assistant. Answer questions using ONLY the meeting minutes provided below.',
    'If the answer is not in the minutes, say: "I don\'t know — that isn\'t covered in this meeting."',
    'Be concise. Quote speakers or timestamps when helpful.',
    'Format the answer in Markdown: **bold** key names/decisions and use short bullet lists when listing multiple items.',
    '',
    `Meeting: ${title}`,
    '',
    '--- SUMMARY ---',
    summaryMarkdown || '(no summary)',
    '',
    '--- TRANSCRIPT ---',
    boundedTranscript || '(no transcript)',
  ].join('\n');

  const boundedHistory = history.slice(-MAX_HISTORY_TURNS).map((turn) => ({
    role: turn.role,
    content: turn.content.slice(0, 2000),
  }));

  const completion = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: systemPrompt },
      ...boundedHistory,
      { role: 'user', content: question },
    ],
    max_tokens: 512,
    temperature: 0.2,
  });

  const answer = completion.choices[0]?.message?.content;
  if (typeof answer !== 'string' || !answer.trim()) {
    throw new Error('Empty answer from model');
  }

  return answer.trim();
}

const minutesQaService = {
  answerMinutesQuestion,
};

export default minutesQaService;
