import Groq from 'groq-sdk';

export type RetrievedContext = {
  minutesId: string;
  title: string;
  text: string;
};

type AnswerGroupQuestionInput = {
  question: string;
  chunks: RetrievedContext[];
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

// Deterministic answer for the automated test suite (AI_STUB=1).
const STUB_ANSWER = 'Stub answer across meetings: the team agreed to ship on Friday. [1]';

/**
 * Generates a RAG answer grounded STRICTLY in the retrieved chunks — the "G"
 * of RAG. The chunks are labeled [1] [2] … and the model is told to answer
 * only from them and cite the labels it used. This is the hallucination
 * control: the model can't invent facts that aren't in the excerpts, and the
 * citations let the UI deep-link back to the source meeting.
 *
 * Throws on provider failure so the route maps it to a 502.
 */
export async function answerGroupQuestion({ question, chunks }: AnswerGroupQuestionInput): Promise<string> {
  if (process.env.AI_STUB === '1') {
    return STUB_ANSWER;
  }

  const context = chunks
    .map((chunk, index) => `[${index + 1}] (from "${chunk.title}")\n${chunk.text}`)
    .join('\n\n');

  const systemPrompt = [
    'You answer questions about a team\'s meetings using ONLY the excerpts provided below.',
    'Each excerpt is labeled [1], [2], etc. Cite the excerpts you use inline, e.g. "... shipped Friday [2]".',
    'If the excerpts do not contain the answer, say: "I couldn\'t find that across your meetings."',
    'Be concise (a few sentences). Do not invent facts that are not in the excerpts.',
    '',
    '--- EXCERPTS ---',
    context || '(no relevant excerpts found)',
  ].join('\n');

  const completion = await groq.chat.completions.create({
    model: 'llama-3.1-8b-instant',
    messages: [
      { role: 'system', content: systemPrompt },
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

const groupQaService = {
  answerGroupQuestion,
};

export default groupQaService;
