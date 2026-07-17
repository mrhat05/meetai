'use client';

import { useRef, useState } from 'react';
import { LuSparkles, LuSend, LuFileText } from 'react-icons/lu';
import api from '@/lib/api';
import ChatMarkdown from '@/components/ChatMarkdown';

type Source = { minutesId: string; title: string };

type AskMessage = {
  role: 'user' | 'assistant';
  content: string;
  sources?: Source[];
  isError?: boolean;
};

type GroupAskCardProps = {
  groupId: string;
  /** Opens a specific meeting's minutes modal (reuses the page's handler). */
  onOpenMinutes: (minutesId: string) => void;
};

const SUGGESTIONS = [
  'What did we decide across all our meetings?',
  'What action items are still open?',
  'Summarize the release discussion.',
];

/**
 * "Ask across meetings" — RAG chat over every meeting in the group. Answers
 * come back with source chips that deep-link to the meeting each fact came
 * from (via the page's existing minutes modal). Mirrors MinutesModal's Ask
 * panel styling so the two feel like one system.
 */
export default function GroupAskCard({ groupId, onOpenMinutes }: GroupAskCardProps) {
  const [messages, setMessages] = useState<AskMessage[]>([]);
  const [input, setInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  const ask = async (rawQuestion?: string) => {
    const question = (rawQuestion ?? input).trim();
    if (!question || isAsking || !groupId) return;

    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setInput('');
    setIsAsking(true);

    try {
      const { data } = await api.post<{ answer: string; sources: Source[] }>(
        `/groups/${groupId}/ask`,
        { question },
      );
      setMessages((prev) => [
        ...prev,
        { role: 'assistant', content: data.answer, sources: data.sources },
      ]);
    } catch (askError: any) {
      setMessages((prev) => [
        ...prev,
        {
          role: 'assistant',
          content: askError?.response?.data?.error || 'Something went wrong. Please try again.',
          isError: true,
        },
      ]);
    } finally {
      setIsAsking(false);
      requestAnimationFrame(() => {
        scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
      });
    }
  };

  return (
    <div className="mb-4 overflow-hidden rounded-2xl border border-[var(--border)] bg-white/[0.02]">
      <div className="flex items-center gap-2 border-b border-white/10 px-4 py-3">
        <span className="flex h-8 w-8 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-violet-200">
          <LuSparkles aria-hidden="true" />
        </span>
        <div>
          <p className="text-sm font-semibold text-white">Ask across meetings</p>
          <p className="text-xs text-white/50">Answers cite the meetings they came from.</p>
        </div>
      </div>

      <div ref={scrollRef} className="max-h-[22rem] space-y-3 overflow-y-auto overscroll-contain p-4">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center gap-3 py-4 text-center">
            <p className="text-sm text-white/60">Ask a question spanning every meeting in this group.</p>
            <div className="flex flex-wrap justify-center gap-2">
              {SUGGESTIONS.map((suggestion) => (
                <button
                  key={suggestion}
                  type="button"
                  onClick={() => void ask(suggestion)}
                  className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
                >
                  {suggestion}
                </button>
              ))}
            </div>
          </div>
        ) : (
          messages.map((message, index) => (
            <div key={`${message.role}-${index}`} className="space-y-2">
              <div
                className={`max-w-[85%] rounded-xl px-3 py-2.5 text-sm leading-6 ${
                  message.role === 'user'
                    ? 'ml-auto bg-[rgba(124,108,246,0.2)] text-white'
                    : message.isError
                      ? 'border border-rose-500/20 bg-rose-500/10 text-rose-200'
                      : 'border border-white/10 bg-black/20 text-white/90'
                }`}
              >
                {message.role === 'assistant' && !message.isError ? (
                  <ChatMarkdown content={message.content} />
                ) : (
                  message.content
                )}
              </div>
              {message.sources && message.sources.length > 0 && (
                <div className="flex flex-wrap gap-1.5">
                  {message.sources.map((source) => (
                    <button
                      key={source.minutesId}
                      type="button"
                      onClick={() => onOpenMinutes(source.minutesId)}
                      className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
                    >
                      <LuFileText aria-hidden="true" className="text-violet-200" />
                      {source.title}
                    </button>
                  ))}
                </div>
              )}
            </div>
          ))
        )}

        {isAsking && (
          <div className="flex w-fit items-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
            {[0, 1, 2].map((dot) => (
              <span
                key={dot}
                className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/50"
                style={{ animationDelay: `${dot * 0.15}s` }}
              />
            ))}
          </div>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          void ask();
        }}
        className="flex shrink-0 gap-2 border-t border-white/10 p-3"
      >
        <input
          value={input}
          onChange={(event) => setInput(event.target.value)}
          maxLength={2000}
          disabled={isAsking}
          className="auth-input flex-1"
          placeholder="Ask about all your meetings…"
        />
        <button
          type="submit"
          disabled={isAsking || !input.trim()}
          className="btn btn-primary flex h-11 w-11 shrink-0 items-center justify-center px-0"
          aria-label="Send question"
        >
          <LuSend aria-hidden="true" />
        </button>
      </form>
    </div>
  );
}
