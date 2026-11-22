import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type Session } from '@supabase/supabase-js';
import './styles.css';

const supabaseUrl = (document.querySelector('meta[name="supabase-url"]') as HTMLMetaElement)?.content || '';
const publishableKey = (document.querySelector('meta[name="supabase-key"]') as HTMLMetaElement)?.content || '';
const supabase = supabaseUrl && publishableKey ? createClient(supabaseUrl, publishableKey) : null;

type CmsRecord = { id: string; record_type: string; record_key: string; publication_state: string; updated_at: string };

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [records, setRecords] = useState<CmsRecord[]>([]);
  const [summary, setSummary] = useState({ recordCount: 0, draftCount: 0, unpublishedChanges: 0, publicationCount: 0 });

  useEffect(() => {
    if (!supabase) return;
    supabase.auth.getSession().then(({ data }) => setSession(data.session));
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    return () => data.subscription.unsubscribe();
  }, []);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return setStatus('CMS configuration is pending.');
    setStatus('Sending sign-in link...');
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}` }
    });
    setStatus(error ? error.message : 'Check your email for the secure sign-in link.');
  }

  async function callAction(action: string, fields: Record<string, unknown> = {}) {
    if (!supabase || !session) throw new Error('Sign in required.');
    const functionUrl = `${supabaseUrl}/functions/v1/portfolio-cms`;
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action, ...fields })
    });
    const body = await response.json();
    if (!response.ok) throw new Error(body.error || 'CMS request failed.');
    return body;
  }

  useEffect(() => {
    if (!session) return;
    Promise.all([callAction('dashboard_summary'), callAction('list_records')])
      .then(([overview, listing]) => {
        setSummary(overview.summary);
        setRecords(listing.records || []);
      })
      .catch(error => setStatus(error.message));
  }, [session]);

  async function signOut() {
    await supabase?.auth.signOut();
    setRecords([]);
  }

  return (
    <main className="manage-shell">
      <aside className="manage-nav">
        <p className="brand">Fares Dkhili</p>
        <p className="eyebrow">Owner workspace</p>
        {session && <button type="button" onClick={signOut}>Sign out</button>}
      </aside>
      <section className="manage-content">
        {!session ? (
          <div className="login-card">
            <p className="eyebrow">Secure access</p>
            <h1>Owner<br /><em>workspace.</em></h1>
            <form onSubmit={signIn}>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} />
              <button type="submit">Send sign-in link</button>
            </form>
            <p role="status" aria-live="polite">{status}</p>
          </div>
        ) : (
          <>
            <header className="manage-header">
              <div><p className="eyebrow">Content overview</p><h1>Publishing<br /><em>atlas.</em></h1></div>
            </header>
            {status && <p className="manage-error" role="alert">{status}</p>}
            <div className="stats">
              <article><strong>{summary.recordCount}</strong><span>Records</span></article>
              <article><strong>{summary.draftCount}</strong><span>Drafts</span></article>
              <article><strong>{summary.unpublishedChanges}</strong><span>Unpublished changes</span></article>
              <article><strong>{summary.publicationCount}</strong><span>Publications</span></article>
            </div>
            <section className="record-panel">
              <h2>Content records</h2>
              {records.length ? <div className="record-list">{records.map(record => (
                <article key={record.id}>
                  <span className="mono">{record.record_type}</span>
                  <h3>{record.record_key}</h3>
                  <span className={`state ${record.publication_state}`}>{record.publication_state}</span>
                </article>
              ))}</div> : <p>No private CMS records are available yet.</p>}
            </section>
          </>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
