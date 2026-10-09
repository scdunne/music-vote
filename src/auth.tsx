import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import type { Session } from '@supabase/supabase-js';
import { supabase } from './supabase';
import { forgetToken, rememberProviderToken } from './spotify';
import type { Profile } from './types';

interface AuthState {
  loading: boolean;
  session: Session | null;
  profile: Profile | null;
  isMember: boolean;
}

const AuthContext = createContext<AuthState>({ loading: true, session: null, profile: null, isMember: false });

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null);
  const [sessionReady, setSessionReady] = useState(false);
  const [profile, setProfile] = useState<Profile | null>(null);
  const [isMember, setIsMember] = useState(false);
  const [profileLoading, setProfileLoading] = useState(false);

  useEffect(() => {
    // Don't call other Supabase methods inside this callback (it can deadlock);
    // profile loading happens in the effect below.
    const { data } = supabase.auth.onAuthStateChange((event, s) => {
      if (s?.provider_token) rememberProviderToken(s.provider_token);
      if (event === 'SIGNED_OUT') forgetToken();
      if (event === 'SIGNED_IN' && window.location.search) {
        // Strip "?code=..." left behind by the OAuth redirect.
        window.history.replaceState(null, '', window.location.pathname + window.location.hash);
      }
      setSession(s);
      setSessionReady(true);
    });
    return () => data.subscription.unsubscribe();
  }, []);

  const userId = session?.user.id;
  useEffect(() => {
    if (!session) {
      setProfile(null);
      setIsMember(false);
      return;
    }
    let cancelled = false;
    setProfileLoading(true);
    (async () => {
      const { data: member } = await supabase.rpc('is_member');
      if (!member) {
        if (!cancelled) {
          setIsMember(false);
          setProfileLoading(false);
        }
        return;
      }
      const meta = session.user.user_metadata ?? {};
      await supabase.from('profiles').upsert(
        {
          id: session.user.id,
          spotify_id: meta.provider_id ?? meta.sub ?? null,
          display_name: meta.full_name ?? meta.name ?? session.user.email ?? 'Member',
          avatar_url: meta.avatar_url ?? meta.picture ?? null,
        },
        { onConflict: 'id' },
      );
      const { data: row } = await supabase.from('profiles').select('*').eq('id', session.user.id).single();
      if (!cancelled) {
        setIsMember(true);
        setProfile(row as Profile | null);
        setProfileLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [userId]);

  return (
    <AuthContext.Provider value={{ loading: !sessionReady || profileLoading, session, profile, isMember }}>
      {children}
    </AuthContext.Provider>
  );
}
