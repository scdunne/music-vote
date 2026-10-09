import { useEffect } from 'react';
import { Navigate, NavLink, Route, Routes, useNavigate } from 'react-router-dom';
import { useAuth } from './auth';
import { isConfigured, supabase } from './supabase';
import { takeReturnRoute } from './spotify';
import Home from './pages/Home';
import Login from './pages/Login';
import RoundPage from './pages/RoundPage';
import History from './pages/History';
import Host from './pages/Host';

export default function App() {
  const { loading, session, isMember, profile } = useAuth();
  const navigate = useNavigate();

  // After the OAuth round trip, go back to wherever "Log in" / "Reconnect" was clicked.
  useEffect(() => {
    if (!session) return;
    const route = takeReturnRoute();
    if (route) navigate(route, { replace: true });
  }, [session, navigate]);

  if (!isConfigured) {
    return (
      <main className="container narrow">
        <h1>Music Vote</h1>
        <p className="error">
          Supabase isn't configured. Set <code>VITE_SUPABASE_URL</code> and <code>VITE_SUPABASE_ANON_KEY</code>.
        </p>
      </main>
    );
  }
  if (loading) return <main className="container narrow muted">Loading…</main>;
  if (!session) return <Login />;
  if (!isMember) {
    return (
      <main className="container narrow">
        <h1>Not on the list</h1>
        <p>
          You're signed in as <strong>{session.user.email}</strong>, but that email isn't a Music Vote member. Ask the host
          to add it.
        </p>
        <button onClick={() => supabase.auth.signOut()}>Log out</button>
      </main>
    );
  }

  return (
    <>
      <header className="topbar">
        <nav className="container topbar-inner">
          <NavLink to="/" className="brand" end>
            Music Vote
          </NavLink>
          <NavLink to="/history">History</NavLink>
          {profile?.is_host && <NavLink to="/host">Host</NavLink>}
          <span className="spacer" />
          {profile?.avatar_url && <img className="avatar" src={profile.avatar_url} alt="" />}
          <span className="muted hide-narrow">{profile?.display_name}</span>
          <button className="link" onClick={() => supabase.auth.signOut()}>
            Log out
          </button>
        </nav>
      </header>
      <main className="container">
        <Routes>
          <Route path="/" element={<Home />} />
          <Route path="/round/:id" element={<RoundPage />} />
          <Route path="/history" element={<History />} />
          <Route path="/host" element={profile?.is_host ? <Host /> : <Navigate to="/" replace />} />
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>
    </>
  );
}
