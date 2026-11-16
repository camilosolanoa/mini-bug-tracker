import { useState } from 'react';
import type { FormEvent } from 'react';
import { jsonBody, request } from './api';

export default function Login({ onLogin }: { onLogin: () => void }) {
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  async function signIn(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const fields = new FormData(event.currentTarget);
    setPending(true);
    setError('');
    try {
      await request('/auth/login', jsonBody('POST', {
        username: fields.get('username'), password: fields.get('password'),
      }));
      onLogin();
    } catch (error) {
      setError(error instanceof Error ? error.message : 'Unable to sign in. Please try again.');
    } finally {
      setPending(false);
    }
  }

  return <main className="login-page">
    <section className="panel" aria-labelledby="login-heading">
      <h1 id="login-heading">Mini Bug Tracker</h1>
      <p className="muted">Sign in to continue.</p>
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
      <p className="muted">Demo: <strong>demo</strong> / <strong>bugtracker-demo</strong><br />Shared workspace — use sample data only.</p>
    </section>
  </main>;
}
