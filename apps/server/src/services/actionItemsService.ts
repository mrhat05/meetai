import { randomUUID } from 'node:crypto';
import Groq from 'groq-sdk';

export type ActionItem = {
  id: string;
  task: string;
  assignee: string | null;
  due: string | null;
  done: boolean;
};

type ExtractActionItemsInput = {
  transcript: string;
  summaryMarkdown: string;
};

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

const MAX_ITEMS = 20;
const MAX_TRANSCRIPT_CHARS = 16_000;

// Deterministic items used by the automated test suite (AI_STUB=1).
const STUB_ITEMS: Array<{ task: string; assignee: string | null; due: string | null }> = [
  { task: 'Send the report', assignee: 'Alex', due: 'Wednesday' },
  { task: 'Ship the release', assignee: null, due: 'Friday' },
];

function toActionItem(raw: { task?: unknown; assignee?: unknown; due?: unknown }): ActionItem | null {
  const task = typeof raw.task === 'string' ? raw.task.trim() : '';
  if (!task) {
    return null;
  }

  const assignee = typeof raw.assignee === 'string' && raw.assignee.trim() ? raw.assignee.trim().slice(0, 120) : null;
  const due = typeof raw.due === 'string' && raw.due.trim() ? raw.due.trim().slice(0, 120) : null;

  return {
    id: randomUUID(),
    task: task.slice(0, 300),
    assignee,
    due,
    done: false,
  };
}

/**
 * Extracts structured action items from a meeting's transcript + summary using
 * Groq JSON mode. Returns [] on empty input or any failure so the pipeline
 * never breaks because of action-item extraction.
 */
export async function extractActionItems({ transcript, summaryMarkdown }: ExtractActionItemsInput): Promise<ActionItem[]> {
  if (!transcript.trim() && !summaryMarkdown.trim()) {
    return [];
  }

  if (process.env.AI_STUB === '1') {
    return STUB_ITEMS.map((item) => toActionItem(item)).filter((item): item is ActionItem => item !== null);
  }

  const boundedTranscript =
    transcript.length > MAX_TRANSCRIPT_CHARS ? `${transcript.slice(0, MAX_TRANSCRIPT_CHARS)}\n[truncated]` : transcript;

  try {
    const completion = await groq.chat.completions.create({
      model: 'llama-3.1-8b-instant',
      response_format: { type: 'json_object' },
      max_tokens: 1024,
      temperature: 0.1,
      messages: [
        {
          role: 'system',
          content: [
            'You extract concrete action items from meeting notes.',
            'Return ONLY JSON of the form {"items":[{"task":string,"assignee":string|null,"due":string|null}]}.',
            'task = the thing to do (imperative, concise). assignee = the person responsible or null.',
            'due = any deadline mentioned (e.g. "Friday", "next week") or null.',
            'Only include real commitments. If there are none, return {"items":[]}.',
          ].join(' '),
        },
        {
          role: 'user',
          content: `Summary:\n${summaryMarkdown}\n\nTranscript:\n${boundedTranscript}`,
        },
      ],
    });

    const content = completion.choices[0]?.message?.content;
    if (typeof content !== 'string') {
      return [];
    }

    const parsed = JSON.parse(content) as { items?: unknown };
    const rawItems = Array.isArray(parsed.items) ? parsed.items : [];

    return rawItems
      .slice(0, MAX_ITEMS)
      .map((item) => toActionItem(item as Record<string, unknown>))
      .filter((item): item is ActionItem => item !== null);
  } catch (error) {
    console.error('extractActionItems failed:', error);
    return [];
  }
}

const actionItemsService = {
  extractActionItems,
};

export default actionItemsService;
