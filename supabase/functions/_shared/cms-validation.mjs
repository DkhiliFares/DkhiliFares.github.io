const recordTypes = new Set([
  'project','skill','experience','education','credential',
  'achievement','article','profile','category'
]);
const privateKeys = new Set([
  'auth','email','evidencenotes','internalnotes','ownerreviewstatus',
  'password','secret','sourcereferences','supabase','token','apikey','api_key',
  'privatekey','private_key','service_role','access_token','refresh_token','credentials'
]);
const privateKeyPattern = /(?:password|secret|token|authorization|api.?key|private.?key|service.?role|service.?key|email|source.?references?|internal.?notes|evidence.?notes|owner.?review.?status|supabase|credential)/i;
const projectStatuses = new Set(['planned','in-progress','completed','paused','unverified']);
const projectKinds = new Set(['project','exercise','reference','profile','fork']);
const skillEvidenceTypes = new Set(['project','internship','academic','training','cv','developing','documented']);
const visibilityStates = new Set(['draft','published','archived']);
const maxPayloadBytes = 150_000;

function containsPrivateKey(value) {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const current = pending.pop();
    if (current.depth > 30) return true;
    if (Array.isArray(current.value)) {
      pending.push(...current.value.map(child => ({ value: child, depth: current.depth + 1 })));
    } else if (current.value && typeof current.value === 'object') {
      for (const [key, child] of Object.entries(current.value)) {
        if (privateKeys.has(key.toLowerCase()) || privateKeyPattern.test(key)) return true;
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return false;
}

function containsSecretKey(value) {
  const pending = [{ value, depth: 0 }];
  while (pending.length) {
    const current = pending.pop();
    if (current.depth > 30) return true;
    if (Array.isArray(current.value)) {
      pending.push(...current.value.map(child => ({ value: child, depth: current.depth + 1 })));
    } else if (current.value && typeof current.value === 'object') {
      for (const [key, child] of Object.entries(current.value)) {
        if (/(?:password|secret|token|authorization|api.?key|private.?key|service.?role|credential|email)/i.test(key)) return true;
        pending.push({ value: child, depth: current.depth + 1 });
      }
    }
  }
  return false;
}

function normalize(value, depth = 0) {
  if (depth > 30) throw new Error('Content nesting is too deep.');
  if (typeof value === 'string') return value.trim();
  if (Array.isArray(value)) return value.map(child => normalize(child, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([key, child]) => [key, normalize(child, depth + 1)]));
  }
  return value;
}

function hasText(value, maxLength) {
  return typeof value === 'string' && value.length > 0 && value.length <= maxLength;
}

function isStringArray(value, maxItems = 100) {
  return Array.isArray(value) && value.length <= maxItems
    && value.every(item => typeof item === 'string' && item.length <= 2000);
}

function isHttpUrl(value) {
  try {
    const parsed = new URL(value);
    return ['https:','http:'].includes(parsed.protocol);
  } catch {
    return false;
  }
}

function isSlug(value) {
  return typeof value === 'string' && /^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(value);
}

function pathIsUnsafe(value) {
  return /^[a-z][a-z0-9+.-]*:/i.test(value) || value.startsWith('/') || value.startsWith('\\')
    || value.split(/[\\/]/).includes('..');
}

function validSections(sections) {
  if (!Array.isArray(sections) || sections.length > 50) return false;
  const ids = new Set();
  return sections.every(section => {
    if (!section || typeof section !== 'object' || Array.isArray(section)
      || !hasText(section.id, 100) || ids.has(section.id)
      || !hasText(section.title, 200) || !isStringArray(section.paragraphs, 100)
      || section.paragraphs.length === 0) return false;
    ids.add(section.id);
    return true;
  });
}

function validNamedItems(items, detailKey) {
  return Array.isArray(items) && items.length <= 50
    && items.every(item => item && typeof item === 'object' && !Array.isArray(item)
      && hasText(item.name, 200) && hasText(item[detailKey], 300));
}

function validMedia(media) {
  return Array.isArray(media) && media.length <= 20
    && media.every(item => item && typeof item === 'object' && !Array.isArray(item)
      && hasText(item.src, 500) && !pathIsUnsafe(item.src)
      && hasText(item.alt, 300) && hasText(item.caption, 1000)
      && Number.isInteger(item.width) && item.width > 0
      && Number.isInteger(item.height) && item.height > 0
      && ['conceptual','repository'].includes(item.origin)
      && ['cover','evidence'].includes(item.role)
      && (item.origin === 'repository'
        ? isHttpUrl(item.source)
        : item.source === null && /conceptual/i.test(item.caption)));
}

function validCaseStudy(payload) {
  const diagram = payload.diagram;
  return validSections(payload.sections)
    && Array.isArray(payload.objectives) && payload.objectives.length > 0
    && payload.objectives.every(item => hasText(item, 2000))
    && isStringArray(payload.components) && payload.components.length > 0
    && diagram && typeof diagram === 'object' && !Array.isArray(diagram)
    && Array.isArray(diagram.nodes) && diagram.nodes.length > 0 && diagram.nodes.length <= 4
    && diagram.nodes.every(node => node && typeof node === 'object' && !Array.isArray(node)
      && hasText(node.label, 200) && hasText(node.detail, 1000))
    && (diagram.edges === undefined || (Array.isArray(diagram.edges) && diagram.edges.every(edge =>
      Array.isArray(edge) && edge.length === 2 && edge.every(index => Number.isInteger(index) && index >= 0 && index < diagram.nodes.length)
    )))
    && hasText(diagram.caption, 1000);
}

function containsReference(references, collection, key) {
  return !references || references[collection] instanceof Set && references[collection].has(key);
}

export function validateCmsDraft(input, { forceDraft = true, references } = {}) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { error: 'Draft must be an object.' };
  }
  const { recordType, recordKey } = input;
  if (!recordTypes.has(recordType)) return { error: 'Unknown content type.' };
  if (typeof recordKey !== 'string' || recordKey.length > 100
    || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(recordKey)) {
    return { error: 'Record key must be a lowercase slug.' };
  }
  if (!input.publicPayload || typeof input.publicPayload !== 'object' || Array.isArray(input.publicPayload)) {
    return { error: 'Public content must be a JSON object.' };
  }
  let publicPayloadJson;
  try {
    publicPayloadJson = JSON.stringify(input.publicPayload);
  } catch {
    return { error: 'Public content is invalid.' };
  }
  if (new TextEncoder().encode(publicPayloadJson).length > maxPayloadBytes) {
    return { error: 'Public content is too large.' };
  }
  if (containsPrivateKey(input.publicPayload)) {
    return { error: 'Private fields cannot be included in public content.' };
  }
  if (input.editorialMetadata !== undefined
    && (!input.editorialMetadata || typeof input.editorialMetadata !== 'object' || Array.isArray(input.editorialMetadata))) {
    return { error: 'Editorial metadata must be a JSON object.' };
  }
  if (input.editorialMetadata) {
    let editorialJson;
    try {
      editorialJson = JSON.stringify(input.editorialMetadata);
    } catch {
      return { error: 'Editorial metadata is invalid.' };
    }
    if (new TextEncoder().encode(editorialJson).length > 20_000) {
      return { error: 'Editorial metadata is too large.' };
    }
    if (containsSecretKey(input.editorialMetadata)) {
      return { error: 'Credentials and personal contact data cannot be stored in editorial metadata.' };
    }
  }
  if (input.changeSummary !== undefined
    && (typeof input.changeSummary !== 'string' || input.changeSummary.trim().length > 500)) {
    return { error: 'Change summary must be 500 characters or fewer.' };
  }

  let payload;
  try {
    payload = normalize(input.publicPayload);
  } catch {
    return { error: 'Content nesting is too deep.' };
  }
  if (payload.visibility !== undefined && !visibilityStates.has(payload.visibility)) {
    return { error: 'Invalid content visibility.' };
  }
  if (forceDraft && recordType !== 'profile') payload.visibility = 'draft';
  const requiredText = (key, length = 200) => hasText(payload[key], length);
  let valid = false;
  switch (recordType) {
    case 'project':
      valid = requiredText('title') && requiredText('summary', 3000)
        && requiredText('repositoryName') && requiredText('statusLabel')
        && isHttpUrl(payload.repository)
        && requiredText('category', 100) && projectKinds.has(payload.kind)
        && containsReference(references, 'categories', payload.category)
        && (forceDraft || visibilityStates.has(payload.visibility))
        && projectStatuses.has(payload.status)
        && (payload.caseStudy === undefined || typeof payload.caseStudy === 'boolean')
        && (payload.featured === undefined || typeof payload.featured === 'boolean')
        && (!payload.featured || requiredText('feature', 1000))
        && (!payload.featured || payload.caseStudy === true)
        && isStringArray(payload.technologies)
        && isStringArray(payload.evidence) && payload.evidence.length > 0 && payload.evidence.every(isHttpUrl)
        && isStringArray(payload.notes)
        && (payload.media === undefined || validMedia(payload.media))
        && (payload.media === undefined || payload.media.filter(item => item.role === 'cover').length <= 1)
        && (!payload.caseStudy || validCaseStudy(payload))
        && (payload.status !== 'completed' || requiredText('completionEvidence', 3000))
        && (!['cutiepi','network-administration-project'].includes(recordKey)
          || payload.status !== 'completed' || payload.ownerConfirmedComplete === true);
      payload.id = recordKey;
      break;
    case 'experience':
      valid = requiredText('title') && requiredText('company')
        && requiredText('period') && requiredText('year', 20) && requiredText('summary', 3000)
        && isStringArray(payload.details) && isStringArray(payload.technologies);
      payload.id = recordKey;
      break;
    case 'skill':
      valid = requiredText('title') && requiredText('category', 100)
        && containsReference(references, 'categories', payload.category)
        && skillEvidenceTypes.has(payload.evidenceType)
        && (payload.evidenceNote === undefined || (typeof payload.evidenceNote === 'string' && payload.evidenceNote.length <= 2000))
        && isStringArray(payload.projects) && payload.projects.every(id => isSlug(id) && containsReference(references, 'projects', id))
        && isStringArray(payload.experience) && payload.experience.every(id => isSlug(id) && containsReference(references, 'experience', id));
      payload.id = recordKey;
      break;
    case 'credential':
      valid = requiredText('title') && requiredText('issuer')
        && requiredText('type')
        && (payload.verificationUrl == null || (
          typeof payload.verificationUrl === 'string'
          && /^https?:\/\/\S+$/i.test(payload.verificationUrl)
        ));
      payload.id = recordKey;
      break;
    case 'article':
      valid = requiredText('title') && requiredText('summary', 3000)
        && (forceDraft || visibilityStates.has(payload.visibility))
        && (payload.sections === undefined || validSections(payload.sections))
        && (forceDraft || payload.visibility !== 'published' || (Array.isArray(payload.sections) && payload.sections.length > 0));
      payload.id = recordKey;
      break;
    case 'education':
      valid = requiredText('title') && requiredText('institution') && requiredText('period')
        && (recordKey !== 'engineering-degree'
          || requiredText('department') && requiredText('specialization') && requiredText('major'));
      payload.id = recordKey;
      break;
    case 'achievement':
      valid = requiredText('title') && requiredText('organization')
        && requiredText('date') && requiredText('description', 3000);
      payload.id = recordKey;
      break;
    case 'category':
      valid = requiredText('title') && requiredText('subtitle');
      payload.id = recordKey;
      break;
    case 'profile':
      valid = requiredText('name') && requiredText('title') && requiredText('location')
        && requiredText('intro', 2000) && requiredText('about', 5000)
        && validNamedItems(payload.languages, 'level')
        && validNamedItems(payload.affiliations, 'period')
        && isHttpUrl(payload.github) && isHttpUrl(payload.linkedin);
      break;
  }
  if (!valid) return { error: `Invalid ${recordType} content.` };
  return {
    value: {
      recordType,
      recordKey,
      publicPayload: payload,
      editorialMetadata: normalize(input.editorialMetadata || {}),
      changeSummary: (input.changeSummary || '').trim()
    }
  };
}

export function hasImageSignature(bytes, contentType) {
  if (!(bytes instanceof Uint8Array)) return false;
  if (contentType === 'image/png') {
    return bytes.length >= 8
      && [0x89,0x50,0x4e,0x47,0x0d,0x0a,0x1a,0x0a].every((value, index) => bytes[index] === value);
  }
  if (contentType === 'image/jpeg') {
    return bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff;
  }
  if (contentType === 'image/webp') {
    return bytes.length >= 12
      && String.fromCharCode(...bytes.slice(0, 4)) === 'RIFF'
      && String.fromCharCode(...bytes.slice(8, 12)) === 'WEBP';
  }
  return false;
}
