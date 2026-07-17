'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LuSparkles, LuSend, LuFileText, LuUsers, LuPlus, LuTrash2, LuMessageSquare, LuMenu } from 'react-icons/lu';
import api from '@/lib/api';
import AppHeader from '@/components/AppHeader';
import ChatMarkdown from '@/components/ChatMarkdown';

type Source = { minutesId: string; title: string; roomCode: string; groupId: string | null };
type ChatMessage = { role: 'user' | 'assistant'; content: string; sources?: Source[]; isError?: boolean };
type ThreadSummary = { id: string; title: string; updatedAt: string };

const SUGGESTIONS = [
  'What did I commit to across my meetings?',
  'Summarize my recent decisions.',
  'What action items are still open for me?',
];

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const mins = Math.round(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs}h ago`;
  return `${Math.round(hrs / 24)}d ago`;
}

export default function AssistantPage() {
  const router = useRouter();
  const [threads, setThreads] = useState<ThreadSummary[]>([]);
  const [activeThreadId, setActiveThreadId] = useState<string | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const [isLoadingThread, setIsLoadingThread] = useState(false);
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!window.localStorage.getItem('accessToken')) {
      router.replace('/login');
    }
  }, [router]);

  const loadThreads = useCallback(async () => {
    try {
      const { data } = await api.get<ThreadSummary[]>('/assistant/threads');
      setThreads(data);
    } catch {
      /* non-fatal */
    }
  }, []);

  useEffect(() => {
    void loadThreads();
  }, [loadThreads]);

  // Keep the view pinned to the newest message while the conversation grows or
  // the assistant is typing.
  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [messages, isAsking, isLoadingThread]);

  const startNewChat = () => {
    setActiveThreadId(null);
    setMessages([]);
    setSidebarOpen(false);
  };

  const openThread = async (id: string) => {
    setSidebarOpen(false);
    if (id === activeThreadId) return;
    setActiveThreadId(id);
    setMessages([]);
    setIsLoadingThread(true);
    try {
      const { data } = await api.get<{ id: string; title: string; messages: ChatMessage[] }>(`/assistant/threads/${id}`);
      setMessages(data.messages);
    } catch {
      setMessages([{ role: 'assistant', content: 'Could not load this chat.', isError: true }]);
    } finally {
      setIsLoadingThread(false);
    }
  };

  const deleteThread = async (id: string, event: React.MouseEvent) => {
    event.stopPropagation();
    setThreads((prev) => prev.filter((t) => t.id !== id));
    if (id === activeThreadId) startNewChat();
    try {
      await api.delete(`/assistant/threads/${id}`);
    } catch {
      void loadThreads();
    }
  };

  const ask = async (rawQuestion?: string) => {
    const question = (rawQuestion ?? input).trim();
    if (!question || isAsking) return;

    setMessages((prev) => [...prev, { role: 'user', content: question }]);
    setInput('');
    setIsAsking(true);

    try {
      const { data } = await api.post<{ threadId: string; title: string; answer: string; sources: Source[] }>(
        '/assistant/ask',
        { question, threadId: activeThreadId ?? undefined },
      );
      setActiveThreadId(data.threadId);
      setMessages((prev) => [...prev, { role: 'assistant', content: data.answer, sources: data.sources }]);
      void loadThreads(); // new/bumped thread rises to the top of the list
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
    }
  };

  const openSource = (source: Source) => {
    if (source.groupId) {
      router.push(`/groups/${source.groupId}?minutes=${source.minutesId}`);
    } else {
      router.push(`/room/${source.roomCode}/minutes`);
    }
  };

  const sidebar = (
    <div className="flex h-full flex-col gap-3">
      <button onClick={startNewChat} className="btn btn-primary w-full justify-center">
        <LuPlus aria-hidden="true" /> New chat
      </button>
      <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">
        {threads.length === 0 ? (
          <p className="px-2 py-4 text-center text-xs text-faint">No chats yet.</p>
        ) : (
          threads.map((thread) => (
            <button
              key={thread.id}
              onClick={() => void openThread(thread.id)}
              className={`group flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left transition ${
                thread.id === activeThreadId ? 'bg-white/10 text-white' : 'text-white/70 hover:bg-white/5 hover:text-white'
              }`}
            >
              <LuMessageSquare aria-hidden="true" className="shrink-0 text-sm text-white/40" />
              <span className="min-w-0 flex-1 truncate text-sm">{thread.title}</span>
              <span className="shrink-0 text-[0.65rem] text-faint">{relativeTime(thread.updatedAt)}</span>
              <span
                role="button"
                tabIndex={-1}
                onClick={(e) => void deleteThread(thread.id, e)}
                className="shrink-0 rounded p-1 text-white/30 opacity-0 transition hover:text-rose-300 group-hover:opacity-100"
                aria-label="Delete chat"
              >
                <LuTrash2 aria-hidden="true" className="text-xs" />
              </span>
            </button>
          ))
        )}
      </div>
    </div>
  );

  return (
    <main className="min-h-screen app-root px-4 py-6 text-white sm:px-6 sm:py-8">
      <div className="mx-auto max-w-6xl">
        <AppHeader />

        <div className="flex gap-6">
          {/* Sidebar — desktop */}
          <aside className="hidden w-64 shrink-0 lg:block">
            <div className="card h-[calc(100vh-9rem)] p-3">{sidebar}</div>
          </aside>

          {/* Conversation */}
          <section className="min-w-0 flex-1">
            <div className="mb-3 flex items-center gap-3">
              <button onClick={() => setSidebarOpen(true)} className="btn btn-ghost lg:hidden" aria-label="Chats">
                <LuMenu aria-hidden="true" />
              </button>
              <div>
                <h1 className="font-display text-xl font-semibold tracking-tight sm:text-2xl">Your AI assistant</h1>
                <p className="text-xs muted">Answers span every meeting you can see and cite their sources.</p>
              </div>
            </div>

            <div className="card flex h-[calc(100vh-11rem)] flex-col overflow-hidden p-0">
              <div ref={scrollRef} className="min-h-0 flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 sm:p-6">
                {messages.length === 0 && !isLoadingThread ? (
                  <div className="flex h-full flex-col items-center justify-center gap-4 text-center">
                    <span className="flex h-12 w-12 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-violet-200">
                      <LuSparkles aria-hidden="true" className="text-xl" />
                    </span>
                    <p className="max-w-sm text-sm text-white/60">
                      Ask a question that spans your meetings — decisions, action items, or what someone said.
                    </p>
                    <div className="flex flex-wrap justify-center gap-2">
                      {SUGGESTIONS.map((s) => (
                        <button
                          key={s}
                          type="button"
                          onClick={() => void ask(s)}
                          className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
                        >
                          {s}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  messages.map((message, index) => (
                    <div key={`${message.role}-${index}`} className="space-y-2">
                      <div
                        className={`max-w-[85%] rounded-xl px-3.5 py-2.5 text-sm leading-6 ${
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
                              onClick={() => openSource(source)}
                              className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-3 py-1 text-xs font-medium text-white/80 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
                            >
                              {source.groupId ? (
                                <LuUsers aria-hidden="true" className="text-violet-200" />
                              ) : (
                                <LuFileText aria-hidden="true" className="text-violet-200" />
                              )}
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
                      <span key={dot} className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/50" style={{ animationDelay: `${dot * 0.15}s` }} />
                    ))}
                  </div>
                )}
              </div>

              <form
                onSubmit={(event) => {
                  event.preventDefault();
                  void ask();
                }}
                className="flex shrink-0 gap-2 border-t border-white/10 p-3 sm:p-4"
              >
                <input
                  value={input}
                  onChange={(event) => setInput(event.target.value)}
                  maxLength={2000}
                  disabled={isAsking}
                  className="auth-input flex-1"
                  placeholder="Ask across all your meetings…"
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
          </section>
        </div>
      </div>

      {/* Sidebar — mobile drawer */}
      {sidebarOpen && (
        <div className="fixed inset-0 z-50 lg:hidden">
          <div className="absolute inset-0 bg-black/60" onClick={() => setSidebarOpen(false)} />
          <div className="absolute inset-y-0 left-0 w-72 max-w-[80vw] border-r border-white/10 bg-[var(--surface-2,#111)] p-3">
            {sidebar}
          </div>
        </div>
      )}
    </main>
  );
}
