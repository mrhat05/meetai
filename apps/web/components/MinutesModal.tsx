'use client';

import { useEffect, useState } from 'react';
import ReactMarkdown from 'react-markdown';
import api from '@/lib/api';

type MinutesDetail = {
  id: string;
  title: string;
  created_at: string;
  duration_seconds: number;
  participant_count: number;
  summary_markdown: string;
  raw_transcript: string;
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

export default function MinutesModal({ isOpen, groupId, minutesId, onClose }: MinutesModalProps) {
  const [isLoading, setIsLoading] = useState(false);
  const [minutes, setMinutes] = useState<MinutesDetail | null>(null);
  const [activeTab, setActiveTab] = useState<'summary' | 'transcript'>('summary');
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!isOpen || !minutesId) return;

    let isMounted = true;

    const loadMinutes = async () => {
      try {
        setIsLoading(true);
        setError(null);
        setMinutes(null);
        setActiveTab('summary');

        const { data } = await api.get<MinutesDetail>(`/groups/${groupId}/minutes/${minutesId}`);
        if (isMounted) {
          setMinutes(data);
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

  if (!isOpen) return null;

  const handleDownloadMarkdown = () => {
    if (!minutes) return;

    const summaryMarkdown = minutes.summary_markdown || 'No summary available.';
    const content = [
      `# ${minutes.title}`,
      '',
      `Created: ${formatDate(minutes.created_at)}`,
      `Duration: ${formatMinutes(minutes.duration_seconds)}`,
      `Participants: ${minutes.participant_count}`,
      '',
      summaryMarkdown,
      '',
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
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/65 px-4 py-6" onClick={onClose}>
      <div
        className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-3xl border border-white/10 bg-slate-950 p-6 text-white shadow-2xl"
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
            ) : (
              <section className="rounded-2xl border border-white/10 bg-white/5 p-4">
                <div className="max-h-[55vh] overflow-auto rounded-xl border border-white/10 bg-black/20 p-4 font-mono text-[13px] leading-6 text-white/85 whitespace-pre-wrap">
                  {minutes.raw_transcript || 'No transcript available.'}
                </div>
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