'use client';

import { useEffect, useRef, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import type { IconType } from 'react-icons';
import ChatMarkdown from '@/components/ChatMarkdown';
import {
  LuSparkles,
  LuSend,
  LuListChecks,
  LuUser,
  LuClock,
  LuFileText,
  LuScrollText,
  LuDownload,
  LuX,
} from 'react-icons/lu';
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

// A meeting's minutes are reachable two ways: nested under a group (group
// meetings) or directly by room code (normal/standalone meetings). The modal
// is otherwise identical, so it takes a discriminated source and derives the
// three endpoints (detail / ask / action-item) from it.
export type MinutesSource =
  | { kind: 'group'; groupId: string; minutesId: string }
  | { kind: 'room'; roomCode: string };

type MinutesModalProps = {
  isOpen: boolean;
  source: MinutesSource | null;
  onClose: () => void;
};

function minutesEndpoints(source: MinutesSource) {
  if (source.kind === 'group') {
    const base = `/groups/${source.groupId}/minutes/${source.minutesId}`;
    return {
      detail: base,
      ask: `${base}/ask`,
      actionItem: (itemId: string) => `${base}/action-items/${itemId}`,
    };
  }
  const base = `/rooms/${source.roomCode}/minutes`;
  return {
    detail: base,
    ask: `${base}/ask`,
    actionItem: (itemId: string) => `${base}/action-items/${itemId}`,
  };
}

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

type MinutesTab = 'summary' | 'transcript' | 'tasks' | 'ask';

const TABS: { id: MinutesTab; label: string; Icon: IconType }[] = [
  { id: 'summary', label: 'Summary', Icon: LuFileText },
  { id: 'transcript', label: 'Transcript', Icon: LuScrollText },
  { id: 'tasks', label: 'Tasks', Icon: LuListChecks },
  { id: 'ask', label: 'Ask AI', Icon: LuSparkles },
];

export default function MinutesModal({ isOpen, source, onClose }: MinutesModalProps) {
  const endpoints = source ? minutesEndpoints(source) : null;
  const [isLoading, setIsLoading] = useState(false);
  const [minutes, setMinutes] = useState<MinutesDetail | null>(null);
  const [activeTab, setActiveTab] = useState<MinutesTab>('summary');
  const [error, setError] = useState<string | null>(null);
  const [qaMessages, setQaMessages] = useState<QaMessage[]>([]);
  const [qaInput, setQaInput] = useState('');
  const [isAsking, setIsAsking] = useState(false);
  const qaScrollRef = useRef<HTMLDivElement | null>(null);
  const panelRef = useRef<HTMLDivElement | null>(null);
  const closeButtonRef = useRef<HTMLButtonElement | null>(null);
  const tabRefs = useRef<Partial<Record<MinutesTab, HTMLButtonElement | null>>>({});
  const [actionItems, setActionItems] = useState<ActionItem[]>([]);
  const [togglingItemId, setTogglingItemId] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !endpoints) return;

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

        const { data } = await api.get<MinutesDetail>(endpoints.detail);
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
  }, [isOpen, endpoints?.detail]);

  // Lock the page behind the dialog so mobile swipe-scroll can't move it.
  useEffect(() => {
    if (!isOpen) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [isOpen]);

  // Move focus into the dialog on open and hand it back on close.
  useEffect(() => {
    if (!isOpen) return;

    const previouslyFocused = document.activeElement as HTMLElement | null;
    closeButtonRef.current?.focus();
    return () => {
      previouslyFocused?.focus?.();
    };
  }, [isOpen]);

  // Escape closes; Tab cycles inside the dialog instead of escaping to the page.
  useEffect(() => {
    if (!isOpen) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose();
        return;
      }

      if (event.key !== 'Tab' || !panelRef.current) return;

      const focusables = Array.from(
        panelRef.current.querySelectorAll<HTMLElement>(
          'button:not([disabled]), [href], input:not([disabled]), textarea:not([disabled]), select:not([disabled])'
        )
      ).filter((element) => element.tabIndex !== -1);

      if (focusables.length === 0) return;

      const first = focusables[0];
      const last = focusables[focusables.length - 1];
      const active = document.activeElement as HTMLElement | null;
      const isInside = active ? panelRef.current.contains(active) : false;

      if (event.shiftKey && (active === first || !isInside)) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && (active === last || !isInside)) {
        event.preventDefault();
        first.focus();
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [isOpen, onClose]);

  useEffect(() => {
    qaScrollRef.current?.scrollTo({ top: qaScrollRef.current.scrollHeight, behavior: 'smooth' });
  }, [qaMessages, isAsking]);

  if (!isOpen) return null;

  const handleAskQuestion = async (rawQuestion?: string) => {
    const question = (rawQuestion ?? qaInput).trim();
    if (!question || isAsking || !endpoints) return;

    const history = qaMessages
      .filter((message) => !message.isError)
      .slice(-8)
      .map(({ role, content }) => ({ role, content }));

    setQaMessages((current) => [...current, { role: 'user', content: question }]);
    setQaInput('');
    setIsAsking(true);

    try {
      const { data } = await api.post<{ answer: string }>(
        endpoints.ask,
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
    if (!endpoints || togglingItemId) return;

    const nextDone = !item.done;
    setTogglingItemId(item.id);
    // Optimistic update.
    setActionItems((current) => current.map((entry) => (entry.id === item.id ? { ...entry, done: nextDone } : entry)));

    try {
      const { data } = await api.patch<{ actionItems: ActionItem[] }>(
        endpoints.actionItem(item.id),
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

  const handleTabListKeyDown = (event: React.KeyboardEvent<HTMLDivElement>) => {
    const currentIndex = TABS.findIndex((tab) => tab.id === activeTab);
    let nextIndex: number | null = null;

    if (event.key === 'ArrowRight') nextIndex = (currentIndex + 1) % TABS.length;
    else if (event.key === 'ArrowLeft') nextIndex = (currentIndex - 1 + TABS.length) % TABS.length;
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = TABS.length - 1;

    if (nextIndex === null) return;

    event.preventDefault();
    const nextTab = TABS[nextIndex].id;
    setActiveTab(nextTab);
    tabRefs.current[nextTab]?.focus();
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

  const attribution = (
    <p className="mt-6 border-t border-white/10 pt-4 text-center text-xs text-white/50">
      Generated by Whisper + Llama 3.1 via Groq
    </p>
  );

  return (
    <div
      className="fixed inset-0 z-50 bg-black/65 backdrop-blur-md sm:flex sm:items-center sm:justify-center sm:px-4 sm:py-6"
      onClick={onClose}
    >
      {/* Full-screen sheet on phones (100dvh tracks the browser chrome); centered card on sm+. */}
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={minutes?.title || 'Meeting minutes'}
        className="animate-pop-in card card-hero flex w-full flex-col overflow-hidden text-white max-sm:h-screen max-sm:rounded-none! max-sm:supports-[height:100dvh]:h-[100dvh] sm:max-h-[88vh] sm:max-w-3xl"
        onClick={(event) => event.stopPropagation()}
      >
        <header className="flex shrink-0 items-start justify-between gap-3 border-b border-white/10 px-4 pb-3.5 pt-[max(1rem,env(safe-area-inset-top))] sm:px-6 sm:py-5">
          <div className="min-w-0 flex-1">
            <h3 className="truncate text-lg font-semibold sm:text-xl">{minutes?.title || 'Meeting minutes'}</h3>
            {minutes && (
              <p className="mt-1 truncate text-xs text-white/60 sm:text-sm">
                {formatDate(minutes.created_at)} · {formatMinutes(minutes.duration_seconds)} · {minutes.participant_count} participant{minutes.participant_count === 1 ? '' : 's'}
              </p>
            )}
          </div>

          <div className="flex shrink-0 items-center gap-2">
            <button
              type="button"
              onClick={handleDownloadMarkdown}
              disabled={!minutes}
              className="btn h-10 rounded-xl px-3 text-sm"
              aria-label="Download minutes as Markdown"
            >
              <LuDownload aria-hidden="true" className="text-base" />
              <span className="hidden sm:inline">Download .md</span>
            </button>
            <button
              ref={closeButtonRef}
              type="button"
              onClick={onClose}
              className="btn h-10 w-10 rounded-xl px-0 text-base"
              aria-label="Close minutes"
            >
              <LuX aria-hidden="true" />
            </button>
          </div>
        </header>

        <div className="shrink-0 border-b border-white/10 px-4 py-3 sm:px-6">
          <div className="-mx-1 overflow-x-auto px-1">
            <div
              role="tablist"
              aria-label="Minutes sections"
              onKeyDown={handleTabListKeyDown}
              className="inline-flex rounded-xl border border-white/10 bg-white/5 p-1"
            >
              {TABS.map(({ id, label, Icon }) => {
                const isActive = activeTab === id;
                return (
                  <button
                    key={id}
                    ref={(element) => {
                      tabRefs.current[id] = element;
                    }}
                    type="button"
                    role="tab"
                    id={`minutes-tab-${id}`}
                    aria-selected={isActive}
                    aria-controls={`minutes-panel-${id}`}
                    tabIndex={isActive ? 0 : -1}
                    onClick={() => setActiveTab(id)}
                    className={`inline-flex shrink-0 items-center gap-1.5 whitespace-nowrap rounded-lg px-3 py-2 text-sm font-medium transition sm:px-4 ${
                      isActive ? 'bg-white text-slate-900' : 'text-white/75 hover:text-white'
                    }`}
                  >
                    <Icon aria-hidden="true" /> {label}
                    {id === 'tasks' && openTaskCount > 0 && (
                      <span
                        className={`ml-0.5 inline-flex min-w-[1.25rem] items-center justify-center rounded-full px-1.5 py-0.5 text-[11px] font-semibold ${
                          isActive ? 'bg-slate-900 text-white' : 'bg-white/15 text-white'
                        }`}
                      >
                        {openTaskCount}
                      </span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        <div className="flex min-h-0 flex-1 flex-col">
          {isLoading ? (
            <div className="flex-1 space-y-3 overflow-y-auto p-4 sm:p-6" aria-busy="true">
              <span className="sr-only">Loading minutes…</span>
              <div className="skeleton h-4 w-2/3" />
              <div className="skeleton h-4 w-full" />
              <div className="skeleton h-4 w-5/6" />
              <div className="skeleton h-4 w-1/2" />
            </div>
          ) : error || !minutes ? (
            <div className="flex-1 overflow-y-auto p-4 sm:p-6">
              <p className="rounded-2xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
                {error || 'Unable to load minutes details.'}
              </p>
            </div>
          ) : activeTab === 'ask' ? (
            <section
              role="tabpanel"
              id="minutes-panel-ask"
              aria-labelledby="minutes-tab-ask"
              className="flex min-h-0 flex-1 flex-col"
            >
              <div
                ref={qaScrollRef}
                className="min-h-[14rem] flex-1 space-y-3 overflow-y-auto overscroll-contain p-4 sm:p-6"
              >
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
                      {message.role === 'assistant' && !message.isError ? (
                        <ChatMarkdown content={message.content} />
                      ) : (
                        message.content
                      )}
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
                className="flex shrink-0 gap-2 border-t border-white/10 p-3 pb-[calc(0.75rem+env(safe-area-inset-bottom))] sm:px-4 sm:pb-3"
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
          ) : (
            <div
              role="tabpanel"
              id={`minutes-panel-${activeTab}`}
              aria-labelledby={`minutes-tab-${activeTab}`}
              className="flex-1 overflow-y-auto overscroll-contain p-4 pb-[calc(1.25rem+env(safe-area-inset-bottom))] text-sm sm:p-6"
            >
              {activeTab === 'summary' ? (
                <section className="sm:rounded-2xl sm:border sm:border-white/10 sm:bg-white/5 sm:p-4">
                  {renderMarkdown(minutes.summary_markdown || 'No summary available.')}
                </section>
              ) : activeTab === 'transcript' ? (
                <div className="whitespace-pre-wrap break-words rounded-xl border border-white/10 bg-black/20 p-3.5 font-mono text-[13px] leading-6 text-white/85 sm:p-4">
                  {minutes.raw_transcript || 'No transcript available.'}
                </div>
              ) : (
                <section className="sm:rounded-2xl sm:border sm:border-white/10 sm:bg-white/5 sm:p-4">
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
              )}
              {attribution}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
