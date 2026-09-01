import fs from 'node:fs/promises';
import path from 'node:path';

const catalog = JSON.parse(await fs.readFile('employees/catalog.json', 'utf8'));
const sideEffectOperations = new Set(['write', 'execute', 'manage', 'request', 'publish', 'record', 'prepare']);
let changedFiles = 0;

function sideEffectFor(canonicalLabel) {
  const operation = canonicalLabel.split('.').at(-1);
  return sideEffectOperations.has(operation);
}

for (const entry of catalog) {
  const filename = path.join(entry.path, 'h2a2h.employee.yml');
  const document = JSON.parse(await fs.readFile(filename, 'utf8'));
  let changed = false;
  for (const tool of document.employee_agent?.tools ?? []) {
    if (tool.permission !== 'allow') continue;
    const expected = sideEffectFor(tool.name);
    if (tool.side_effect !== expected) {
      tool.side_effect = expected;
      changed = true;
    }
  }
  if (changed) {
    await fs.writeFile(filename, `${JSON.stringify(document, null, 2)}\n`);
    changedFiles += 1;
  }
}

console.log(`normalized Employee Tool side effects in ${changedFiles} contract file(s)`);
