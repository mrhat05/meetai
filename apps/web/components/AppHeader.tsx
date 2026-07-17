'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { LuLayoutDashboard, LuCalendarClock, LuUsers, LuUser, LuLogOut, LuSparkles } from 'react-icons/lu';

const NAV_LINKS = [
  { href: '/dashboard', label: 'Home', Icon: LuLayoutDashboard },
  { href: '/meetings', label: 'Meetings', Icon: LuCalendarClock },
  { href: '/groups', label: 'Groups', Icon: LuUsers },
  { href: '/assistant', label: 'Assistant', Icon: LuSparkles },
];

export default function AppHeader() {
  const pathname = usePathname();
  const router = useRouter();

  const handleLogout = () => {
    window.localStorage.removeItem('accessToken');
    window.localStorage.removeItem('refreshToken');
    window.localStorage.removeItem('displayName');
    window.localStorage.removeItem('userName');
    window.localStorage.removeItem('userEmail');
    window.localStorage.removeItem('avatarUrl');
    router.push('/login');
  };

  return (
    <nav className="mb-8 flex items-center justify-between gap-4">
      <div className="flex items-center gap-5">
        <Link href="/dashboard" className="flex items-center gap-3">
          <span className="brand-mark text-lg">M</span>
          <span className="hidden font-display text-lg font-semibold tracking-tight sm:inline">MeetAI</span>
        </Link>

        <div className="flex items-center gap-1 rounded-full border border-[var(--border)] bg-white/[0.03] p-1">
          {NAV_LINKS.map(({ href, label, Icon }) => {
            const active = pathname === href || (href !== '/dashboard' && pathname.startsWith(href));
            return (
              <Link
                key={href}
                href={href}
                className={`inline-flex items-center gap-1.5 rounded-full px-3 py-1.5 text-sm font-medium transition ${
                  active ? 'bg-white/10 text-white shadow-sm' : 'text-[var(--muted)] hover:text-white'
                }`}
              >
                <Icon aria-hidden="true" className="text-base" />
                <span className="hidden sm:inline">{label}</span>
              </Link>
            );
          })}
        </div>
      </div>

      <div className="flex items-center gap-2">
        <Link href="/profile" className="btn btn-ghost" aria-label="Profile">
          <LuUser aria-hidden="true" className="text-base" />
          <span className="hidden md:inline">Profile</span>
        </Link>
        <button type="button" onClick={handleLogout} className="btn btn-ghost" aria-label="Log out">
          <LuLogOut aria-hidden="true" className="text-base" />
          <span className="hidden md:inline">Log out</span>
        </button>
      </div>
    </nav>
  );
}
