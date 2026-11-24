import { useState, type FormEvent } from 'react';
import { useAuth } from './AuthProvider';
import { Field, useAsync } from '../components/ui';
import { configProblem } from '../lib/supabase';

export function Brand() {
  return (
    <div className="brand">
      <div className="brand-mark" aria-hidden="true">N</div>
      <div>
        <div className="brand-name">Nerd</div>
        <div className="brand-sub">YOUR STUDY SPACE</div>
      </div>
    </div>
  );
}

/** Shown instead of the app when Supabase env vars are missing. We never fake a backend. */
export function SetupRequired() {
  const msg =
    configProblem === 'service-role'
      ? 'The key in VITE_SUPABASE_ANON_KEY is a service-role/secret key. That key must never be used in a browser. Replace it with the anon (publishable) key.'
      : configProblem === 'invalid-url'
        ? 'VITE_SUPABASE_URL does not look like a URL (it should start with https://).'
        : 'VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY are not set.';
  return (
    <div className="auth-wrap">
      <div className="card auth-card">
        <Brand />
        <h2 style={{ textAlign: 'center', marginBottom: 12 }}>Backend setup needed</h2>
        <p className="muted">{msg}</p>
        <p className="muted" style={{ marginTop: 10 }}>
          Nerd stores your data in your own Supabase project, so accounts and cross-device sync only work once it is connected. Nothing is simulated.
        </p>
        <ol className="muted" style={{ paddingLeft: 20, marginTop: 10 }}>
          <li>Follow <b>docs/SETUP.md</b> to create the project and run the SQL migration.</li>
          <li>Copy <code>.env.example</code> to <code>.env.local</code> (and add both variables in Netlify).</li>
          <li>Restart the dev server or redeploy.</li>
        </ol>
      </div>
    </div>
  );
}

type Mode = 'login' | 'register' | 'forgot';

export function AuthScreen() {
  const { signIn, signUp, requestPasswordReset } = useAuth();
  const [mode, setMode] = useState<Mode>('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [name, setName] = useState('');
  const [info, setInfo] = useState<string | null>(null);
  const { busy, error, run, setError } = useAsync();

  const switchMode = (m: Mode) => {
    setMode(m);
    setError(null);
    setInfo(null);
  };

  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      setInfo(null);
      if (mode === 'login') await signIn(email, password);
      else if (mode === 'register') {
        if (!name.trim()) throw new Error('Please choose a display name.');
        if (password.length < 8) throw new Error('Use at least 8 characters for your password.');
        if (password !== confirm) throw new Error('The two passwords do not match.');
        const { needsConfirmation } = await signUp(email, password, name);
        if (needsConfirmation) {
          setInfo('Account created. We sent a confirmation link to your email. Open it, then sign in here.');
          setMode('login');
          setPassword('');
          setConfirm('');
        }
      } else {
        await requestPasswordReset(email);
        setInfo('If that email has an account, a reset link is on its way.');
      }
    });
  };

  return (
    <div className="auth-wrap">
      <form className="card auth-card stack" onSubmit={submit} noValidate>
        <Brand />
        <h2 style={{ textAlign: 'center' }}>{mode === 'login' ? 'Welcome back' : mode === 'register' ? 'Create your study space' : 'Reset your password'}</h2>
        {mode === 'register' && (
          <Field label="Display name">{(id) => <input id={id} className="input" value={name} onChange={(e) => setName(e.target.value)} maxLength={60} autoComplete="nickname" required />}</Field>
        )}
        <Field label="Email">{(id) => <input id={id} className="input" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="email" required />}</Field>
        {mode !== 'forgot' && (
          <Field label="Password" hint={mode === 'register' ? 'At least 8 characters.' : undefined}>
            {(id) => <input id={id} className="input" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required />}
          </Field>
        )}
        {mode === 'register' && (
          <Field label="Confirm password">{(id) => <input id={id} className="input" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />}</Field>
        )}
        {error && <p className="error-text" role="alert">{error}</p>}
        {info && <p className="banner" role="status">{info}</p>}
        <button className="btn primary" type="submit" disabled={busy}>
          {busy ? 'Please wait…' : mode === 'login' ? 'Sign in' : mode === 'register' ? 'Create account' : 'Send reset link'}
        </button>
        <div className="row between small">
          {mode === 'login' ? (
            <>
              <button type="button" className="btn ghost sm" onClick={() => switchMode('forgot')}>Forgot password?</button>
              <button type="button" className="btn ghost sm" onClick={() => switchMode('register')}>Create account</button>
            </>
          ) : (
            <button type="button" className="btn ghost sm" onClick={() => switchMode('login')}>← Back to sign in</button>
          )}
        </div>
        <p className="hint" style={{ textAlign: 'center' }}>Your data is private to your account and syncs across your devices.</p>
      </form>
    </div>
  );
}

/** Opened from the password-recovery email link. */
export function RecoveryScreen() {
  const { setNewPassword } = useAuth();
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const { busy, error, run } = useAsync();
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void run(async () => {
      if (pw.length < 8) throw new Error('Use at least 8 characters.');
      if (pw !== pw2) throw new Error('The two passwords do not match.');
      await setNewPassword(pw);
    });
  };
  return (
    <div className="auth-wrap">
      <form className="card auth-card stack" onSubmit={submit}>
        <Brand />
        <h2 style={{ textAlign: 'center' }}>Choose a new password</h2>
        <Field label="New password">{(id) => <input id={id} className="input" type="password" value={pw} onChange={(e) => setPw(e.target.value)} autoComplete="new-password" required />}</Field>
        <Field label="Confirm new password">{(id) => <input id={id} className="input" type="password" value={pw2} onChange={(e) => setPw2(e.target.value)} autoComplete="new-password" required />}</Field>
        {error && <p className="error-text" role="alert">{error}</p>}
        <button className="btn primary" disabled={busy}>{busy ? 'Saving…' : 'Update password'}</button>
      </form>
    </div>
  );
}
