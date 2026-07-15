'use client';

import { useRouter, usePathname } from 'next/navigation';
import { LuArrowRight, LuX } from 'react-icons/lu';
import useGroupMeetingAlert from '@/hooks/useGroupMeetingAlert';

/**
 * App-wide "a group meeting just started" notification. Mounted once in the
 * root layout so a member sees the join prompt on any page — dashboard,
 * profile, another group, etc. — the moment an owner/admin starts a meeting.
 */
export default function GlobalMeetingAlert() {
  const router = useRouter();
  const pathname = usePathname();
  const { activeMeetingAlert, dismissAlert } = useGroupMeetingAlert();

  if (!activeMeetingAlert) {
    return null;
  }

  // Don't nag someone who is already inside that meeting's room.
  if (pathname === `/room/${activeMeetingAlert.roomCode}`) {
    return null;
  }

  const handleJoin = () => {
    const { roomCode } = activeMeetingAlert;
    dismissAlert();
    router.push(`/room/${roomCode}`);
  };

  return (
    <div className="animate-fade-up fixed right-4 top-4 z-[100] w-[min(22rem,calc(100vw-2rem))]">
      <div className="flex items-start gap-3 rounded-2xl border border-amber-300/30 bg-[rgba(28,19,4,0.92)] px-4 py-3.5 text-amber-50 shadow-2xl shadow-black/40 backdrop-blur-md">
        <span className="dot-live mt-1.5 shrink-0" style={{ background: 'var(--warning)' }} />
        <div className="min-w-0 flex-1">
          <p className="text-sm leading-5">
            <span className="font-semibold text-amber-100">{activeMeetingAlert.groupName}</span>{' '}
            <span className="text-amber-100/80">meeting is live</span>
          </p>
          <button
            type="button"
            onClick={handleJoin}
            className="mt-2.5 inline-flex items-center gap-2 rounded-xl bg-amber-50 px-3.5 py-1.5 text-sm font-semibold text-amber-950 shadow-sm transition hover:-translate-y-px hover:bg-white"
          >
            Join now <LuArrowRight aria-hidden="true" />
          </button>
        </div>
        <button
          type="button"
          onClick={dismissAlert}
          className="shrink-0 rounded-full p-1.5 text-amber-100 transition hover:bg-amber-300/20 hover:text-white"
          aria-label="Dismiss meeting alert"
        >
          <LuX aria-hidden="true" />
        </button>
      </div>
    </div>
  );
}
