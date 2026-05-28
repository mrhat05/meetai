import type { Metadata } from 'next';
import AuthForm from '../auth-form';

export const metadata: Metadata = {
  title: 'Register | MeetAI',
};

export default function RegisterPage() {
  return <AuthForm mode="register" />;
}
