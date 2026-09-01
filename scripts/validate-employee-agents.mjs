import fs from 'node:fs/promises';
import path from 'node:path';

const catalog = JSON.parse(await fs.readFile('employees/catalog.json', 'utf8'));
const errors = [];

function pascal(slug) {
  const value = slug.split('-').filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1)).join('');
  return value.endsWith('Agent') ? value : `${value}Agent`;
}
function canonical(slug) { return `Enterprise.Employee.${pascal(slug)}`; }
function agentName(name) { return name.endsWith('Agent') ? name : `${name} Agent`; }

if (catalog.length !== 105) errors.push(`expected 105 employee archetypes, got ${catalog.length}`);

for (const field of ['slug','path','canonical_label']) {
  const values = catalog.map(x => x[field]);
  const duplicate = values.find((value, index) => values.indexOf(value) !== index);
  if (duplicate) errors.push(`duplicate ${field}: ${duplicate}`);
}

for (const employee of catalog) {
  const expectedLabel = canonical(employee.slug);
  if (employee.canonical_label !== expectedLabel) errors.push(`${employee.slug}: catalog canonical_label must be ${expectedLabel}`);

  const expectedPath = `employees/${employee.department}/${employee.slug}`;
  if (employee.path !== expectedPath) errors.push(`${employee.slug}: path must be ${expectedPath}`);

  const cardPath = path.join(employee.path, 'agent-card.json');
  const profilePath = path.join(employee.path, 'h2a2h.employee.yml');
  try {
    const card = JSON.parse(await fs.readFile(cardPath, 'utf8'));
    if (card.name !== agentName(employee.name)) errors.push(`${employee.slug}: invalid Agent Card name`);
    if (!Array.isArray(card.supportedInterfaces) || card.supportedInterfaces.length === 0) errors.push(`${employee.slug}: supportedInterfaces required`);
    for (const iface of card.supportedInterfaces ?? []) {
      for (const field of ['url','protocolBinding','protocolVersion']) if (!iface[field]) errors.push(`${employee.slug}: interface missing ${field}`);
    }
    if (!Array.isArray(card.skills) || card.skills.length === 0) errors.push(`${employee.slug}: at least one A2A skill required`);
  } catch (error) {
    errors.push(`${employee.slug}: unreadable Agent Card (${error.message})`);
  }

  try {
    const profile = JSON.parse(await fs.readFile(profilePath, 'utf8'));
    const role = profile.employee_agent;
    if (role?.identity?.canonical_label !== expectedLabel) errors.push(`${employee.slug}: profile canonical_label mismatch`);
    if (!role?.identity?.a2a_agent_card) errors.push(`${employee.slug}: missing A2A identity reference`);
    if (role?.authority?.delegation_required !== true) errors.push(`${employee.slug}: OpenDelegation must be required`);
    if (!Array.isArray(role?.tools) || role.tools.length === 0) errors.push(`${employee.slug}: tool contract required`);
    if (!role.tools.some(x => x.name === 'h2a2h.delegation.validate')) errors.push(`${employee.slug}: delegation validator tool required`);
    if (!role.tools.some(x => x.name === 'h2a2h.pohr.issue')) errors.push(`${employee.slug}: PoHR tool required`);
    if (!role?.channels?.h2a2h?.includes('OpenEntityChannels/OpenIntent')) errors.push(`${employee.slug}: H2A2H channels must be externally resolved`);
    if (!Array.isArray(role?.acceptance_tests) || role.acceptance_tests.length < 5) errors.push(`${employee.slug}: acceptance tests incomplete`);
  } catch (error) {
    errors.push(`${employee.slug}: unreadable H2A2H employee contract (${error.message})`);
  }
}

if (errors.length) {
  console.error(errors.map(x => `- ${x}`).join('\n'));
  process.exit(1);
}
console.log(`Employee Agent catalog valid: ${catalog.length} archetypes, ${catalog.length * 2} role contracts.`);
