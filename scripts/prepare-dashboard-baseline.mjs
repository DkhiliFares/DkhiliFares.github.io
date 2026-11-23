import { rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { collections, loadContent, root } from './validate-content.mjs';

const output = path.join(root, 'owner-dashboard', 'src', 'public-baseline.generated.ts');
const recordTypes = {
  projects: 'project',
  experience: 'experience',
  skills: 'skill',
  education: 'education',
  certifications: 'credential',
  achievements: 'achievement',
  articles: 'article',
  categories: 'category'
};

export function createPublicBaseline(content) {
  const baseline = [];
  const collectionOrders = new Map();
  const addRecord = (recordType, recordKey, publicPayload) => {
    const collectionOrder = collectionOrders.get(recordType) || 0;
    baseline.push({ recordType, recordKey, collectionOrder, publicPayload });
    collectionOrders.set(recordType, collectionOrder + 1);
  };
  addRecord('profile', 'profile', content.profile);
  for (const collection of collections.filter(name => name !== 'profile')) {
    const recordType = recordTypes[collection];
    if (!recordType) continue;
    for (const item of content[collection].filter(entry => !entry.visibility || entry.visibility === 'published')) {
      addRecord(recordType, item.id, item);
    }
  }
  return baseline;
}

async function main() {
  if (process.argv.includes('--clean')) {
    await rm(output, { force: true });
    return;
  }
  const content = await loadContent();
  const baseline = createPublicBaseline(content);
  await writeFile(output, `export const publicBaseline = ${JSON.stringify(baseline)};\n`);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  await main();
  if (!process.argv.includes('--clean')) console.log('Prepared the published-content baseline for the owner dashboard.');
}
