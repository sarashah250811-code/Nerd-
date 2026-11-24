import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from 'react';
import type { Session, User } from '@supabase/supabase-js';
import { supabase } from '../lib/supabase';

type AuthStatus = 'loading' | 'signed-out' | 'signed-in';

interface AuthContextValue {
  status: AuthStatus;
  user: User | null;
  /** True after the user opened a password-recovery email link. */
  recovering: boolean;
  signUp(email: string, password: string, displayName: string): Promise<{ needsConfirmation: boolean }>;
  signIn(email: string, password: string): Promise<void>;
  signOut(): Promise<void>;
  requestPasswordReset(email: string): Promise<void>;
  setNewPassword(password: string): Promise<void>;
  changePassword(currentPassword: string, newPassword: string): Promise<void>;
  deleteAccount(currentPassword: string): Promise<void>;
}

const AuthContext = createContext<AuthContextValue | null>(null);

function friendly(message: string): string {
  if (/invalid login credentials/i.test(message)) return 'That email and password do not match.';
  if (/email not confirmed/i.test(message)) return 'Please confirm your email first. Check your inbox for the link.';
  if (/rate limit|too many/i.test(message)) return 'Too many attempts. Please wait a minute and try again.';
  if (/failed to fetch|network/i.test(message)) return 'Could not reach the server. Check your connection.';
  return message;
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [status, setStatus] = useState<AuthStatus>('loading');
  const [recovering, setRecovering] = useState(false);

  useEffect(() => {
    if (!supabase) return;
    let alive = true;
    supabase.auth
      .getSession()
      .then(({ data }) => {
        if (!alive) return;
        setSession(data.session);
        setStatus(data.session ? 'signed-in' : 'signed-out');
      })
      .catch(() => alive && setStatus('signed-out'));
    const { data: sub } = supabase.auth.onAuthStateChange((event, s) => {
      if (event === 'PASSWORD_RECOVERY') setRecovering(true);
      if (event === 'SIGNED_OUT') setRecovering(false);
      setSession(s);
      setStatus(s ? 'signed-in' : 'signed-out');
    });
    return () => {
      alive = false;
      sub.subscription.unsubscribe();
    };
  }, []);

  const need = () => {
    if (!supabase) throw new Error('Supabase is not configured.');
    return supabase;
  };

  const signUp: AuthContextValue['signUp'] = useCallback(async (email, password, displayName) => {
    const { data, error } = await need().auth.signUp({
      email: email.trim(),
      password,
      options: { data: { display_name: displayName.trim() }, emailRedirectTo: window.location.origin },
    });
    if (error) throw new Error(friendly(error.message));
    return { needsConfirmation: !data.session };
  }, []);

  const signIn: AuthContextValue['signIn'] = useCallback(async (email, password) => {
    const { error } = await need().auth.signInWithPassword({ email: email.trim(), password });
    if (error) throw new Error(friendly(error.message));
  }, []);

  const signOut = useCallback(async () => {
    await need().auth.signOut();
  }, []);

  const requestPasswordReset = useCallback(async (email: string) => {
    const { error } = await need().auth.resetPasswordForEmail(email.trim(), { redirectTo: window.location.origin });
    if (error) throw new Error(friendly(error.message));
  }, []);

  const setNewPassword = useCallback(async (password: string) => {
    const { error } = await need().auth.updateUser({ password });
    if (error) throw new Error(friendly(error.message));
    setRecovering(false);
  }, []);

  const reauth = useCallback(
    async (password: string) => {
      const email = session?.user.email;
      if (!email) throw new Error('No signed-in user.');
      const { error } = await need().auth.signInWithPassword({ email, password });
      if (error) throw new Error('Your current password is not correct.');
    },
    [session],
  );

  const changePassword = useCallback(
    async (currentPassword: string, newPassword: string) => {
      await reauth(currentPassword);
      const { error } = await need().auth.updateUser({ password: newPassword });
      if (error) throw new Error(friendly(error.message));
    },
    [reauth],
  );

  const deleteAccount = useCallback(
    async (currentPassword: string) => {
      await reauth(currentPassword);
      const { error } = await need().rpc('delete_my_account');
      if (error) throw new Error(friendly(error.message));
      await need().auth.signOut();
    },
    [reauth],
  );

  const value = useMemo<AuthContextValue>(
    () => ({
      status,
      user: session?.user ?? null,
      recovering,
      signUp,
      signIn,
      signOut,
      requestPasswordReset,
      setNewPassword,
      changePassword,
      deleteAccount,
    }),
    [status, session, recovering, signUp, signIn, signOut, requestPasswordReset, setNewPassword, changePassword, deleteAccount],
  );
  return <AuthContext.Provider value={value}>{children}</AuthContext.Provider>;
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside <AuthProvider>');
  return ctx;
}
