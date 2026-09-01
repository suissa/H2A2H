import fs from 'node:fs/promises';

const token = process.env.GITHUB_TOKEN;
const repo = process.env.GITHUB_REPOSITORY;
if (!token || !repo) throw new Error('GITHUB_TOKEN and GITHUB_REPOSITORY are required');

const catalog = JSON.parse(await fs.readFile('employees/catalog.json', 'utf8'));
const [owner, name] = repo.split('/');
const api = 'https://api.github.com';
const headers = {
  Accept: 'application/vnd.github+json',
  Authorization: `Bearer ${token}`,
  'X-GitHub-Api-Version': '2022-11-28'
};

async function request(path, init = {}) {
  const res = await fetch(`${api}${path}`, { ...init, headers: { ...headers, ...(init.headers ?? {}) } });
  if (!res.ok) throw new Error(`${init.method ?? 'GET'} ${path}: ${res.status} ${await res.text()}`);
  return res.status === 204 ? null : res.json();
}

const existing = new Set();
for (let page = 1; ; page++) {
  const items = await request(`/repos/${owner}/${name}/issues?state=all&per_page=100&page=${page}`);
  if (!items.length) break;
  for (const item of items) {
    if (!item.pull_request) existing.add(item.title);
  }
}

let created = 0;
for (const employee of catalog) {
  const title = `[EMPLOYEE] Implement ${employee.name} Agent`;
  if (existing.has(title)) {
    console.log(`exists: ${title}`);
    continue;
  }

  const body = [
    `Implement the H2A2H **${employee.name} Agent** from \`${employee.path}/\`.`,
    '',
    `Canonical identity: \`${employee.canonical_label}\``,
    '',
    '## Required implementation',
    '',
    '- [ ] Load and validate `agent-card.json` as the initial A2A discovery identity.',
    '- [ ] Load `h2a2h.employee.yml` as the role/authority contract.',
    '- [ ] Bind every declared Intent to an implementation without hidden role configuration.',
    '- [ ] Implement only the declared tool allowlist and enforce tool permissions.',
    '- [ ] Validate OpenDelegation before every side effect.',
    '- [ ] Resolve transports/channels from OpenEntityChannels/OpenIntent, not ad hoc role code.',
    '- [ ] Preserve `correlation_id`, causation, provenance and responsibility chain.',
    '- [ ] Enforce Human approval triggers and fail closed outside delegated scope.',
    '- [ ] Produce Proof-of-Human-Return for Human-boundary results.',
    '- [ ] Add unit, conformance and end-to-end tests for one successful and one denied/escalated scenario.',
    '- [ ] Prove interoperability without implementation-specific coupling.',
    '',
    '## Definition of Done',
    '',
    'The Agent can be discovered through its A2A Agent Card, invoked only inside valid H2A2H delegation, use only declared tools, complete role-specific work, preserve auditability/responsibility, and return evidence to the accountable Human.'
  ].join('\n');

  await request(`/repos/${owner}/${name}/issues`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ title, body })
  });
  created++;
  console.log(`created: ${title}`);
}
console.log(`employee issues created: ${created}`);
