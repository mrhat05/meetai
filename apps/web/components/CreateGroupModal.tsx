'use client';

import { useEffect, useState } from 'react';
import { LuX } from 'react-icons/lu';
import api from '@/lib/api';

type CreateGroupModalProps = {
  open: boolean;
  onClose: () => void;
  onCreated: () => void | Promise<void>;
};

export default function CreateGroupModal({ open, onClose, onCreated }: CreateGroupModalProps) {
  const [groupName, setGroupName] = useState('');
  const [groupDescription, setGroupDescription] = useState('');
  const [groupError, setGroupError] = useState<string | null>(null);
  const [isCreatingGroup, setIsCreatingGroup] = useState(false);

  // Close on Escape (ignored while a create request is in flight).
  useEffect(() => {
    if (!open) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && !isCreatingGroup) {
        setGroupName('');
        setGroupDescription('');
        setGroupError(null);
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, isCreatingGroup, onClose]);

  if (!open) return null;

  const handleClose = () => {
    if (isCreatingGroup) return;
    setGroupName('');
    setGroupDescription('');
    setGroupError(null);
    onClose();
  };

  const handleCreateGroup = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();

    const normalizedName = groupName.trim();
    if (!normalizedName) {
      setGroupError('Group name is required');
      return;
    }

    try {
      setIsCreatingGroup(true);
      setGroupError(null);

      await api.post('/groups', {
        name: normalizedName,
        description: groupDescription.trim(),
      });

      await onCreated();
      setGroupName('');
      setGroupDescription('');
      onClose();
    } catch (createError: any) {
      console.error('Failed to create group:', createError);
      setGroupError(createError.response?.data?.error || 'Failed to create group');
    } finally {
      setIsCreatingGroup(false);
    }
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 px-4 py-6 backdrop-blur-md">
      <div role="dialog" aria-modal="true" aria-label="Create a new group" className="animate-pop-in card card-hero w-full max-w-lg p-6 md:p-7">
        <div className="flex items-start justify-between gap-4">
          <div>
            <h3 className="font-display text-2xl font-semibold tracking-tight">New group</h3>
            <p className="mt-2 text-sm muted">Create a group with a name and short description.</p>
          </div>
          <button
            type="button"
            onClick={handleClose}
            className="rounded-full p-2 text-white/70 transition hover:bg-white/10 hover:text-white"
            aria-label="Close create group modal"
          >
            <LuX aria-hidden="true" />
          </button>
        </div>

        <form onSubmit={handleCreateGroup} className="mt-6 space-y-4">
          <div>
            <label className="mb-2 block text-sm font-medium text-white/85" htmlFor="group-name">Name</label>
            <input
              id="group-name"
              type="text"
              value={groupName}
              onChange={(e) => setGroupName(e.target.value)}
              placeholder="Design team"
              maxLength={100}
              className="auth-input"
              autoFocus
            />
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium text-white/85" htmlFor="group-description">Description</label>
            <textarea
              id="group-description"
              value={groupDescription}
              onChange={(e) => setGroupDescription(e.target.value)}
              placeholder="Keep your team aligned on weekly meetings and project updates."
              rows={4}
              maxLength={500}
              className="auth-input resize-none"
            />
          </div>

          {groupError && (
            <div className="rounded-xl border border-rose-500/20 bg-rose-500/10 px-4 py-3 text-sm text-rose-200">
              {groupError}
            </div>
          )}

          <div className="flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
            <button type="button" onClick={handleClose} className="btn h-11">Cancel</button>
            <button type="submit" disabled={isCreatingGroup} className="btn btn-primary h-11">
              {isCreatingGroup ? 'Creating…' : 'Create group'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
