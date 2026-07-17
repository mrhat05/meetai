import { Router } from 'express';
import type { Request, Response } from 'express';
import db from '../../db.js';
import { authMiddleware } from '../../middleware/authMiddleware.js';
import { askRateLimit } from '../../middleware/rateLimit.js';
import { embedText } from '../services/embeddingService.ts';
import { retrievePersonalChunks } from '../services/minutesChunkService.ts';
import { answerGroupQuestion, type QaHistoryTurn, type RetrievedContext } from '../services/groupQaService.ts';

const router = Router();

type AssistantSource = { minutesId: string; title: string; roomCode: string; groupId: string | null };

function threadTitleFrom(question: string): string {
  const clean = question.replace(/\s+/g, ' ').trim();
  return (clean.length > 60 ? `${clean.slice(0, 57)}…` : clean).slice(0, 200) || 'New chat';
}

// GET /assistant/threads — the user's chat threads, newest activity first.
router.get('/threads', authMiddleware, async (req: Request, res: Response) => {
  try {
    const threads = await db.assistantThread.findMany({
      where: { userId: req.user!.userId },
      orderBy: { updatedAt: 'desc' },
      select: { id: true, title: true, updatedAt: true },
    });
    return res.json(threads.map((t) => ({ id: t.id, title: t.title, updatedAt: t.updatedAt })));
  } catch (error) {
    console.error('Error listing assistant threads:', error);
    return res.status(500).json({ error: 'Failed to load chats' });
  }
});

// GET /assistant/threads/:id — full conversation (owner only).
router.get('/threads/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const thread = await db.assistantThread.findUnique({ where: { id } });
    if (!thread || thread.userId !== req.user!.userId) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    const messages = await db.assistantMessage.findMany({
      where: { threadId: id },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true, sources: true },
    });
    return res.json({
      id: thread.id,
      title: thread.title,
      messages: messages.map((m) => ({ role: m.role, content: m.content, sources: m.sources })),
    });
  } catch (error: any) {
    console.error('Error loading assistant thread:', error);
    if (error?.code === 'P2023' || error?.code === '22P02') {
      return res.status(404).json({ error: 'Chat not found' });
    }
    return res.status(500).json({ error: 'Failed to load chat' });
  }
});

// DELETE /assistant/threads/:id — owner only (cascades messages).
router.delete('/threads/:id', authMiddleware, async (req: Request, res: Response) => {
  try {
    const { id } = req.params as { id: string };
    const thread = await db.assistantThread.findUnique({ where: { id } });
    if (!thread || thread.userId !== req.user!.userId) {
      return res.status(404).json({ error: 'Chat not found' });
    }
    await db.assistantThread.delete({ where: { id } });
    return res.json({ success: true });
  } catch (error: any) {
    console.error('Error deleting assistant thread:', error);
    if (error?.code === 'P2023' || error?.code === '22P02') {
      return res.status(404).json({ error: 'Chat not found' });
    }
    return res.status(500).json({ error: 'Failed to delete chat' });
  }
});

// POST /assistant/ask — RAG across everything this user can see, within a thread.
// { question, threadId? } — no threadId starts a new thread. Persists both turns
// and uses prior turns of the thread as follow-up context.
router.post('/ask', authMiddleware, askRateLimit, async (req: Request, res: Response) => {
  try {
    const userId = req.user!.userId;
    const body = req.body as { question?: unknown; threadId?: unknown };
    const question = typeof body.question === 'string' ? body.question.trim() : '';
    if (!question || question.length > 2000) {
      return res.status(400).json({ error: 'question is required (max 2000 characters)' });
    }

    // Resolve or create the thread (ownership enforced).
    let threadId = typeof body.threadId === 'string' ? body.threadId : '';
    if (threadId) {
      const existing = await db.assistantThread.findUnique({ where: { id: threadId } });
      if (!existing || existing.userId !== userId) {
        return res.status(404).json({ error: 'Chat not found' });
      }
    } else {
      const created = await db.assistantThread.create({
        data: { userId, title: threadTitleFrom(question) },
        select: { id: true },
      });
      threadId = created.id;
    }

    // Prior turns → follow-up context (before persisting the new user message).
    const priorMessages = await db.assistantMessage.findMany({
      where: { threadId },
      orderBy: { createdAt: 'asc' },
      select: { role: true, content: true },
    });
    const history: QaHistoryTurn[] = priorMessages
      .filter((m) => m.role === 'user' || m.role === 'assistant')
      .map((m) => ({ role: m.role as 'user' | 'assistant', content: m.content }));

    await db.assistantMessage.create({ data: { threadId, role: 'user', content: question } });

    // Retrieve across the user's meetings (ACL filter is inside the SQL).
    const queryVector = await embedText(question);
    const retrieved = await retrievePersonalChunks(userId, queryVector, 8);

    let answer: string;
    let sources: AssistantSource[] = [];

    if (retrieved.length === 0) {
      answer = "I couldn't find anything about that across your meetings yet.";
    } else {
      const chunks: RetrievedContext[] = retrieved.map((row) => ({
        minutesId: row.minutes_id,
        title: row.title,
        text: row.chunk_text,
      }));
      const seen = new Set<string>();
      for (const row of retrieved) {
        if (!seen.has(row.minutes_id)) {
          seen.add(row.minutes_id);
          sources.push({ minutesId: row.minutes_id, title: row.title, roomCode: row.room_code, groupId: row.group_id });
        }
      }
      try {
        answer = await answerGroupQuestion({ question, chunks, history });
      } catch (aiError) {
        console.error('Assistant Ask-AI failed:', aiError);
        return res.status(502).json({ error: 'AI is unavailable right now' });
      }
    }

    await db.assistantMessage.create({
      data: { threadId, role: 'assistant', content: answer, sources: sources as unknown as object },
    });
    const updated = await db.assistantThread.update({
      where: { id: threadId },
      data: { updatedAt: new Date() },
      select: { title: true },
    });

    return res.json({ threadId, title: updated.title, answer, sources });
  } catch (error) {
    console.error('Error answering assistant question:', error);
    return res.status(500).json({ error: 'Failed to answer question' });
  }
});

export default router;
