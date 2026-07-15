'use client';

import axios from 'axios';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { LuMail, LuCalendarDays, LuImage, LuCircleCheck, LuSave } from 'react-icons/lu';
import api from '@/lib/api';
import AppHeader from '@/components/AppHeader';

type ProfileUser = {
  id: string;
  email: string;
  displayName: string;
  avatarUrl: string | null;
  bio: string | null;
  phoneNumber: string | null;
  location: string | null;
  createdAt: string;
};

function formatDateTime(value: string) {
  return new Date(value).toLocaleString([], {
    dateStyle: 'medium',
    timeStyle: 'short',
  });
}

function readFileAsDataUrl(file: File) {
  return new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(new Error('Failed to read file'));
    reader.readAsDataURL(file);
  });
}

function loadImage(dataUrl: string) {
  return new Promise<HTMLImageElement>((resolve, reject) => {
    const image = new Image();
    image.onload = () => resolve(image);
    image.onerror = () => reject(new Error('Failed to load image'));
    image.src = dataUrl;
  });
}

async function compressAvatarToDataUrl(file: File) {
  const dataUrl = await readFileAsDataUrl(file);
  const image = await loadImage(dataUrl);

  const maxDimension = 512;
  const scale = Math.min(1, maxDimension / Math.max(image.width, image.height));
  const width = Math.max(1, Math.round(image.width * scale));
  const height = Math.max(1, Math.round(image.height * scale));

  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;

  const context = canvas.getContext('2d');
  if (!context) {
    throw new Error('Canvas is not available');
  }

  context.drawImage(image, 0, 0, width, height);
  return canvas.toDataURL('image/webp', 0.82);
}

export default function ProfilePage() {
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileUser | null>(null);
  const [profileLoading, setProfileLoading] = useState(true);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileNotice, setProfileNotice] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [avatarFileName, setAvatarFileName] = useState('');
  const [profileForm, setProfileForm] = useState({
    displayName: '',
    bio: '',
    phoneNumber: '',
    location: '',
    avatarUrl: '',
  });

  useEffect(() => {
    const loadProfile = async () => {
      const accessToken = window.localStorage.getItem('accessToken');
      if (!accessToken) {
        router.replace('/login');
        return;
      }

      try {
        setProfileLoading(true);
        const { data } = await api.get<{ user: ProfileUser }>('/auth/me');
        setProfile(data.user);
        setProfileForm({
          displayName: data.user.displayName ?? '',
          bio: data.user.bio ?? '',
          phoneNumber: data.user.phoneNumber ?? '',
          location: data.user.location ?? '',
          avatarUrl: data.user.avatarUrl ?? '',
        });

        if (data.user.avatarUrl) {
          window.localStorage.setItem('avatarUrl', data.user.avatarUrl);
        }
      } catch (profileLoadError) {
        console.error('Failed to load profile:', profileLoadError);
        setProfileError('Failed to load profile');
      } finally {
        setProfileLoading(false);
      }
    };

    void loadProfile();
  }, [router]);

  const handleAvatarUpload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    if (!file) return;

    if (!file.type.startsWith('image/')) {
      setProfileError('Please choose an image file.');
      return;
    }

    try {
      const dataUrl = await compressAvatarToDataUrl(file);
      setProfileForm((current) => ({ ...current, avatarUrl: dataUrl }));
      setAvatarFileName(file.name);
      setProfileNotice('Avatar optimized. Save the profile to apply it.');
      setProfileError(null);
    } catch (uploadError) {
      console.error('Failed to read avatar file:', uploadError);
      setProfileError('Could not read the selected image.');
    }
  };

  const handleSaveProfile = async () => {
    try {
      setProfileSaving(true);
      setProfileError(null);
      setProfileNotice(null);

      const { data } = await api.put<{ user: ProfileUser }>('/auth/me', {
        displayName: profileForm.displayName.trim(),
        bio: profileForm.bio.trim() || null,
        phoneNumber: profileForm.phoneNumber.trim() || null,
        location: profileForm.location.trim() || null,
        avatarUrl: profileForm.avatarUrl || null,
      });

      setProfile(data.user);
      setProfileForm({
        displayName: data.user.displayName ?? '',
        bio: data.user.bio ?? '',
        phoneNumber: data.user.phoneNumber ?? '',
        location: data.user.location ?? '',
        avatarUrl: data.user.avatarUrl ?? '',
      });

      window.localStorage.setItem('displayName', data.user.displayName);
      window.localStorage.setItem('userName', data.user.displayName);
      if (data.user.avatarUrl) {
        window.localStorage.setItem('avatarUrl', data.user.avatarUrl);
      }

      setProfileNotice('Profile saved successfully.');
    } catch (saveError: unknown) {
      console.error('Failed to save profile:', saveError);
      setProfileError(axios.isAxiosError(saveError) ? saveError.response?.data?.error ?? 'Failed to save profile' : 'Failed to save profile');
    } finally {
      setProfileSaving(false);
    }
  };

  return (
    <main className="min-h-screen app-root px-5 pb-16 pt-6 text-white sm:px-6">
      <div className="mx-auto max-w-5xl">
        <AppHeader />

        <header className="card card-hero animate-fade-up mb-8 flex flex-wrap items-center gap-6 p-7 md:p-9">
          <div className="flex h-24 w-24 shrink-0 items-center justify-center overflow-hidden rounded-3xl border border-[var(--border)] bg-white/5 font-display text-3xl font-semibold">
            {profileForm.avatarUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={profileForm.avatarUrl} alt="Profile avatar preview" className="h-full w-full object-cover" />
            ) : (
              <span className="gradient-text">{(profileForm.displayName || profile?.email || 'U').slice(0, 1).toUpperCase()}</span>
            )}
          </div>
          <div className="min-w-0">
            <p className="eyebrow">Profile</p>
            <h1 className="mt-3 truncate font-display text-3xl font-semibold tracking-tight sm:text-4xl">
              {profileLoading ? 'Your account' : (profileForm.displayName || profile?.email || 'Your account')}
            </h1>
            <p className="mt-2 text-base leading-7 muted">Update your display name, bio, contact details, and avatar.</p>
          </div>
        </header>

        <div className="grid gap-6 xl:grid-cols-[1.05fr_0.95fr]">
          <div className="card p-6 md:p-8">
            <div>
              <h2 className="font-display text-2xl font-semibold">Edit profile</h2>
              <p className="mt-1.5 muted">Change how you appear in meetings.</p>
            </div>

            <div className="mt-6 grid gap-4 md:grid-cols-2">
              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-medium muted">Display name</span>
                <input
                  type="text"
                  value={profileForm.displayName}
                  onChange={(event) => setProfileForm((current) => ({ ...current, displayName: event.target.value }))}
                  className="auth-input"
                />
              </label>

              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-medium muted">Bio</span>
                <textarea
                  value={profileForm.bio}
                  onChange={(event) => setProfileForm((current) => ({ ...current, bio: event.target.value }))}
                  rows={4}
                  className="auth-input resize-none"
                  placeholder="Tell people a little about yourself"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium muted">Phone number</span>
                <input
                  type="text"
                  value={profileForm.phoneNumber}
                  onChange={(event) => setProfileForm((current) => ({ ...current, phoneNumber: event.target.value }))}
                  className="auth-input"
                  placeholder="+1 555 123 4567"
                />
              </label>

              <label className="block">
                <span className="mb-2 block text-sm font-medium muted">Location</span>
                <input
                  type="text"
                  value={profileForm.location}
                  onChange={(event) => setProfileForm((current) => ({ ...current, location: event.target.value }))}
                  className="auth-input"
                  placeholder="City, Country"
                />
              </label>

              <label className="block md:col-span-2">
                <span className="mb-2 block text-sm font-medium muted">Profile photo</span>
                <input type="file" accept="image/*" onChange={handleAvatarUpload} className="auth-input py-2" />
                <p className="mt-2 text-xs muted">{avatarFileName || 'Choose an image to upload as your avatar.'}</p>
              </label>
            </div>

            <div className="mt-6 flex flex-wrap items-center gap-3">
              <button type="button" onClick={handleSaveProfile} disabled={profileSaving || profileLoading} className="btn btn-primary h-12">
                <LuSave aria-hidden="true" /> {profileSaving ? 'Saving…' : 'Save profile'}
              </button>
              {profileNotice && (
                <p className="inline-flex items-center gap-1.5 text-sm" style={{ color: 'var(--accent)' }}>
                  <LuCircleCheck aria-hidden="true" /> {profileNotice}
                </p>
              )}
              {profileError && <p className="text-sm text-rose-300">{profileError}</p>}
            </div>
          </div>

          <div className="card p-6 md:p-8">
            <h2 className="font-display text-2xl font-semibold">Account info</h2>
            <div className="mt-6 space-y-3 text-sm">
              <div className="flex items-start gap-3 rounded-2xl tile p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-white/5 text-[var(--accent)]">
                  <LuMail aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-faint">Email</p>
                  <p className="mt-0.5 truncate font-medium">{profile?.email || 'Loading…'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl tile p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-white/5 text-[var(--accent)]">
                  <LuCalendarDays aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-faint">Joined</p>
                  <p className="mt-0.5 font-medium">{profileLoading ? 'Loading…' : profile?.createdAt ? formatDateTime(profile.createdAt) : 'Unknown'}</p>
                </div>
              </div>
              <div className="flex items-start gap-3 rounded-2xl tile p-4">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl border border-[var(--border)] bg-white/5 text-[var(--accent)]">
                  <LuImage aria-hidden="true" />
                </span>
                <div className="min-w-0">
                  <p className="text-xs text-faint">Profile photo</p>
                  <p className="mt-0.5 font-medium">{profileForm.avatarUrl ? 'Uploaded' : 'No photo uploaded yet'}</p>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}