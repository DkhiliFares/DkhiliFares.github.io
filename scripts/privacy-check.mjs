import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const forbidden = [
  'dkhili.fares2002@gmail.com',
  'Listed in CV',
  'Original certificates and verification IDs were not supplied'
];

async function textFiles(directory, found = []) {
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    if (entry.name.startsWith('.git') || entry.name === 'node_modules' || entry.name === '.research') continue;
    const target = path.join(directory, entry.name);
    if (entry.isDirectory()) await textFiles(target, found);
    else if (entry.name !== 'privacy-check.mjs' && /\.(json|mjs|js|ts|tsx|html|md|yml|yaml)$/.test(entry.name)) found.push(target);
  }
  return found;
}

const sourceFiles = await textFiles(root);
const leaks = [];
for (const file of sourceFiles) {
  const text = await readFile(file, 'utf8');
  for (const secret of forbidden) if (text.includes(secret)) leaks.push(`${path.relative(root, file)}: ${secret}`);
}
try {
  await stat(path.join(root, 'dist'));
  const publicFiles = await textFiles(path.join(root, 'dist'));
  for (const file of publicFiles) {
    const text = await readFile(file, 'utf8');
    for (const secret of forbidden) if (text.includes(secret)) leaks.push(`${path.relative(root, file)}: ${secret}`);
  }
} catch {}
if (leaks.length) throw new Error(`Privacy leak check failed:\n${leaks.join('\n')}`);
console.log('Privacy leak check passed.');
