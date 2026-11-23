import { validateCmsDraft } from '../supabase/functions/_shared/cms-validation.mjs';
import { collections, validateContent } from './validate-content.mjs';

const collectionByType = {
  project: 'projects',
  skill: 'skills',
  experience: 'experience',
  education: 'education',
  credential: 'certifications',
  achievement: 'achievements',
  article: 'articles',
  profile: 'profile',
  category: 'categories'
};

const recordTypes = new Set(Object.keys(collectionByType));
const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const recordFields = new Set([
  'recordType','recordKey','collectionOrder','publishedVersionId','publicPayload'
]);

export async function serializeApprovedCmsRecords(records) {
  if (!Array.isArray(records) || records.length > 250) {
    throw new Error('Approved CMS records must be an array of at most 250 entries.');
  }

  const content = Object.fromEntries(collections.map(name => [name, name === 'profile' ? null : []]));
  const identities = new Set();
  const orderByCollection = new Map(collections.filter(name => name !== 'profile').map(name => [name, new Set()]));
  const references = {
    categories: new Set(records.filter(record => record?.recordType === 'category').map(record => record.recordKey)),
    projects: new Set(records.filter(record => record?.recordType === 'project').map(record => record.recordKey)),
    experience: new Set(records.filter(record => record?.recordType === 'experience').map(record => record.recordKey))
  };
  let profileOrder = 0;

  for (const record of records) {
    if (!record || typeof record !== 'object' || Array.isArray(record)
      || Object.keys(record).some(field => !recordFields.has(field))
      || Object.keys(record).length !== recordFields.size
      || !recordTypes.has(record.recordType)
      || typeof record.recordKey !== 'string'
      || typeof record.publishedVersionId !== 'string' || !uuidPattern.test(record.publishedVersionId)
      || !Number.isInteger(record.collectionOrder) || record.collectionOrder < 0
      || !record.publicPayload || typeof record.publicPayload !== 'object' || Array.isArray(record.publicPayload)) {
      throw new Error('CMS export record is malformed or has no approved published version.');
    }

    const identity = `${record.recordType}:${record.recordKey}`;
    if (identities.has(identity)) throw new Error(`Duplicate CMS export record: ${identity}.`);
    identities.add(identity);

    const collection = collectionByType[record.recordType];
    if (collection === 'profile') {
      if (record.recordKey !== 'profile' || record.collectionOrder !== 0 || content.profile !== null) {
        throw new Error('CMS export must contain exactly one profile at order zero.');
      }
      profileOrder++;
    } else {
      const positions = orderByCollection.get(collection);
      if (positions.has(record.collectionOrder)) {
        throw new Error(`Duplicate ${collection} order ${record.collectionOrder}.`);
      }
      positions.add(record.collectionOrder);
    }

    if (record.publicPayload.visibility !== undefined && record.publicPayload.visibility !== 'published') {
      throw new Error(`Unpublished content cannot be exported: ${identity}.`);
    }

    const validated = validateCmsDraft({
      recordType: record.recordType,
      recordKey: record.recordKey,
      publicPayload: record.publicPayload
    }, { forceDraft: false, references });
    if (validated.error) throw new Error(`${identity}: ${validated.error}`);
    const payload = validated.value.publicPayload;
    if (record.recordType === 'profile') {
      content.profile = payload;
    } else {
      content[collection].push({ collectionOrder: record.collectionOrder, payload });
    }
  }

  if (profileOrder !== 1 || !content.profile) {
    throw new Error('CMS export must contain exactly one approved profile.');
  }

  for (const collection of collections.filter(name => name !== 'profile')) {
    const entries = content[collection];
    const positions = orderByCollection.get(collection);
    const sortedPositions = [...positions].sort((left, right) => left - right);
    if (positions.size !== entries.length
      || sortedPositions.some((position, index) => position !== index)) {
      throw new Error(`${collection} ordering must be contiguous and start at zero.`);
    }
    content[collection] = entries
      .sort((left, right) => left.collectionOrder - right.collectionOrder)
      .map(entry => entry.payload);
  }

  await validateContent(content);
  return content;
}
