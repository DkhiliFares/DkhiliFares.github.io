import test from 'node:test';
import assert from 'node:assert/strict';
import { createPublicBaseline } from '../scripts/prepare-dashboard-baseline.mjs';
import { loadContent } from '../scripts/validate-content.mjs';
import { validateCmsDraft } from '../supabase/functions/_shared/cms-validation.mjs';

test('dashboard baseline includes public content but excludes private drafts', () => {
  const content = {
    profile: { name: 'Owner', title: 'Engineer' },
    projects: [
      { id: 'public-study', title: 'Public study', visibility: 'published' },
      { id: 'private-study', title: 'Draft study', visibility: 'draft', internalNotes: 'private sentinel' }
    ],
    experience: [{ id: 'internship', visibility: 'published' }],
    skills: [{ id: 'skill', visibility: 'draft' }],
    education: [{ id: 'degree' }],
    certifications: [{ id: 'credential' }],
    achievements: [{ id: 'award' }],
    articles: [{ id: 'note', visibility: 'published' }],
    categories: [{ id: 'category' }]
  };
  const baseline = createPublicBaseline(content);
  assert.deepEqual(baseline.map(record => `${record.recordType}:${record.recordKey}`), [
    'profile:profile',
    'project:public-study',
    'experience:internship',
    'education:degree',
    'credential:credential',
    'achievement:award',
    'article:note',
    'category:category'
  ]);
  const expectedOrder = new Map();
  for (const record of baseline) {
    assert.equal(record.collectionOrder, expectedOrder.get(record.recordType) || 0);
    expectedOrder.set(record.recordType, record.collectionOrder + 1);
  }
  assert.doesNotMatch(JSON.stringify(baseline), /private-study|private sentinel|skill/);
});

test('every currently public content record is valid for one-time CMS baseline import', async () => {
  const baseline = createPublicBaseline(await loadContent());
  const references = {
    categories: new Set(baseline.filter(record => record.recordType === 'category').map(record => record.recordKey)),
    projects: new Set(baseline.filter(record => record.recordType === 'project').map(record => record.recordKey)),
    experience: new Set(baseline.filter(record => record.recordType === 'experience').map(record => record.recordKey))
  };
  assert(baseline.length > 0);
  for (const record of baseline) {
    const result = validateCmsDraft(record, { forceDraft: false, references });
    assert.equal(result.error, undefined, `${record.recordType}/${record.recordKey} must be CMS-valid`);
    if (['project','article'].includes(record.recordType)) {
      assert.equal(record.publicPayload.visibility, 'published');
    }
  }
});

test('CMS validation rejects public records that violate website structure or references', () => {
  const validProject = {
    recordType: 'project',
    recordKey: 'example',
    publicPayload: {
      title: 'Example',
      summary: 'A complete summary.',
      repositoryName: 'Example',
      repository: 'https://github.com/example/project',
      statusLabel: 'In progress',
      category: 'embedded',
      kind: 'project',
      status: 'in-progress',
      technologies: ['C'],
      evidence: ['https://github.com/example/project'],
      notes: [],
      caseStudy: false,
      featured: false
    }
  };
  for (const field of ['repositoryName','repository','statusLabel','technologies','evidence','notes']) {
    const incomplete = structuredClone(validProject);
    delete incomplete.publicPayload[field];
    assert.match(validateCmsDraft(incomplete).error, /Invalid project content/, `${field} is consumed by the public project pages`);
  }

  const project = {
    recordType: 'project',
    recordKey: 'case-study',
    publicPayload: {
      title: 'Case study',
      summary: 'A complete summary.',
      category: 'embedded',
      kind: 'project',
      status: 'planned',
      caseStudy: true
    }
  };
  assert.match(validateCmsDraft(project).error, /Invalid project content/);
  assert.match(validateCmsDraft({
    ...project,
    publicPayload: {
      ...project.publicPayload,
      caseStudy: false,
      featured: true,
      feature: 'Featured project'
    }
  }).error, /Invalid project content/);

  const mediaProject = {
    ...project,
    publicPayload: {
      ...project.publicPayload,
      caseStudy: false,
      media: [{
        src: 'images/project.webp', alt: 'A view', caption: 'Repository evidence.',
        origin: 'repository', role: 'cover', source: 'https://github.com/example/project'
      }]
    }
  };
  assert.match(validateCmsDraft(mediaProject).error, /Invalid project content/);

  assert.match(validateCmsDraft({
    recordType: 'profile',
    recordKey: 'profile',
    publicPayload: { name: 'Owner', title: 'Engineer' }
  }).error, /Invalid profile content/);
  const profile = {
    recordType: 'profile',
    recordKey: 'profile',
    publicPayload: {
      name: 'Owner', title: 'Engineer', location: 'Tunis',
      intro: 'An engineer.', about: 'About the engineer.',
      github: 'https://github.com/example', linkedin: 'https://linkedin.com/in/example',
      languages: [{ name: 'English', level: 'B2' }],
      affiliations: [{ name: 'Engineering club', period: '2025' }]
    }
  };
  for (const field of ['location','intro','about','languages','affiliations','github','linkedin']) {
    const incomplete = structuredClone(profile);
    delete incomplete.publicPayload[field];
    assert.match(validateCmsDraft(incomplete).error, /Invalid profile content/, `${field} is consumed by the site profile`);
  }

  const references = {
    categories: new Set(['embedded']),
    projects: new Set(['public-project']),
    experience: new Set(['public-role'])
  };
  assert.match(validateCmsDraft(project, { references }).error, /Invalid project content/);
  assert.match(validateCmsDraft({
    recordType: 'skill',
    recordKey: 'skill',
    publicPayload: {
      title: 'C', category: 'embedded', evidenceType: 'project', evidenceNote: 'Supported.',
      projects: ['private-project'], experience: ['public-role']
    }
  }, { references }).error, /Invalid skill content/);
});
