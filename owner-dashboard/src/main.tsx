import { StrictMode, useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { createClient, type Session } from '@supabase/supabase-js';
import './styles.css';

const supabaseUrl = (document.querySelector('meta[name="supabase-url"]') as HTMLMetaElement)?.content || '';
const publishableKey = (document.querySelector('meta[name="supabase-key"]') as HTMLMetaElement)?.content || '';
const supabase = supabaseUrl && publishableKey ? createClient(supabaseUrl, publishableKey) : null;

type CmsRecord = { id: string; record_type: string; record_key: string; publication_state: string; collection_order: number; updated_at: string };
type CmsVersion = { id: string; version_number: number; public_payload: Record<string, unknown>; editorial_metadata: Record<string, unknown>; change_summary: string; created_at: string };
type CmsRecordDetail = CmsRecord & { draft_version_id: string | null; versions: CmsVersion[] };
type InboxMessage = { id: string; created_at: string; sender_name: string; sender_email: string; subject: string; body: string; state: 'unread'|'read'|'archived' };
type CmsMedia = { id: string; object_path: string; published_object_path: string | null; original_name: string; content_type: string; size_bytes: number; upload_state: 'pending'|'ready'; alt_text: string; caption: string; record_id: string | null; created_at: string };
type AuditEvent = { id: number; actor_user_id: string; record_id: string | null; publication_id: string | null; action: string; version_id: string | null; outcome: 'success'|'failure'; created_at: string; entity_type: string; entity_id: string | null; metadata: Record<string, unknown> };
type Publication = { id: string; status: string; failure_code?: string | null; failureCode?: string | null; created_at?: string };
type CmsResponse = {
  summary?: { recordCount: number; draftCount: number; publicationCount: number };
  records?: CmsRecord[];
  record?: CmsRecordDetail | { id: string; versionId?: string; versionNumber?: number; publicationState?: string };
  events?: AuditEvent[];
  media?: CmsMedia[] | { id: string; publicUrl: string };
  upload?: { id: string; bucket: string; objectPath: string; token: string };
  url?: string;
  visibility?: 'public'|'private';
  ok?: boolean;
  publication?: Publication;
  baseline?: { inserted: number; skipped: number };
  error?: string;
  code?: string;
};
type CmsApiError = Error & { code?: string; publication?: Publication };
type DashboardView = 'overview'|'projects'|'experience'|'skills'|'credentials'|'articles'|'education'|'achievements'|'categories'|'profile'|'media'|'audit'|'inbox';
const viewRecordType: Partial<Record<DashboardView, string>> = {
  projects: 'project', experience: 'experience', skills: 'skill',
  credentials: 'credential', articles: 'article', education: 'education',
  achievements: 'achievement', categories: 'category', profile: 'profile'
};
const recordTypeView: Record<string, DashboardView> = {
  project: 'projects', experience: 'experience', skill: 'skills', credential: 'credentials',
  article: 'articles', education: 'education', achievement: 'achievements', category: 'categories',
  profile: 'profile'
};

function isRecordDetail(value: CmsRecordDetail | { id: string; versionId?: string; versionNumber?: number; publicationState?: string } | undefined): value is CmsRecordDetail {
  return Boolean(value && 'versions' in value && Array.isArray(value.versions));
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback;
}

function errorDetails(error: unknown): CmsApiError | null {
  return error instanceof Error ? error as CmsApiError : null;
}

function draftTemplate(type: string): Record<string, unknown> {
  const templates: Record<string, Record<string, unknown>> = {
    project: { title: '', summary: '', repositoryName: '', repository: '', statusLabel: '', category: '', kind: 'project', status: 'planned', technologies: [], evidence: [], notes: [], featured: false, caseStudy: false, visibility: 'draft' },
    experience: { title: '', company: '', period: '', year: '', summary: '', details: [], technologies: [] },
    skill: { title: '', category: '', evidenceType: 'project', evidenceNote: '', projects: [], experience: [] },
    credential: { title: '', issuer: '', type: '', date: '', verificationUrl: null },
    article: { title: '', summary: '', sections: [], visibility: 'draft' },
    education: { title: '', institution: '', period: '', department: '', specialization: '', major: '' },
    achievement: { title: '', organization: '', date: '', description: '' },
    category: { title: '', subtitle: '' },
    profile: { name: '', title: '', location: '', intro: '', about: '', github: '', linkedin: '', languages: [], affiliations: [] }
  };
  return templates[type] || templates.project;
}

function App() {
  const [session, setSession] = useState<Session | null>(null);
  const [email, setEmail] = useState('');
  const [status, setStatus] = useState('');
  const [authBusy, setAuthBusy] = useState(false);
  const [records, setRecords] = useState<CmsRecord[]>([]);
  const [summary, setSummary] = useState({ recordCount: 0, draftCount: 0, publicationCount: 0 });
  const [activeView, setActiveView] = useState<DashboardView>('overview');
  const [recordsStatus, setRecordsStatus] = useState<'loading'|'ready'|'error'>('loading');
  const [recordsNotice, setRecordsNotice] = useState('');
  const [recordBusy, setRecordBusy] = useState('');
  const [selectedRecord, setSelectedRecord] = useState<CmsRecordDetail | null>(null);
  const [recordKey, setRecordKey] = useState('');
  const [payloadText, setPayloadText] = useState('');
  const [editorialText, setEditorialText] = useState('{}');
  const [changeSummary, setChangeSummary] = useState('');
  const [recordDirty, setRecordDirty] = useState(false);
  const [baselineBusy, setBaselineBusy] = useState(false);
  const [aalLevel, setAalLevel] = useState<'loading'|'aal1'|'aal2'|'error'>('loading');
  const [verifiedTotpId, setVerifiedTotpId] = useState('');
  const [unverifiedTotpId, setUnverifiedTotpId] = useState('');
  const [totpEnrollment, setTotpEnrollment] = useState<{ id: string; qrCode: string; secret: string } | null>(null);
  const [mfaCode, setMfaCode] = useState('');
  const [mfaNotice, setMfaNotice] = useState('');
  const [mfaBusy, setMfaBusy] = useState(false);
  const [messages, setMessages] = useState<InboxMessage[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [inboxStatus, setInboxStatus] = useState<'loading'|'ready'|'error'>('loading');
  const [inboxNotice, setInboxNotice] = useState('');
  const [inboxBusy, setInboxBusy] = useState('');
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [auditStatus, setAuditStatus] = useState<'loading'|'ready'|'error'>('loading');
  const [auditNotice, setAuditNotice] = useState('');
  const [mediaAssets, setMediaAssets] = useState<CmsMedia[]>([]);
  const [mediaStatus, setMediaStatus] = useState<'loading'|'ready'|'error'>('loading');
  const [mediaNotice, setMediaNotice] = useState('');
  const [mediaBusy, setMediaBusy] = useState('');
  const [uploadFile, setUploadFile] = useState<File | null>(null);
  const [mediaPreview, setMediaPreview] = useState<{ id: string; url: string; visibility: 'public'|'private' } | null>(null);
  const [mediaPreviewExpired, setMediaPreviewExpired] = useState(false);
  const [mediaPublicUrl, setMediaPublicUrl] = useState('');

  useEffect(() => {
    if (!supabase) return;
    const { data } = supabase.auth.onAuthStateChange((_event, next) => setSession(next));
    supabase.auth.getSession().then(({ data: sessionData, error }) => {
      if (error) throw error;
      setSession(sessionData.session);
    }).catch(error => {
      setStatus(error instanceof Error ? error.message : 'Could not restore the sign-in session.');
    });
    return () => data.subscription.unsubscribe();
  }, []);

  useEffect(() => {
    if (session) return;
    setRecords([]);
    setSelectedRecord(null);
    setPayloadText('');
    setEditorialText('{}');
    setRecordDirty(false);
    setMessages([]);
    setUnreadCount(0);
    setAuditEvents([]);
    setMediaAssets([]);
    setMediaPreview(null);
    setMediaPreviewExpired(false);
    setMediaPublicUrl('');
    setSummary({ recordCount: 0, draftCount: 0, publicationCount: 0 });
    setVerifiedTotpId('');
    setUnverifiedTotpId('');
    setTotpEnrollment(null);
    setMfaCode('');
    setMfaNotice('');
    setAalLevel('loading');
  }, [session]);

  useEffect(() => {
    if (!recordDirty) return;
    const warnBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = '';
    };
    window.addEventListener('beforeunload', warnBeforeUnload);
    return () => window.removeEventListener('beforeunload', warnBeforeUnload);
  }, [recordDirty]);

  async function signIn(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return setStatus('CMS configuration is pending.');
    setAuthBusy(true);
    setStatus('Sending sign-in link...');
    try {
      const { error } = await supabase.auth.signInWithOtp({
        email,
        options: { emailRedirectTo: `${window.location.origin}${window.location.pathname}`, shouldCreateUser: false }
      });
      if (error) throw error;
      setStatus('Check your email for the secure sign-in link.');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not send the sign-in link.');
    } finally {
      setAuthBusy(false);
    }
  }

  async function recoverAuthentication(statusCode: number, code?: string) {
    if (statusCode === 401 && ['AUTH_REQUIRED','INVALID_TOKEN'].includes(code || '')) {
      const hadUnsavedChanges = recordDirty;
      setSession(null);
      setStatus(hadUnsavedChanges
        ? 'Your sign-in session expired; unsaved editor changes were discarded. Sign in again to continue.'
        : 'Your sign-in session expired. Sign in again to continue.');
      setVerifiedTotpId('');
      setAalLevel('loading');
      if (supabase) {
        try {
          const { error } = await supabase.auth.signOut({ scope: 'local' });
          if (error) setStatus('Your session expired. Sign in again; local session cleanup also reported an error.');
        } catch {
          setStatus('Your session expired. Sign in again; local session cleanup could not be confirmed.');
        }
      }
    } else if (statusCode === 403 && code === 'MFA_REQUIRED') {
      await refreshMfa();
      setMfaNotice('Multi-factor assurance is no longer valid for this action. Verify your TOTP code again.');
    }
  }

  async function callAction(action: string, fields: Record<string, unknown> = {}): Promise<CmsResponse> {
    if (!supabase || !session) throw new Error('Sign in required.');
    const functionUrl = `${supabaseUrl}/functions/v1/portfolio-cms`;
    const response = await fetch(functionUrl, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.access_token}` },
      body: JSON.stringify({ action, ...fields })
    });
    let result: CmsResponse = {};
    try {
      const body: unknown = await response.json();
      if (body && typeof body === 'object' && !Array.isArray(body)) result = body as CmsResponse;
    } catch {}
    if (!response.ok) {
      await recoverAuthentication(response.status, result.code);
      const error = new Error(result.error || 'CMS request failed.') as CmsApiError;
      error.code = result.code;
      error.publication = result.publication;
      throw error;
    }
    return result;
  }

  async function callInbox(method: 'GET'|'POST', fields?: { id: string; state: InboxMessage['state'] }) {
    if (!session) throw new Error('Sign in required.');
    const response = await fetch(`${supabaseUrl}/functions/v1/owner-messages`, {
      method,
      headers: {
        Accept: 'application/json',
        Authorization: `Bearer ${session.access_token}`,
        ...(fields ? { 'Content-Type': 'application/json' } : {})
      },
      ...(fields ? { body: JSON.stringify(fields) } : {})
    });
    let result: { error?: string; code?: string; messages?: InboxMessage[]; unreadCount?: number; ok?: boolean } | null = null;
    try { result = await response.json(); } catch {}
    if (!response.ok) {
      await recoverAuthentication(response.status, result?.code);
      throw new Error(result?.error || 'Inbox request failed.');
    }
    return result;
  }

  async function refreshRecords(recordType?: string) {
    setRecordsStatus('loading');
    setRecordsNotice('');
    try {
      const result = await callAction('list_records', recordType ? { recordType } : {});
      if (!Array.isArray(result.records)) throw new Error('CMS returned an invalid record list.');
      setRecords(result.records);
      setRecordsStatus('ready');
    } catch (error) {
      setRecordsStatus('error');
      setRecordsNotice(errorMessage(error, 'Could not load content records.'));
    }
  }

  async function moveRecord(index: number, direction: -1 | 1) {
    const recordType = viewRecordType[activeView];
    const targetIndex = index + direction;
    if (!recordType || targetIndex < 0 || targetIndex >= records.length) return;
    if (recordDirty) return setRecordsNotice('Save or discard the current draft before changing collection order.');
    if (!aal2Ready()) return setRecordsNotice('Verify TOTP at aal2 before changing collection order.');

    const orderedRecords = [...records];
    [orderedRecords[index], orderedRecords[targetIndex]] = [orderedRecords[targetIndex], orderedRecords[index]];
    setRecordBusy('reorder');
    setRecordsNotice('Saving collection order…');
    try {
      await callAction('reorder_records', {
        recordType,
        expectedRecordIds: records.map(record => record.id),
        recordIds: orderedRecords.map(record => record.id)
      });
      await refreshRecords(recordType);
      await refreshAudit();
      setRecordsNotice('Collection order saved in the CMS. The public site was not changed.');
    } catch (error) {
      if (errorDetails(error)?.code === 'CMS_CONFLICT') {
        await refreshRecords(recordType);
      }
      setRecordsNotice(errorMessage(error, 'Collection order could not be saved.'));
    } finally {
      setRecordBusy('');
    }
  }

  async function refreshAudit() {
    setAuditStatus('loading');
    setAuditNotice('');
    try {
      const result = await callAction('list_audit');
      if (!Array.isArray(result.events)) throw new Error('CMS returned invalid audit history.');
      setAuditEvents(result.events);
      setAuditStatus('ready');
    } catch (error) {
      setAuditStatus('error');
      setAuditNotice(errorMessage(error, 'Could not load audit history.'));
    }
  }

  async function refreshMedia() {
    setMediaStatus('loading');
    setMediaNotice('');
    try {
      const result = await callAction('list_media');
      if (!Array.isArray(result.media)) throw new Error('CMS returned an invalid media list.');
      setMediaAssets(result.media);
      setMediaStatus('ready');
    } catch (error) {
      setMediaStatus('error');
      setMediaNotice(errorMessage(error, 'Could not load media.'));
    }
  }

  async function importPublicBaseline() {
    if (!aal2Ready()) return setRecordsNotice('Verify TOTP at aal2 before importing the public baseline.');
    if (!window.confirm('Import currently public portfolio content as the initial CMS baseline? This does not change the public site.')) return;
    setBaselineBusy(true);
    setRecordsNotice('');
    let imported: { inserted: number; skipped: number } | null = null;
    try {
      const { publicBaseline } = await import('./public-baseline.generated');
      const result = await callAction('seed_public_baseline', { records: publicBaseline });
      if (!result.baseline) throw new Error('CMS did not confirm the baseline import.');
      imported = result.baseline;
      await refreshRecords(undefined);
      const refreshed = await callAction('dashboard_summary');
      if (!refreshed.summary) throw new Error('CMS returned an invalid dashboard summary.');
      setSummary(refreshed.summary);
      await refreshAudit();
      setRecordsNotice(`Baseline imported: ${imported.inserted} added, ${imported.skipped} already present. The public site was not changed.`);
    } catch (error) {
      setRecordsNotice(imported
        ? `Baseline imported (${imported.inserted} added, ${imported.skipped} already present), but dashboard refresh failed: ${errorMessage(error, 'refresh failed.')}`
        : errorMessage(error, 'Public baseline could not be imported.'));
    } finally {
      setBaselineBusy(false);
    }
  }

  async function openView(view: DashboardView) {
    if (recordDirty && !window.confirm('Discard the unsaved draft changes?')) return;
    setActiveView(view);
    setSelectedRecord(null);
    setRecordDirty(false);
    setRecordsNotice('');
    if (view === 'overview' || viewRecordType[view]) await refreshRecords(viewRecordType[view]);
    if (view === 'audit') await refreshAudit();
    if (view === 'media') await refreshMedia();
    if (view === 'inbox') await refreshInbox();
  }

  async function openRecord(record: CmsRecord, discardConfirmed = false) {
    if (recordDirty && !discardConfirmed && !window.confirm('Discard the unsaved draft changes?')) return;
    setRecordBusy(record.id);
    setRecordsNotice('');
    try {
      const result = await callAction('get_record', { id: record.id });
      if (!isRecordDetail(result.record)) throw new Error('CMS returned an invalid record.');
      const detail = result.record;
      const draft = detail.versions.find(version => version.id === detail.draft_version_id) || detail.versions[0];
      setSelectedRecord(detail);
      setRecordKey(detail.record_key);
      setPayloadText(JSON.stringify(draft?.public_payload || draftTemplate(detail.record_type), null, 2));
      setEditorialText(JSON.stringify(draft?.editorial_metadata || {}, null, 2));
      setChangeSummary('');
      setRecordDirty(false);
    } catch (error) {
      setRecordsNotice(errorMessage(error, 'Could not load this content record.'));
    } finally {
      setRecordBusy('');
    }
  }

  async function openRecordFromOverview(record: CmsRecord) {
    if (recordDirty && !window.confirm('Discard the unsaved draft changes?')) return;
    const view = recordTypeView[record.record_type] || 'overview';
    setActiveView(view);
    setSelectedRecord(null);
    setRecordDirty(false);
    if (view !== 'overview') await refreshRecords(record.record_type);
    await openRecord(record, true);
  }

  function createDraft() {
    if (recordDirty && !window.confirm('Discard the unsaved draft changes?')) return;
    const type = viewRecordType[activeView];
    if (!type) return;
    setSelectedRecord(null);
    setRecordKey('');
    setPayloadText(JSON.stringify(draftTemplate(type), null, 2));
    setEditorialText('{}');
    setChangeSummary('');
    setRecordDirty(true);
    setRecordsNotice('New draft. It remains private until a separate, successful publication.');
  }

  async function saveDraft(event: React.FormEvent) {
    event.preventDefault();
    if (!aal2Ready()) {
      setRecordsNotice('Verify TOTP at aal2 before saving a draft.');
      return;
    }
    const recordType = viewRecordType[activeView];
    if (!recordType) return;
    setRecordBusy('save');
    setRecordsNotice('');
    let saveConfirmed = false;
    let successMessage = '';
    try {
      const publicPayload: unknown = JSON.parse(payloadText);
      const editorialMetadata: unknown = JSON.parse(editorialText);
      if (!publicPayload || typeof publicPayload !== 'object' || Array.isArray(publicPayload)
        || !editorialMetadata || typeof editorialMetadata !== 'object' || Array.isArray(editorialMetadata)) {
        throw new Error('Content and editorial metadata must each be JSON objects.');
      }
      const result = await callAction('save_draft', {
        recordType, recordKey, expectedVersionId: selectedRecord?.draft_version_id || null,
        publicPayload, editorialMetadata, changeSummary
      });
      const saved = result.record;
      if (!saved || typeof saved.id !== 'string') throw new Error('CMS did not confirm the saved draft.');
      saveConfirmed = true;
      successMessage = `Private draft saved${'versionNumber' in saved ? ` as version ${saved.versionNumber}` : ''}.`;
      setRecordDirty(false);
      await refreshRecords(recordType);
      try {
        const refreshed = await callAction('get_record', { id: saved.id });
        const detail = refreshed.record;
        if (!isRecordDetail(detail)) throw new Error('Record history was not returned.');
        setSelectedRecord(detail);
        const draft = detail.versions.find(version => version.id === detail.draft_version_id);
        if (draft) {
          setPayloadText(JSON.stringify(draft.public_payload, null, 2));
          setEditorialText(JSON.stringify(draft.editorial_metadata || {}, null, 2));
        }
      } catch {
        setRecordsNotice('Draft was saved, but its version history could not be refreshed.');
        return;
      }
      setRecordsNotice(successMessage);
    } catch (error) {
      setRecordsNotice(saveConfirmed
        ? `Draft was saved, but the dashboard could not refresh: ${errorMessage(error, 'refresh failed.')}`
        : errorMessage(error, 'Draft could not be saved.'));
    } finally {
      setRecordBusy('');
    }
  }

  async function archiveRecord() {
    if (!selectedRecord) return;
    if (recordDirty && !window.confirm('Discard unsaved changes and archive this record in the CMS? The public site will not change.')) return;
    if (!window.confirm('Archive this record in the CMS? It will not be deleted or removed from the public site.')) return;
    if (!aal2Ready()) return setRecordsNotice('Verify TOTP at aal2 before archiving.');
    setRecordBusy('archive');
    setRecordsNotice('');
    try {
      await callAction('archive_record', { id: selectedRecord.id });
      setSelectedRecord(null);
      setRecordDirty(false);
      await refreshRecords(viewRecordType[activeView]);
      await refreshAudit();
      setRecordsNotice('Record archived in the CMS. The public site was not changed.');
    } catch (error) {
      setRecordsNotice(errorMessage(error, 'Record could not be archived.'));
    } finally {
      setRecordBusy('');
    }
  }

  async function restoreVersion(versionId: string) {
    if (!selectedRecord) return;
    if (recordDirty && !window.confirm('Discard unsaved changes and restore this version?')) return;
    if (!window.confirm('Restore this version as a new draft version?')) return;
    if (!aal2Ready()) return setRecordsNotice('Verify TOTP at aal2 before restoring a version.');
    setRecordBusy(`restore-${versionId}`);
    setRecordsNotice('');
    try {
      await callAction('restore_version', { id: selectedRecord.id, versionId });
      setRecordDirty(false);
      await openRecord(selectedRecord, true);
      await refreshRecords(viewRecordType[activeView]);
      await refreshAudit();
      setRecordsNotice('A new draft version was created from the selected version.');
    } catch (error) {
      setRecordsNotice(errorMessage(error, 'Version could not be restored.'));
    } finally {
      setRecordBusy('');
    }
  }

  async function requestPublication() {
    if (recordDirty) return setRecordsNotice('Save or discard your unsaved changes before requesting publication.');
    if (!selectedRecord?.draft_version_id || !window.confirm('Request publication for this draft? This will not publish unless a configured publishing service succeeds.')) return;
    if (!aal2Ready()) return setRecordsNotice('Verify TOTP at aal2 before requesting publication.');
    setRecordBusy('publish');
    setRecordsNotice('');
    try {
      await callAction('request_publication', {
        id: selectedRecord.id,
        versionId: selectedRecord.draft_version_id,
        approval: true,
        idempotencyKey: crypto.randomUUID()
      });
      setRecordsNotice('Publication service returned without a success result.');
    } catch (error) {
      const details = errorDetails(error);
      const attempt = details?.publication;
      setRecordsNotice(attempt
        ? `${errorMessage(error, 'Publication failed.')} Attempt ${attempt.id}: ${attempt.status} (${attempt.failure_code || attempt.failureCode || 'no failure code'}).`
        : errorMessage(error, 'Publication request failed.'));
      await callAction('dashboard_summary').then(result => {
        if (result.summary) setSummary(result.summary);
      }).catch(error => setStatus(errorMessage(error, 'Could not refresh dashboard counts.')));
      await refreshAudit();
    } finally {
      setRecordBusy('');
    }
  }

  async function uploadMedia(event: React.FormEvent) {
    event.preventDefault();
    if (!uploadFile) return setMediaNotice('Choose an image to upload.');
    if (!aal2Ready()) return setMediaNotice('Verify TOTP at aal2 before uploading media.');
    setMediaBusy('upload');
    setMediaNotice('');
    let mediaId = '';
    try {
      const request = await callAction('request_media_upload', {
        fileName: uploadFile.name,
        contentType: uploadFile.type,
        size: uploadFile.size
      });
      if (!request.upload || !supabase) throw new Error('CMS did not provide a private upload token.');
      mediaId = request.upload.id;
      const { error } = await supabase.storage.from(request.upload.bucket)
        .uploadToSignedUrl(request.upload.objectPath, request.upload.token, uploadFile, {
          contentType: uploadFile.type, upsert: false
        });
      if (error) throw error;
      await callAction('complete_media_upload', { mediaId: request.upload.id });
      setUploadFile(null);
      await refreshMedia();
      await refreshAudit();
      setMediaNotice('Private media uploaded and verified.');
    } catch (error) {
      if (mediaId) {
        await refreshMedia();
        setMediaNotice(`Upload did not complete verification: ${errorMessage(error, 'media upload failed.')}. Use Verify pending upload or Remove staged to recover the private item.`);
      } else {
        setMediaNotice(errorMessage(error, 'Media upload failed.'));
      }
    } finally {
      setMediaBusy('');
    }
  }

  async function verifyPendingMedia(asset: CmsMedia) {
    if (!aal2Ready()) return setMediaNotice('Verify TOTP at aal2 before verifying an upload.');
    setMediaBusy(asset.id);
    setMediaNotice('');
    try {
      await callAction('complete_media_upload', { mediaId: asset.id });
      await refreshMedia();
      await refreshAudit();
      setMediaNotice('Private media upload verified.');
    } catch (error) {
      setMediaNotice(errorMessage(error, 'Media upload could not be verified.'));
    } finally {
      setMediaBusy('');
    }
  }

  async function previewMedia(asset: CmsMedia) {
    setMediaBusy(asset.id);
    setMediaNotice('');
    try {
      const result = await callAction('get_media_preview', { mediaId: asset.id });
      if (!result.url || (result.visibility !== 'private' && result.visibility !== 'public')) {
        throw new Error('CMS returned an invalid media preview.');
      }
      setMediaPreview({ id: asset.id, url: result.url, visibility: result.visibility });
      setMediaPreviewExpired(false);
    } catch (error) {
      setMediaNotice(errorMessage(error, 'Media preview is unavailable.'));
    } finally {
      setMediaBusy('');
    }
  }

  async function updateMedia(event: React.FormEvent<HTMLFormElement>, asset: CmsMedia) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const recordId = String(form.get('recordId') || '').trim();
    setMediaBusy(asset.id);
    setMediaNotice('');
    try {
      await callAction('update_media_metadata', {
        mediaId: asset.id,
        altText: String(form.get('altText') || ''),
        caption: String(form.get('caption') || ''),
        recordId: recordId || null
      });
      await refreshMedia();
      await refreshAudit();
      setMediaNotice('Media metadata saved.');
    } catch (error) {
      setMediaNotice(errorMessage(error, 'Media metadata could not be saved.'));
    } finally {
      setMediaBusy('');
    }
  }

  async function approveMedia(asset: CmsMedia) {
    if (!window.confirm('Copy this private asset to the public-read media bucket? Only do this for content approved for public use.')) return;
    if (!aal2Ready()) return setMediaNotice('Verify TOTP at aal2 before approving public media.');
    setMediaBusy(asset.id);
    setMediaNotice('');
    try {
      const result = await callAction('approve_media', { mediaId: asset.id });
      if (result.media && !Array.isArray(result.media) && 'publicUrl' in result.media) {
        setMediaPublicUrl(result.media.publicUrl);
      }
      await refreshMedia();
      await refreshAudit();
      setMediaNotice('Media approved and copied to the public bucket.');
    } catch (error) {
      setMediaNotice(errorMessage(error, 'Media could not be approved.'));
    } finally {
      setMediaBusy('');
    }
  }

  async function removeMedia(asset: CmsMedia) {
    if (!window.confirm('Remove this unapproved private media item?')) return;
    if (!aal2Ready()) return setMediaNotice('Verify TOTP at aal2 before removing media.');
    setMediaBusy(asset.id);
    setMediaNotice('');
    try {
      await callAction('remove_staged_media', { mediaId: asset.id });
      if (mediaPreview?.id === asset.id) {
        setMediaPreview(null);
        setMediaPreviewExpired(false);
      }
      await refreshMedia();
      await refreshAudit();
      setMediaNotice('Private media removed.');
    } catch (error) {
      setMediaNotice(errorMessage(error, 'Media could not be removed.'));
    } finally {
      setMediaBusy('');
    }
  }

  function aal2Ready() {
    return aalLevel === 'aal2' && Boolean(verifiedTotpId);
  }

  async function refreshMfa() {
    if (!supabase || !session) return;
    setAalLevel('loading');
    try {
      const [factorResult, assuranceResult] = await Promise.all([
        supabase.auth.mfa.listFactors(),
        supabase.auth.mfa.getAuthenticatorAssuranceLevel()
      ]);
      if (factorResult.error) throw factorResult.error;
      if (assuranceResult.error) throw assuranceResult.error;
      const verified = factorResult.data.all
        .find(factor => factor.factor_type === 'totp' && factor.status === 'verified')?.id || '';
      const unverified = factorResult.data.all.find(factor => factor.factor_type === 'totp' && factor.status === 'unverified')?.id || '';
      setVerifiedTotpId(verified);
      setUnverifiedTotpId(unverified);
      setAalLevel(assuranceResult.data.currentLevel === 'aal2' ? 'aal2' : 'aal1');
    } catch (error) {
      setAalLevel('error');
      setMfaNotice(error instanceof Error ? error.message : 'Could not load multi-factor status.');
    }
  }

  async function enrollTotp() {
    if (!supabase) return;
    setMfaBusy(true);
    setMfaNotice('');
    try {
      const { data, error } = await supabase.auth.mfa.enroll({
        factorType: 'totp',
        friendlyName: 'Portfolio owner authenticator'
      });
      if (error) throw error;
      setTotpEnrollment({ id: data.id, qrCode: data.totp.qr_code, secret: data.totp.secret });
      setUnverifiedTotpId(data.id);
      setMfaNotice('Scan the QR code with your authenticator app, then verify a current six-digit code.');
    } catch (error) {
      setMfaNotice(error instanceof Error ? error.message : 'Could not start TOTP enrollment.');
    } finally {
      setMfaBusy(false);
    }
  }

  async function removeIncompleteTotp() {
    if (!supabase || !unverifiedTotpId) return;
    setMfaBusy(true);
    setMfaNotice('');
    try {
      const { error } = await supabase.auth.mfa.unenroll({ factorId: unverifiedTotpId });
      if (error) throw error;
      setUnverifiedTotpId('');
      setTotpEnrollment(null);
      setMfaNotice('Incomplete TOTP enrollment removed.');
    } catch (error) {
      setMfaNotice(error instanceof Error ? error.message : 'Could not remove incomplete enrollment.');
    } finally {
      setMfaBusy(false);
    }
  }

  async function verifyTotp(event: React.FormEvent) {
    event.preventDefault();
    if (!supabase) return;
    const factorId = totpEnrollment?.id || verifiedTotpId;
    if (!factorId) {
      setMfaNotice('Enroll a TOTP authenticator before verifying a code.');
      return;
    }
    setMfaBusy(true);
    setMfaNotice('');
    try {
      const { error } = await supabase.auth.mfa.challengeAndVerify({ factorId, code: mfaCode.trim() });
      if (error) throw error;
      setMfaCode('');
      setTotpEnrollment(null);
      setMfaNotice('TOTP verified for this session. Sensitive CMS operations require this assurance level.');
      await refreshMfa();
    } catch (error) {
      setMfaNotice(error instanceof Error ? error.message : 'TOTP verification failed.');
    } finally {
      setMfaBusy(false);
    }
  }

  async function refreshInbox() {
    setInboxStatus('loading');
    setInboxNotice('');
    try {
      const result = await callInbox('GET');
      if (!Array.isArray(result?.messages)) throw new Error('Inbox returned an invalid response.');
      if (typeof result?.unreadCount !== 'number' || !Number.isInteger(result.unreadCount) || result.unreadCount < 0) {
        throw new Error('Inbox returned an invalid unread count.');
      }
      setMessages(result.messages);
      setUnreadCount(result.unreadCount);
      setInboxStatus('ready');
    } catch (error) {
      setInboxStatus('error');
      setInboxNotice(error instanceof Error ? error.message : 'Inbox is unavailable.');
    }
  }

  async function updateMessage(message: InboxMessage, state: InboxMessage['state']) {
    setInboxBusy(message.id);
    setInboxNotice('');
    try {
      await callInbox('POST', { id: message.id, state });
      setMessages(current => current.map(item => item.id === message.id ? { ...item, state } : item));
      if ((message.state === 'unread') !== (state === 'unread')) {
        setUnreadCount(current => Math.max(0, current + (state === 'unread' ? 1 : -1)));
      }
      setInboxNotice('Message updated.');
    } catch (error) {
      setInboxNotice(error instanceof Error ? error.message : 'Could not update the message.');
    } finally {
      setInboxBusy('');
    }
  }

  useEffect(() => {
    if (!session) return;
    callAction('dashboard_summary').then(result => {
      if (!result.summary) throw new Error('CMS returned an invalid dashboard summary.');
      setSummary(result.summary);
    }).catch(error => setStatus(errorMessage(error, 'Could not load dashboard summary.')));
    refreshRecords(undefined);
    refreshMfa();
    refreshInbox();
  }, [session]);

  useEffect(() => {
    if (!session) return;
    const refreshWhenVisible = () => {
      if (document.visibilityState === 'visible') refreshMfa();
    };
    window.addEventListener('focus', refreshWhenVisible);
    document.addEventListener('visibilitychange', refreshWhenVisible);
    return () => {
      window.removeEventListener('focus', refreshWhenVisible);
      document.removeEventListener('visibilitychange', refreshWhenVisible);
    };
  }, [session?.access_token]);

  useEffect(() => {
    if (session && inboxStatus !== 'loading' && window.location.hash === '#inbox') {
      setActiveView('inbox');
      document.querySelector('#inbox')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }, [session, inboxStatus]);

  async function signOut() {
    if (recordDirty && !window.confirm('Discard unsaved draft changes and sign out?')) return;
    try {
      const { error } = await supabase?.auth.signOut() || {};
      if (error) throw error;
      setSession(null);
      setRecords([]);
      setMessages([]);
      setUnreadCount(0);
      setStatus('');
    } catch (error) {
      setStatus(error instanceof Error ? error.message : 'Could not sign out.');
    }
  }

  const viewLabels: Record<DashboardView, string> = {
    overview: 'Overview', projects: 'Projects', experience: 'Experience',
    skills: 'Skills', credentials: 'Credentials', articles: 'Articles',
    education: 'Education', achievements: 'Achievements', categories: 'Categories',
    profile: 'Profile', media: 'Media library', audit: 'Audit history', inbox: `Inbox (${unreadCount})`
  };
  const editableRecordType = viewRecordType[activeView];

  return (
    <main className="manage-shell">
      <aside className="manage-nav">
        <p className="brand">Fares Dkhili</p>
        <p className="eyebrow">Owner workspace</p>
        {session && <>
          <nav className="manage-nav-links" aria-label="Owner workspace">
            {(Object.keys(viewLabels) as DashboardView[]).map(view => (
              <button type="button" key={view} className={activeView === view ? 'active' : ''} aria-current={activeView === view ? 'page' : undefined} onClick={() => openView(view)}>
                {viewLabels[view]}
              </button>
            ))}
          </nav>
          <button type="button" onClick={signOut}>Sign out</button>
        </>}
      </aside>
      <section className="manage-content">
        {!session ? (
          <div className="login-card">
            <p className="eyebrow">Secure access</p>
            <h1>Owner<br /><em>workspace.</em></h1>
            <form onSubmit={signIn}>
              <label htmlFor="email">Email</label>
              <input id="email" type="email" required autoComplete="username" value={email} onChange={event => setEmail(event.target.value)} />
              <button type="submit" disabled={authBusy}>{authBusy ? 'Sending…' : 'Send sign-in link'}</button>
            </form>
            <p role="status" aria-live="polite">{status}</p>
          </div>
        ) : (
          <>
            <header className="manage-header">
              <div><p className="eyebrow">Owner workspace · {viewLabels[activeView]}</p><h1>Publishing<br /><em>atlas.</em></h1></div>
            </header>
            {status && <p className="manage-error" role="alert">{status}</p>}
            <section className="mfa-panel" aria-labelledby="mfa-heading">
              <header><div><p className="eyebrow">Account security</p><h2 id="mfa-heading">Multi-factor authentication</h2></div><span className={`aal-state ${aalLevel}`}>{aalLevel === 'loading' ? 'Checking…' : aalLevel === 'error' ? 'Unavailable' : `Session ${aalLevel}`}</span></header>
              {mfaNotice && <p className="mfa-notice" role="status">{mfaNotice}</p>}
              {aalLevel === 'error' && <button type="button" onClick={refreshMfa}>Retry security check</button>}
              {aalLevel !== 'error' && aalLevel !== 'loading' && aalLevel !== 'aal2' && !verifiedTotpId && !totpEnrollment && !unverifiedTotpId
                && <button type="button" onClick={enrollTotp} disabled={mfaBusy}>Enroll TOTP authenticator</button>}
              {unverifiedTotpId && !totpEnrollment && !verifiedTotpId && <div className="mfa-actions"><p>An incomplete TOTP enrollment exists for this account.</p><button type="button" onClick={removeIncompleteTotp} disabled={mfaBusy}>Remove incomplete enrollment</button></div>}
              {totpEnrollment && <div className="totp-enrollment"><img src={totpEnrollment.qrCode} alt="TOTP enrollment QR code" /><p>Or enter this setup key in your authenticator:</p><code>{totpEnrollment.secret}</code></div>}
              {(totpEnrollment || verifiedTotpId) && aalLevel !== 'error' && <form className="mfa-verify" onSubmit={verifyTotp}>
                <label htmlFor="mfa-code">Authenticator code</label>
                <input id="mfa-code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9]{6}" maxLength={6} required value={mfaCode} onChange={event => setMfaCode(event.target.value)} />
                <button type="submit" disabled={mfaBusy || aalLevel === 'loading'}>{mfaBusy ? 'Verifying…' : 'Verify TOTP code'}</button>
              </form>}
              {aalLevel === 'aal2' && verifiedTotpId && !totpEnrollment && <p className="mfa-confirmed">TOTP is verified for this session.</p>}
              {aalLevel === 'aal2' && !verifiedTotpId && <p className="mfa-notice">This session is aal2, but the CMS requires a verified TOTP factor. Enroll one to use sensitive operations.</p>}
            </section>
            {activeView === 'overview' && <>
              <div className="stats">
                <article><strong>{summary.recordCount}</strong><span>Records</span></article>
                <article><strong>{summary.draftCount}</strong><span>Drafts</span></article>
                <article><strong>{summary.publicationCount}</strong><span>Publication attempts</span></article>
              </div>
              <section className="record-panel">
                <header className="section-header">
                  <div><h2>Content records</h2><p className="module-notice">Import the published JSON as a versioned CMS baseline. Re-importing synchronizes its original collection order; it does not change the public site.</p></div>
                  <div className="section-actions">
                    <button type="button" onClick={() => refreshRecords(undefined)} disabled={recordsStatus === 'loading'}>Refresh</button>
                    <button type="button" onClick={importPublicBaseline} disabled={baselineBusy || !aal2Ready()}>{baselineBusy ? 'Importing…' : 'Import public baseline'}</button>
                  </div>
                </header>
                {recordsNotice && <p className={recordsStatus === 'error' ? 'manage-error' : 'module-notice'} role={recordsStatus === 'error' ? 'alert' : 'status'}>{recordsNotice}</p>}
                {recordsStatus === 'loading' ? <p role="status">Loading content…</p>
                  : recordsStatus === 'error' ? <button type="button" onClick={() => refreshRecords(undefined)}>Retry</button>
                    : records.length ? <div className="record-list">{records.map(record => (
                      <button type="button" className="record-item" key={record.id} onClick={() => openRecordFromOverview(record)}>
                        <span className="mono">{record.record_type}</span><strong>{record.record_key}</strong>
                        <span className={`state ${record.publication_state}`}>{record.publication_state}</span>
                      </button>
                    ))}</div> : <p>No private CMS records are available yet. Create a draft from a content module.</p>}
              </section>
            </>}
            {editableRecordType && <section className="record-panel cms-module" aria-labelledby="records-heading">
              <header className="section-header">
                <div><p className="eyebrow">Private content records</p><h2 id="records-heading">{viewLabels[activeView]}</h2></div>
                <div className="section-actions">
                  <button type="button" onClick={() => refreshRecords(editableRecordType)} disabled={recordsStatus === 'loading'}>Refresh</button>
                  <button type="button" onClick={createDraft} disabled={recordBusy !== ''}>New draft</button>
                </div>
              </header>
              {recordsNotice && <p className={recordsStatus === 'error' ? 'manage-error' : 'module-notice'} role={recordsStatus === 'error' ? 'alert' : 'status'}>{recordsNotice}</p>}
              <div className="cms-columns">
                <div className="record-list" aria-label={`${viewLabels[activeView]} records`}>
                  {recordsStatus === 'loading' ? <p role="status">Loading records…</p>
                    : recordsStatus === 'error' ? <button type="button" onClick={() => refreshRecords(editableRecordType)}>Retry</button>
                      : records.length ? records.map((record, index) => (
                        <div className="record-order-row" key={record.id}>
                          <button type="button" className={`record-item ${selectedRecord?.id === record.id ? 'selected' : ''}`} onClick={() => openRecord(record)} disabled={recordBusy !== ''}>
                            <span className="mono">{record.publication_state}</span><strong>{record.record_key}</strong><time dateTime={record.updated_at}>{new Date(record.updated_at).toLocaleDateString()}</time>
                          </button>
                          <div className="record-order-controls" aria-label={`Order controls for ${record.record_key}`}>
                            <button type="button" onClick={() => moveRecord(index, -1)} disabled={index === 0 || recordBusy !== '' || !aal2Ready()} aria-label={`Move ${record.record_key} up`}>Up</button>
                            <button type="button" onClick={() => moveRecord(index, 1)} disabled={index === records.length - 1 || recordBusy !== '' || !aal2Ready()} aria-label={`Move ${record.record_key} down`}>Down</button>
                          </div>
                        </div>
                      )) : <p>No {viewLabels[activeView].toLowerCase()} records yet.</p>}
                </div>
                <div className="record-editor">
                  {selectedRecord || recordDirty ? <>
                    <h3>{selectedRecord ? `Edit ${selectedRecord.record_key}` : 'New private draft'}</h3>
                    {selectedRecord && <p className="module-notice">Status: <strong>{selectedRecord.publication_state}</strong>. Saving creates a new private version.</p>}
                    <form onSubmit={saveDraft}>
                      <label htmlFor="record-key">Record key</label>
                      <input id="record-key" required pattern="[a-z0-9]+(-[a-z0-9]+)*" maxLength={100} value={recordKey} disabled={Boolean(selectedRecord)} onChange={event => { setRecordKey(event.target.value); setRecordDirty(true); }} />
                      <label htmlFor="public-payload">Public content JSON</label>
                      <textarea id="public-payload" rows={14} required value={payloadText} onChange={event => { setPayloadText(event.target.value); setRecordDirty(true); }} spellCheck={false} />
                      <label htmlFor="editorial-metadata">Private editorial metadata JSON</label>
                      <textarea id="editorial-metadata" rows={5} value={editorialText} onChange={event => { setEditorialText(event.target.value); setRecordDirty(true); }} spellCheck={false} />
                      <label htmlFor="change-summary">Change summary</label>
                      <input id="change-summary" maxLength={500} value={changeSummary} onChange={event => { setChangeSummary(event.target.value); setRecordDirty(true); }} />
                      <div className="editor-actions">
                        <button type="submit" disabled={recordBusy !== '' || !aal2Ready()}>{recordBusy === 'save' ? 'Saving…' : 'Save private draft'}</button>
                        {selectedRecord && <button type="button" onClick={archiveRecord} disabled={recordBusy !== '' || !aal2Ready()}>Archive</button>}
                        {selectedRecord && selectedRecord.publication_state === 'draft' && selectedRecord.draft_version_id
                          && <button type="button" onClick={requestPublication} disabled={recordBusy !== '' || !aal2Ready()}>{recordBusy === 'publish' ? 'Requesting…' : 'Request publication'}</button>}
                      </div>
                    </form>
                    {selectedRecord && <section className="version-history" aria-labelledby="versions-heading">
                      <h3 id="versions-heading">Version history</h3>
                      {selectedRecord.versions.length ? selectedRecord.versions.map(version => (
                        <article key={version.id}>
                          <div><strong>Version {version.version_number}</strong><time dateTime={version.created_at}>{new Date(version.created_at).toLocaleString()}</time><p>{version.change_summary || 'No change summary.'}</p></div>
                          {(version.id !== selectedRecord.draft_version_id || selectedRecord.publication_state === 'archived') && <button type="button" onClick={() => restoreVersion(version.id)} disabled={recordBusy !== '' || !aal2Ready()}>{selectedRecord.publication_state === 'archived' ? 'Restore archived record' : 'Restore as new draft'}</button>}
                        </article>
                      )) : <p>No versions are available.</p>}
                    </section>}
                  </> : <p>Select a record or create a new draft. Drafts are stored privately and never appear on the public site automatically.</p>}
                </div>
              </div>
            </section>}
            {activeView === 'audit' && <section className="record-panel" aria-labelledby="audit-heading">
              <header className="section-header"><div><p className="eyebrow">Read-only event log</p><h2 id="audit-heading">Audit history</h2></div><button type="button" onClick={refreshAudit} disabled={auditStatus === 'loading'}>Refresh</button></header>
              {auditNotice && <p className={auditStatus === 'error' ? 'manage-error' : 'module-notice'} role={auditStatus === 'error' ? 'alert' : 'status'}>{auditNotice}</p>}
              {auditStatus === 'loading' ? <p role="status">Loading audit history…</p>
                : auditStatus === 'error' ? <button type="button" onClick={refreshAudit}>Retry</button>
                  : auditEvents.length ? <div className="audit-list">{auditEvents.map(event => (
                    <article key={event.id}>
                      <div className="inbox-message-meta"><time dateTime={event.created_at}>{new Date(event.created_at).toLocaleString()}</time><span className={`state ${event.outcome}`}>{event.outcome}</span></div>
                      <h3>{event.action}</h3><p>{event.entity_type}{event.entity_id ? ` · ${event.entity_id}` : ''}</p>
                      {Object.keys(event.metadata || {}).length > 0 && <pre>{JSON.stringify(event.metadata, null, 2)}</pre>}
                    </article>
                  ))}</div> : <p>No audit events have been recorded.</p>}
            </section>}
            {activeView === 'media' && <section className="record-panel" aria-labelledby="media-heading">
              <header className="section-header"><div><p className="eyebrow">Private drafts by default</p><h2 id="media-heading">Media library</h2></div><button type="button" onClick={refreshMedia} disabled={mediaStatus === 'loading'}>Refresh</button></header>
              {mediaNotice && <p className={mediaStatus === 'error' ? 'manage-error' : 'module-notice'} role={mediaStatus === 'error' ? 'alert' : 'status'}>{mediaNotice}</p>}
              {mediaPublicUrl && <p className="module-notice">Public media URL: <a href={mediaPublicUrl} target="_blank" rel="noreferrer">{mediaPublicUrl}</a></p>}
              <form className="media-upload" onSubmit={uploadMedia}>
                <label htmlFor="media-file">Upload a private PNG, JPEG, or WebP (max 10 MiB)</label>
                <input id="media-file" type="file" accept="image/png,image/jpeg,image/webp" onChange={event => setUploadFile(event.target.files?.[0] || null)} />
                <button type="submit" disabled={mediaBusy !== '' || !uploadFile || !aal2Ready()}>{mediaBusy === 'upload' ? 'Uploading…' : 'Upload to private bucket'}</button>
              </form>
              {mediaPreview && <figure className="media-preview">
                {!mediaPreviewExpired
                  ? <img src={mediaPreview.url} alt="Selected media preview" onError={() => setMediaPreviewExpired(true)} />
                  : <p role="status">This preview expired or is no longer available.</p>}
                <figcaption>{mediaPreview.visibility} preview · URLs for private assets expire shortly.</figcaption>
                {mediaPreviewExpired && <button type="button" onClick={() => {
                  const asset = mediaAssets.find(item => item.id === mediaPreview.id);
                  if (asset) previewMedia(asset);
                }} disabled={mediaBusy !== ''}>Refresh preview</button>}
              </figure>}
              {mediaStatus === 'loading' ? <p role="status">Loading media…</p>
                : mediaStatus === 'error' ? <button type="button" onClick={refreshMedia}>Retry</button>
                  : mediaAssets.length ? <div className="media-list">{mediaAssets.map(asset => (
                    <article className="media-item" key={asset.id}>
                      <header><div><h3>{asset.original_name}</h3><p>{asset.content_type} · {Math.ceil(asset.size_bytes / 1024)} KiB · {asset.upload_state === 'pending' ? 'upload pending' : asset.published_object_path ? 'public approved' : 'private'}</p></div><time dateTime={asset.created_at}>{new Date(asset.created_at).toLocaleDateString()}</time></header>
                      <div className="media-actions">
                        <button type="button" onClick={() => previewMedia(asset)} disabled={mediaBusy !== '' || asset.upload_state !== 'ready'}>Preview</button>
                        {asset.upload_state === 'pending' && <button type="button" onClick={() => verifyPendingMedia(asset)} disabled={mediaBusy !== '' || !aal2Ready()}>{mediaBusy === asset.id ? 'Verifying…' : 'Verify pending upload'}</button>}
                        {!asset.published_object_path && <button type="button" onClick={() => approveMedia(asset)} disabled={mediaBusy !== '' || asset.upload_state !== 'ready' || !asset.alt_text || !asset.caption || !aal2Ready()}>Approve public</button>}
                        {!asset.published_object_path && <button type="button" onClick={() => removeMedia(asset)} disabled={mediaBusy !== '' || !aal2Ready()}>Remove staged</button>}
                      </div>
                      {asset.upload_state === 'ready' && <form className="media-metadata" onSubmit={event => updateMedia(event, asset)}>
                        <label>Alt text<input name="altText" maxLength={300} defaultValue={asset.alt_text} /></label>
                        <label>Caption / provenance<input name="caption" maxLength={1000} defaultValue={asset.caption} /></label>
                        <label>Associated record UUID (optional)<input name="recordId" defaultValue={asset.record_id || ''} /></label>
                        <button type="submit" disabled={mediaBusy !== '' || !aal2Ready()}>Save metadata</button>
                      </form>}
                    </article>
                  ))}</div> : <p>No media has been uploaded. Uploads remain private until explicitly approved.</p>}
            </section>}
            {activeView === 'inbox' && <section className="inbox-panel" id="inbox" aria-labelledby="inbox-heading">
              <header className="inbox-panel-header">
                <div><p className="eyebrow">Private messages</p><h2 id="inbox-heading">Inbox <span>{unreadCount} unread</span></h2></div>
                <button type="button" className="inbox-refresh" onClick={refreshInbox} disabled={inboxStatus === 'loading'}>{inboxStatus === 'loading' ? 'Loading…' : 'Refresh inbox'}</button>
              </header>
              {inboxNotice && <p className={inboxStatus === 'error' ? 'inbox-error' : 'inbox-notice'} role={inboxStatus === 'error' ? 'alert' : 'status'}>{inboxNotice}</p>}
              {inboxStatus === 'loading' ? <p role="status">Loading messages…</p>
                : inboxStatus === 'error' ? <button type="button" className="inbox-retry" onClick={refreshInbox}>Try again</button>
                  : messages.length === 0 ? <p className="inbox-empty">No messages yet.</p>
                    : <div className="inbox-messages">{messages.map(message => (
                      <article key={message.id} className={`inbox-message ${message.state}`}>
                        <div className="inbox-message-meta"><time dateTime={message.created_at}>{new Date(message.created_at).toLocaleString()}</time><span>{message.state}</span></div>
                        <h3>{message.subject}</h3>
                        <p className="inbox-sender">{message.sender_name || 'Name not provided'} · <a href={`mailto:${message.sender_email}`}>{message.sender_email}</a></p>
                        <p className="inbox-body">{message.body}</p>
                        <div className="inbox-actions">
                          {message.state !== 'archived' && <button type="button" onClick={() => updateMessage(message, message.state === 'unread' ? 'read' : 'unread')} disabled={inboxBusy === message.id}>{message.state === 'unread' ? 'Mark read' : 'Mark unread'}</button>}
                          {message.state !== 'archived' && <button type="button" onClick={() => updateMessage(message, 'archived')} disabled={inboxBusy === message.id}>Archive</button>}
                          {message.state === 'archived' && <button type="button" onClick={() => updateMessage(message, 'unread')} disabled={inboxBusy === message.id}>Restore to unread</button>}
                        </div>
                      </article>
                    ))}</div>}
            </section>
            }
          </>
        )}
      </section>
    </main>
  );
}

createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>);
