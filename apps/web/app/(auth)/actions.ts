"use server";

import { cookies } from 'next/headers';

export async function setRefreshToken(refreshToken: string) {
  const cookieStore = await cookies();

  cookieStore.set('refreshToken', refreshToken, {
    httpOnly: true,
    sameSite: 'lax',
    secure: process.env.NODE_ENV === 'production',
    path: '/',
  });
}
