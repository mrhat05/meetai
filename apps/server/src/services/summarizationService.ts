import Groq from 'groq-sdk';

type SummarizeMeetingInput = {
  transcript: string;
  groupName: string;
  durationSeconds: number;
  participantCount: number;
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const FALLBACK_MARKDOWN = '## Summary\nSummary generation failed. Raw transcript is available below.';

export async function summarizeMeeting({
  transcript,
  groupName,
  durationSeconds,
  participantCount,
}: SummarizeMeetingInput): Promise<string> {
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
};

export default summarizationService;