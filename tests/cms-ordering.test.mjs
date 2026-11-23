import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createPublicBaseline } from '../scripts/prepare-dashboard-baseline.mjs';
import { serializeApprovedCmsRecords } from '../scripts/export-public-content.mjs';
import { loadContent, root } from '../scripts/validate-content.mjs';

function exportRecords(baseline) {
  const positions = new Map();
  return baseline.map((record, index) => {
    const collectionOrder = positions.get(record.recordType) || 0;
    positions.set(record.recordType, collectionOrder + 1);
    return {
      ...record,
      collectionOrder,
      publishedVersionId: `00000000-0000-4000-8000-${String(index + 1).padStart(12, '0')}`
    };
  });
}

test('approved CMS serialization preserves each public JSON collection order and payload', async () => {
  const source = await loadContent();
  const baseline = createPublicBaseline(source);
  const records = exportRecords(baseline);
  const expected = {
    profile: source.profile,
    projects: source.projects.filter(item => !item.visibility || item.visibility === 'published'),
    skills: source.skills.filter(item => !item.visibility || item.visibility === 'published'),
    experience: source.experience.filter(item => !item.visibility || item.visibility === 'published'),
    education: source.education.filter(item => !item.visibility || item.visibility === 'published'),
    certifications: source.certifications.filter(item => !item.visibility || item.visibility === 'published'),
    achievements: source.achievements.filter(item => !item.visibility || item.visibility === 'published'),
    articles: source.articles.filter(item => !item.visibility || item.visibility === 'published'),
    categories: source.categories.filter(item => !item.visibility || item.visibility === 'published')
  };

  const serialized = await serializeApprovedCmsRecords(records);
  assert.deepEqual(serialized, expected);
  assert.equal(
    JSON.stringify(await serializeApprovedCmsRecords([...records].reverse())),
    JSON.stringify(serialized),
    'database row order must not affect export order'
  );
});

test('CMS serialization rejects unapproved, private, incomplete, and invalidly ordered records', async () => {
  const records = exportRecords(createPublicBaseline(await loadContent()));
  const withoutApproval = structuredClone(records);
  withoutApproval[0].publishedVersionId = null;
  await assert.rejects(() => serializeApprovedCmsRecords(withoutApproval), /approved published version/);

  const withPrivateField = structuredClone(records);
  withPrivateField.find(record => record.recordType === 'profile').publicPayload.internalNotes = 'private';
  await assert.rejects(() => serializeApprovedCmsRecords(withPrivateField), /Private fields/);

  const withUnpublishedPayload = structuredClone(records);
  withUnpublishedPayload.find(record => record.recordType === 'project').publicPayload.visibility = 'draft';
  await assert.rejects(() => serializeApprovedCmsRecords(withUnpublishedPayload), /Unpublished content/);

  const withMissingReference = structuredClone(records);
  withMissingReference.find(record => record.recordType === 'skill').publicPayload.projects = ['missing-project'];
  await assert.rejects(() => serializeApprovedCmsRecords(withMissingReference), /Invalid skill content/);

  const withOrderGap = structuredClone(records);
  const project = withOrderGap.filter(record => record.recordType === 'project').at(-1);
  project.collectionOrder += 2;
  await assert.rejects(() => serializeApprovedCmsRecords(withOrderGap), /ordering must be contiguous/);
});

test('ordering migration and pgTAP suite cover owner ordering and immutable restores', async () => {
  const migration = await readFile(
    `${root}/supabase/migrations/20261123210000_portfolio_cms_ordering.sql`,
    'utf8'
  );
  const concurrencyMigration = await readFile(
    `${root}/supabase/migrations/20261123220000_portfolio_cms_ordering_concurrency.sql`,
    'utf8'
  );
  const integrationTests = await readFile(`${root}/supabase/tests/portfolio_cms.test.sql`, 'utf8');
  assert.match(migration, /collection_order integer/);
  assert.match(migration, /unique \(record_type, collection_order\)\s+deferrable initially deferred/i);
  assert.match(migration, /function public\.cms_reorder_records/i);
  assert.match(concurrencyMigration, /p_expected_record_ids uuid\[\]/i);
  assert.match(concurrencyMigration, /pg_advisory_xact_lock/i);
  assert.match(concurrencyMigration, /errcode = '40001'/i);
  assert.match(concurrencyMigration, /previous_record_ids/);
  assert.match(concurrencyMigration, /ordered_record_ids/);
  assert.match(integrationTests, /\[A,B,C\] to \[C,A,B\]/);
  assert.match(integrationTests, /stale competing reorder is rejected/);
  assert.match(integrationTests, /Injected reorder audit failure/);
  assert.match(integrationTests, /cms_restore_version/i);
  assert.match(integrationTests, /CMS history is immutable/);
});
