import { useState } from 'react';
import type { FormEvent } from 'react';
import { jsonBody, request } from './api';

export default function Login({ onLogin }: { onLogin: (username: string) => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      const session = await request<{ username: string }>('/auth/login', jsonBody('POST', {
        username: fields.get('username'), password: fields.get('password'),
      }));
      onLogin(session.username);
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to sign in. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return <main className="login-page">
    <section className="panel report login-panel" aria-labelledby="login-heading">
      <span className="brand-icon" aria-hidden="true">b.</span>
      <p className="eyebrow">MINI BUG TRACKER</p>
      <h1 id="login-heading">Welcome back.</h1>
      <p className="muted">Sign in to report bugs and follow the QA flow.</p>
      {error && <p className="error" role="alert">{error}</p>}
      <form onSubmit={signIn}>
        <fieldset disabled={pending}>
          <label htmlFor="username">Username</label>
          <input id="username" name="username" autoComplete="username" required maxLength={80} />
          <label htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="current-password" required maxLength={200} />
          <button className="primary" type="submit">{pending ? 'Signing in…' : 'Sign in'}</button>
        </fieldset>
      </form>
      <p className="demo-note">Public demo: <strong>demo</strong> / <strong>bugtracker-demo</strong><br />Shared workspace — use sample data only.</p>
    </section>
  </main>;
}
