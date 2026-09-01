import fs from 'node:fs/promises';
import path from 'node:path';

const catalogPath = 'employees/catalog.json';
const catalog = JSON.parse(await fs.readFile(catalogPath, 'utf8'));

function pascal(slug) {
  const value = slug.split('-').filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1)).join('');
  return value.endsWith('Agent') ? value : `${value}Agent`;
}

function canonical(slug) {
  return `Enterprise.Employee.${pascal(slug)}`;
}

function agentName(roleName) {
  return roleName.endsWith('Agent') ? roleName : `${roleName} Agent`;
}

for (const employee of catalog) {
  employee.canonical_label = canonical(employee.slug);

  const dir = path.join('employees', employee.department, employee.slug);
  const cardPath = path.join(dir, 'agent-card.json');
  const profilePath = path.join(dir, 'h2a2h.employee.yml');

  const card = JSON.parse(await fs.readFile(cardPath, 'utf8'));
  card.name = agentName(employee.name);
  await fs.writeFile(cardPath, `${JSON.stringify(card, null, 2)}\n`);

  const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
  const label = canonical(employee.slug);
  profile.employee_agent.identity.canonical_label = label;
  for (const intent of profile.employee_agent.intents) {
    const suffix = intent.canonical_label.split('.').at(-1);
    intent.canonical_label = `${label}.${suffix}`;
  }
  await fs.writeFile(profilePath, `${JSON.stringify(profile, null, 2)}\n`);
}

await fs.writeFile(catalogPath, `${JSON.stringify(catalog, null, 2)}\n`);
console.log(`normalized ${catalog.length} employee Agent identities`);
