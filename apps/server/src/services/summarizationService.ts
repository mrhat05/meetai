import Groq from 'groq-sdk';

type SummarizeMeetingInput = {
  transcript: string;
  groupName: string;
  durationSeconds: number;
  participantCount: number;
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const FALLBACK_MARKDOWN = '## Summary\nSummary generation failed. Raw transcript is available below.';

// Deterministic minutes used by the automated test suite (AI_STUB=1) so it
// never hits the real Groq API.
const STUB_SUMMARY = [
  '## Summary',
  'Stubbed summary generated for automated testing.',
  '',
  '## Key discussion points',
  '- Release timeline for the upcoming version',
  '',
  '## Decisions made',
  '- Ship the release on Friday.',
  '',
  '## Action items',
  '- **[ACTION]** Alex to send the report by Wednesday.',
  '',
  '## Next steps',
  '- Reconvene at the next weekly sync.',
].join('\n');

type GenerateTitleInput = {
  transcript: string;
  groupName: string;
};

const STUB_TITLE = 'Weekly sync — release planning';

/**
 * Generates a short content-derived meeting title (e.g. "Release planning —
 * ship Friday"). Returns null when it can't produce a usable title so the
 * caller can fall back to the default "<group> · <date>" format.
 */
export async function generateMinutesTitle({ transcript, groupName }: GenerateTitleInput): Promise<string | null> {
  if (!transcript.trim()) {
    return null;
  }

  if (process.env.AI_STUB === '1') {
    return STUB_TITLE;
  }

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: [
            'You name meetings from their transcript.',
            'Reply with ONLY the title: 3-8 words, at most 60 characters,',
            'capturing the main topic or outcome. No quotes, no trailing punctuation.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Group: ${groupName}\n\nTranscript:\n${transcript.slice(0, 8000)}\n\nTitle:`,
        },
      ],
      max_tokens: 24,
      temperature: 0.2,
    });

    const raw = completion.choices[0]?.message?.content;
    if (typeof raw !== 'string') {
      return null;
    }

    const title = raw
      .replace(/["'`]/g, '')
      .replace(/\s+/g, ' ')
      .replace(/[.!,;:\s]+$/, '')
      .trim()
      .slice(0, 60)
      .trim();

    return title.length >= 3 ? title : null;
  } catch (error) {
    console.error('generateMinutesTitle failed:', error);
    return null;
  }
}

export async function summarizeMeeting({
  transcript,
  groupName,
  durationSeconds,
  participantCount,
}: SummarizeMeetingInput): Promise<string> {
  if (process.env.AI_STUB === '1') {
    return STUB_SUMMARY;
  }

  const systemPrompt = [
    'You are a professional meeting secretary.',
    'You produce clean, structured meeting minutes in Markdown.',
    'Be concise. Use bullet points. Highlight action items with **[ACTION]** prefix.',
  ].join('\n');

  const userPrompt = [
    `Meeting: ${groupName}`,
    `Duration: ${Math.floor(durationSeconds / 60)} minutes`,
    `Participants: ${participantCount}`,
    '',
    'Transcript:',
    transcript,
    '',
    'Generate meeting minutes with these sections:',
    '## Summary',
    '## Key discussion points',
    '## Decisions made',
    '## Action items',
    '## Next steps',
  ].join('\n');

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      messages: [
        {
          role: 'system',
          content: systemPrompt,
        },
        {
          role: 'user',
          content: userPrompt,
        },
      ],
      max_tokens: 1024,
      temperature: 0.3,
    });

    const content = completion.choices[0]?.message?.content;
    return typeof content === 'string' ? content : '';
  } catch (error) {
    console.error('summarizeMeeting failed:', error);
    return FALLBACK_MARKDOWN;
  }
}

const summarizationService = {
  summarizeMeeting,
  generateMinutesTitle,
};

export default summarizationService;