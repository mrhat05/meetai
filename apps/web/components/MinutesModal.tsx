'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import { LuSparkles, LuSend, LuListChecks, LuUser, LuClock } from 'react-icons/lu';
import api from '@/lib/api';

type ActionItem = {
  id: string;
  task: string;
  assignee: string | null;
  due: string | null;
  done: boolean;
};

type MinutesDetail = {
  id: string;
  title: string;
  created_at: string;
  duration_seconds: number;
  participant_count: number;
  summary_markdown: string;
  raw_transcript: string;
  action_items: ActionItem[];
};

type MinutesModalProps = {
  isOpen: boolean;
  groupId: string;
  minutesId: string | null;
  onClose: () => void;
};

function formatMinutes(durationSeconds: number) {
  return `${Math.max(1, Math.round(durationSeconds / 60))} min`;
}

function formatDate(createdAt: string) {
  return new Date(createdAt).toLocaleDateString('en-IN', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  });
}

function highlightActionText(text: string) {
  return text.replace(/\*\*\[ACTION\]\*\*/g, '[ACTION]');
}

type QaMessage = {
  role: 'user' | 'assistant';
  content: string;
  isError?: boolean;
};

const QA_SUGGESTIONS = [
  'What were the action items?',
  'What did we decide?',
  'Summarize this in two sentences',
];

export default function MinutesModal({ isOpen, groupId, minutesId, onClose }: MinutesModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [minutes, setMinutes] = useState<MinutesDetail | null>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'transcript' | 'tasks' | 'ask'>('summary');
  const [error, setError] = useState<string | null>(null);
  const [qaMessages, setQaMessages] = useState<QaMessage[]>([]);
  const [qaInput, setQaInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const qaScrollRef = useRef<HTMLDivElement | null>(null);
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [togglingItemId, setTogglingItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !minutesId) return;

    let isMounted = true;

    const loadMinutes = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setMinutes(null);
        setActiveTab('summary');
        setQaMessages([]);
        setQaInput('');
        setActionItems([]);

        const { data } = await api.get<MinutesDetail>(`/groups/${groupId}/minutes/${minutesId}`);
        if (isMounted) {
          setMinutes(data);
          setActionItems(Array.isArray(data.action_items) ? data.action_items : []);
        }
      } catch (requestError: any) {
        console.error('Failed to fetch minutes detail:', requestError);
        if (isMounted) {
          setError(requestError.response?.data?.error || 'Unable to load minutes details.');
        }
      } finally {
        if (isMounted) {
          setIsLoading(false);
        }
      }
    };

    void loadMinutes();

    return () => {
      isMounted = false;
    };
  }, [groupId, isOpen, minutesId]);

  useEffect(() => {
    if (!isOpen) return;

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
      }
    };

    window.addEventListener('keydown', handleEscape);
    return () => window.removeEventListener('keydown', handleEscape);
  }, [isOpen, onClose]);

  useEffect(() => {
    qaScrollRef.current?.scrollTo({ top: qaScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [qaMessages, isAsking]);

  if (!isOpen) return null;

  const handleAskQuestion = async (rawQuestion?: string) => {
    const question = (rawQuestion ?? qaInput).trim();
    if (!question || isAsking || !minutesId) return;

    const history = qaMessages
      .filter((message) => !message.isError)
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));

    setQaMessages((current) => [...current, { role: 'user', content: question }]);
    setQaInput('');
    setIsAsking(true);

    try {
      const { data } = await api.post<{ answer: string }>(
        `/groups/${groupId}/minutes/${minutesId}/ask`,
        { question, history }
      );
      setQaMessages((current) => [...current, { role: 'assistant', content: data.answer }]);
    } catch (askError: any) {
      console.error('Ask-AI request failed:', askError);
      setQaMessages((current) => [
        ...current,
        {
          role: 'assistant',
          content: askError.response?.data?.error || 'Something went wrong — try asking again.',
          isError: true,
        },
      ]);
    } finally {
      setIsAsking(false);
    }
  };

  const handleToggleActionItem = async (item: ActionItem) => {
    if (!minutesId || togglingItemId) return;

    const nextDone = !item.done;
    setTogglingItemId(item.id);
    // Optimistic update.
    setActionItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, done: nextDone } : entry)));

    try {
      const { data } = await api.patch<{ actionItems: ActionItem[] }>(
        `/groups/${groupId}/minutes/${minutesId}/action-items/${item.id}`,
        { done: nextDone }
      );
      if (Array.isArray(data.actionItems)) {
        setActionItems(data.actionItems);
      }
    } catch (toggleError) {
      console.error('Failed to toggle action item:', toggleError);
      // Roll back on failure.
      setActionItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, done: item.done } : entry)));
    } finally {
      setTogglingItemId(null);
    }
  };

  const openTaskCount = actionItems.filter((item) => !item.done).length;

  const handleDownloadMarkdown = () => {
    if (!minutes) return;

    const summaryMarkdown = minutes.summary_markdown || 'No summary available.';
    const actionItemsMarkdown =
      actionItems.length > 0
        ? [
            '## Action items',
            ...actionItems.map((item) => {
              const meta = [item.assignee, item.due].filter(Boolean).join(', ');
              return `- [${item.done ? 'x' : ' '}] ${item.task}${meta ? ` (${meta})` : ''}`;
            }),
            '',
          ]
        : [];

    const content = [
      `# ${minutes.title}`,
      '',
      `Created: ${formatDate(minutes.created_at)}`,
      `Duration: ${formatMinutes(minutes.duration_seconds)}`,
      `Participants: ${minutes.participant_count}`,
      '',
      summaryMarkdown,
      '',
      ...actionItemsMarkdown,
      '## Raw transcript',
      minutes.raw_transcript || 'No transcript available.',
      '',
    ].join('\n');

    const blob = new Blob([content], { type: 'text/markdown' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');

    anchor.href = url;
    anchor.download = `${minutes.title}.md`;
    anchor.click();

    URL.revokeObjectURL(url);
  };

  const renderMarkdown = (markdown: string) => (
    <ReactMarkdown
      components={{
        h2: ({ children }) => <h2 className="mb-2 mt-4 text-base font-bold text-white first:mt-0">{children}</h2>,
        strong: ({ children }) => {
          const value = Array.isArray(children) ? children.join('') : String(children);
          if (value.includes('[ACTION]')) {
            return <span className="rounded-md bg-amber-400/20 px-1.5 py-0.5 font-semibold text-amber-100">{children}</span>;
          }

          return <strong className="font-semibold text-white">{children}</strong>;
        },
        p: ({ children }) => {
          const content = Array.isArray(children) ? children.join('') : String(children);
          if (content.includes('[ACTION]')) {
            return <p className="mb-2 rounded-lg bg-amber-400/15 px-3 py-2 text-amber-50">{children}</p>;
          }

          return <p className="mb-2 text-white/90">{children}</p>;
        },
        li: ({ children }) => {
          const content = Array.isArray(children) ? children.join('') : String(children);
          if (content.includes('[ACTION]')) {
            return <li className="mb-2 rounded-lg bg-amber-400/15 px-3 py-2 text-amber-50">{children}</li>;
          }

          return <li className="mb-2 text-white/90">{children}</li>;
        },
      }}
    >
      {highlightActionText(markdown)}
    </ReactMarkdown>
  );

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-6 backdrop-blur-md" onClick={onClose}>
      <div
        className="animate-pop-in card card-hero max-h-[90vh] w-full max-w-3xl overflow-y-auto p-6 text-white"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between gap-4 border-b border-white/10 pb-4">
          <div className="min-w-0">
            <h3 className="truncate text-xl font-semibold">{minutes?.title || 'Meeting minutes'}</h3>
            {minutes && (
              <p className="mt-1 text-sm text-white/60">
                {formatDate(minutes.created_at)} · {formatMinutes(minutes.duration_seconds)} · {minutes.participant_count} participant{minutes.participant_count === 1 ? '' : 's'}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button type="button" onClick={handleDownloadMarkdown} className="btn rounded-xl px-3 py-2 text-sm">
              Download .md
            </button>
            <button type="button" onClick={onClose} className="btn rounded-xl px-3 py-2 text-sm">
              Close
            </button>
          </div>
        </div>

        <div className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1">
          <button
            type="button"
            onClick={() => setActiveTab('summary')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === 'summary' ? 'bg-white text-slate-900' : 'text-white/75 hover:text-white'
            }`}
          >
            Summary
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('transcript')}
            className={`rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === 'transcript' ? 'bg-white text-slate-900' : 'text-white/75 hover:text-white'
            }`}
          >
            Raw transcript
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('tasks')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === 'tasks' ? 'bg-white text-slate-900' : 'text-white/75 hover:text-white'
            }`}
          >
            <LuListChecks aria-hidden="true" /> Tasks
            {openTaskCount > 0 && (
              <span
                className={`ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                  activeTab === 'tasks' ? 'bg-slate-900 text-white' : 'bg-white/15 text-white'
                }`}
              >
                {openTaskCount}
              </span>
            )}
          </button>
          <button
            type="button"
            onClick={() => setActiveTab('ask')}
            className={`inline-flex items-center gap-1.5 rounded-lg px-4 py-2 text-sm font-medium transition ${
              activeTab === 'ask' ? 'bg-white text-slate-900' : 'text-white/75 hover:text-white'
            }`}
          >
            <LuSparkles aria-hidden="true" /> Ask AI
          </button>
        </div>

        {isLoading ? (
          <p className="mt-6 text-sm text-white/70">Loading minutes...</p>
        ) : error ? (
          <p className="mt-6 text-sm text-red-300">{error}</p>
        ) : !minutes ? (
          <p className="mt-6 text-sm text-red-300">Unable to load minutes details.</p>
        ) : (
          <div className="mt-6 text-sm">
            {activeTab === 'summary' ? (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                {renderMarkdown(minutes.summary_markdown || 'No summary available.')}
              </section>
            ) : activeTab === 'transcript' ? (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="max-h-[55vh] overflow-auto rounded-xl border border-white/10 bg-black/20 p-4 font-mono text-[13px] leading-6 text-white/85 whitespace-pre-wrap">
                  {minutes.raw_transcript || 'No transcript available.'}
                </div>
              </section>
            ) : activeTab === 'tasks' ? (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                {actionItems.length === 0 ? (
                  <div className="flex flex-col items-center gap-3 py-10 text-center">
                    <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-white/5 text-xl text-white/70">
                      <LuListChecks aria-hidden="true" />
                    </span>
                    <p className="max-w-xs text-sm text-white/60">No action items were detected in this meeting.</p>
                  </div>
                ) : (
                  <>
                    <p className="mb-3 text-xs font-medium uppercase tracking-wide text-white/50">
                      {openTaskCount} open · {actionItems.length - openTaskCount} done
                    </p>
                    <ul className="space-y-2">
                      {actionItems.map((item) => (
                        <li key={item.id}>
                          <button
                            type="button"
                            onClick={() => void handleToggleActionItem(item)}
                            disabled={togglingItemId === item.id}
                            className="flex w-full items-start gap-3 rounded-xl border border-white/10 bg-black/20 p-3 text-left transition hover:border-white/25 hover:bg-black/30 disabled:opacity-60"
                          >
                            <span
                              className={`mt-0.5 flex h-5 w-5 shrink-0 items-center justify-center rounded-md border transition ${
                                item.done ? 'border-emerald-400/60 bg-emerald-500/80 text-white' : 'border-white/25 bg-transparent text-transparent'
                              }`}
                              aria-hidden="true"
                            >
                              <svg viewBox="0 0 20 20" fill="currentColor" className="h-3.5 w-3.5">
                                <path
                                  fillRule="evenodd"
                                  d="M16.7 5.3a1 1 0 0 1 0 1.4l-7 7a1 1 0 0 1-1.4 0l-3-3a1 1 0 1 1 1.4-1.4L9 11.6l6.3-6.3a1 1 0 0 1 1.4 0Z"
                                  clipRule="evenodd"
                                />
                              </svg>
                            </span>
                            <span className="min-w-0 flex-1">
                              <span className={`block text-sm leading-6 ${item.done ? 'text-white/45 line-through' : 'text-white/90'}`}>
                                {item.task}
                              </span>
                              {(item.assignee || item.due) && (
                                <span className="mt-1.5 flex flex-wrap items-center gap-2">
                                  {item.assignee && (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-white/10 bg-white/5 px-2 py-0.5 text-xs text-white/70">
                                      <LuUser aria-hidden="true" className="text-[0.7rem]" /> {item.assignee}
                                    </span>
                                  )}
                                  {item.due && (
                                    <span className="inline-flex items-center gap-1 rounded-full border border-amber-400/20 bg-amber-400/10 px-2 py-0.5 text-xs text-amber-100">
                                      <LuClock aria-hidden="true" className="text-[0.7rem]" /> {item.due}
                                    </span>
                                  )}
                                </span>
                              )}
                            </span>
                          </button>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>
            ) : (
              <section className="flex flex-col rounded-2xl border border-white/10 bg-white/5">
                <div ref={qaScrollRef} className="max-h-[45vh] min-h-[14rem] space-y-3 overflow-y-auto p-4">
                  {qaMessages.length === 0 ? (
                    <div className="flex h-full min-h-[12rem] flex-col items-center justify-center gap-3 text-center">
                      <span className="flex h-11 w-11 items-center justify-center rounded-2xl border border-white/10 bg-[rgba(124,108,246,0.14)] text-xl text-[var(--primary)]">
                        <LuSparkles aria-hidden="true" />
                      </span>
                      <p className="max-w-xs text-sm text-white/60">
                        Ask anything about this meeting — answers come straight from the transcript.
                      </p>
                      <div className="flex flex-wrap justify-center gap-2">
                        {QA_SUGGESTIONS.map((suggestion) => (
                          <button
                            key={suggestion}
                            type="button"
                            onClick={() => void handleAskQuestion(suggestion)}
                            className="rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-medium text-white/80 transition hover:border-white/25 hover:bg-white/10 hover:text-white"
                          >
                            {suggestion}
                          </button>
                        ))}
                      </div>
                    </div>
                  ) : (
                    qaMessages.map((message, index) => (
                      <div
                        key={`${message.role}-${index}`}
                        className={`max-w-[85%] rounded-xl px-3 py-2.5 text-sm leading-6 ${
                          message.role === 'user'
                            ? 'ml-auto bg-[rgba(124,108,246,0.2)] text-white'
                            : message.isError
                              ? 'border border-rose-500/20 bg-rose-500/10 text-rose-200'
                              : 'border border-white/10 bg-black/20 text-white/90'
                        }`}
                      >
                        {message.content}
                      </div>
                    ))
                  )}

                  {isAsking && (
                    <div className="flex w-fit items-center gap-1.5 rounded-xl border border-white/10 bg-black/20 px-3 py-3">
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60 [animation-delay:-0.3s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60 [animation-delay:-0.15s]" />
                      <span className="h-1.5 w-1.5 animate-bounce rounded-full bg-white/60" />
                    </div>
                  )}
                </div>

                <form
                  onSubmit={(event) => {
                    event.preventDefault();
                    void handleAskQuestion();
                  }}
                  className="flex gap-2 border-t border-white/10 p-3"
                >
                  <input
                    type="text"
                    value={qaInput}
                    onChange={(event) => setQaInput(event.target.value)}
                    placeholder="Ask about this meeting…"
                    maxLength={2000}
                    className="auth-input flex-1"
                    disabled={isAsking}
                  />
                  <button
                    type="submit"
                    disabled={isAsking || !qaInput.trim()}
                    className="btn btn-primary flex h-11 w-11 shrink-0 items-center justify-center px-0"
                    aria-label="Ask question"
                  >
                    <LuSend aria-hidden="true" />
                  </button>
                </form>
              </section>
            )}
          </div>
        )}

        <p className="mt-5 border-t border-white/10 pt-4 text-center text-xs text-white/50">
          Generated by Whisper + Llama 3.1 via Groq
        </p>
      </div>
    </div>
  );
}