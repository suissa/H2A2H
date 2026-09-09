import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'package-lock.json',
  'SPECIFICATION.md',
  'schemas/h2a2h-v1.schema.json',
  'schemas/h2a2h-agentic-generalization-v1.schema.json',
  'schemas/h2a2h-crypto-suite-v0.1.schema.json',
  'spec/terminology.md',
  'spec/lifecycle.md',
  'spec/openintent-integration.md',
  'spec/opendelegation.md',
  'spec/openentitychannels.md',
  'spec/proof-of-human-return.md',
  'spec/identity-responsibility.md',
  'spec/envelope.md',
  'spec/security.md',
  'spec/audit-provenance.md',
  'spec/interop-mcp-a2a.md',
  'spec/versioning.md',
  'spec/agentic-generalization-profile.md',
  'spec/verifiable-action-authorization.md',
  'docs/specs/H2A2H-Crypto-Suite.md',
  'docs/specs/H2A2H-Crypto-Threat-Model.md',
  'docs/specs/H2A2H-Crypto-Implementation.md',
  'test-vectors/h2a2h-crypto-suite-v0.1.json',
  'formal/H2A2H.tla',
  'independent/reference-b/index.mjs',
  'independent/reference-b/interop.test.mjs',
  'independent/reference-b/manifest.json',
  'src/sdk.ts',
  'src/runtime.ts',
  'src/channels.ts',
  'src/audit.ts',
  'src/security.ts',
  'src/crypto-suite.ts',
  'src/healing.ts',
  'src/delegation-session.ts',
  'src/capability-negotiation.ts',
  'src/vaal.ts',
  'src/intent-trace.ts'
];

const failures = [];

for (const path of requiredFiles) {
  try {
    await access(path);
  } catch {
    failures.push(`missing required artifact: ${path}`);
  }
}

const pkg = JSON.parse(await readFile('package.json', 'utf8'));
const versionMatch = /^(\d+)\.(\d+)\.(\d+)(?:-[0-9A-Za-z.-]+)?$/.exec(pkg.version);
if (!versionMatch) failures.push(`package version is not semantic: ${pkg.version}`);
const stable = versionMatch ? Number(versionMatch[1]) >= 1 : false;

const lock = JSON.parse(await readFile('package-lock.json', 'utf8'));
if (lock.lockfileVersion !== 3) failures.push('package-lock.json must use lockfileVersion 3');
if (lock.version !== pkg.version || lock.packages?.['']?.version !== pkg.version) {
  failures.push('package-lock.json root version must match package.json');
}

const independent = JSON.parse(await readFile('independent/reference-b/manifest.json', 'utf8'));
if (independent.version !== pkg.version) failures.push('Reference B version must match package version');
const independentVersion = (await readFile('independent/reference-b/VERSION', 'utf8')).trim();
if (independentVersion !== pkg.version) failures.push('Reference B VERSION must match package version');
if (independent.shared_runtime_code !== false) failures.push('Reference B must declare shared_runtime_code=false');
if (!Array.isArray(independent.channels) || independent.channels.length < 2) {
  failures.push('Reference B must expose at least two interoperability channel profiles');
}

const schema = JSON.parse(await readFile('schemas/h2a2h-v1.schema.json', 'utf8'));
if (schema.$id !== 'https://h2a2h.dev/schemas/h2a2h-v1.schema.json') {
  failures.push('normative v1 schema $id is incorrect');
}

const generalizationSchema = JSON.parse(
  await readFile('schemas/h2a2h-agentic-generalization-v1.schema.json', 'utf8'),
);
if (generalizationSchema.$id !== 'https://h2a2h.dev/schemas/h2a2h-agentic-generalization-v1.schema.json') {
  failures.push('agentic generalization schema $id is incorrect');
}

const specification = await readFile('SPECIFICATION.md', 'utf8');
for (const concept of ['OpenIntent', 'OpenDelegation', 'OpenEntityChannels', 'Proof-of-Human-Return']) {
  if (!specification.includes(concept)) failures.push(`normative specification does not reference ${concept}`);
}

const generalizationSpec = await readFile('spec/agentic-generalization-profile.md', 'utf8');
for (const concept of ['Capability Negotiation', 'Entity Discovery', 'ActionCommitment', 'Intent Transition Trace']) {
  if (!generalizationSpec.includes(concept)) failures.push(`agentic generalization profile does not reference ${concept}`);
}

const vaalSpec = await readFile('spec/verifiable-action-authorization.md', 'utf8');
for (const concept of ['DelegationMandate', 'ActionMandate', 'ActionReceipt', 'ALLOW', 'DENY', 'CHALLENGE']) {
  if (!vaalSpec.includes(concept)) failures.push(`VAAL specification does not reference ${concept}`);
}

const readme = await readFile('README.md', 'utf8');
for (const link of [
  './SPECIFICATION.md',
  './schemas/h2a2h-v1.schema.json',
  './independent/reference-b',
  './release/v1.0.0.md'
]) {
  if (!readme.includes(link)) failures.push(`README is missing release entry-point link ${link}`);
}

if (stable) {
  const normativeFiles = requiredFiles.filter((path) =>
    path === 'SPECIFICATION.md' || path.startsWith('spec/'),
  );
  for (const path of normativeFiles) {
    const content = await readFile(path, 'utf8');
    if (/^Status:.*draft/im.test(content)) {
      failures.push(`stable release cannot include normative draft: ${path}`);
    }
  }

  const checklist = await readFile('release/v1.0.0.md', 'utf8');
  const unchecked = checklist.match(/^- \[ \] .+$/gm) ?? [];
  if (unchecked.length > 0) {
    failures.push(`stable release has ${unchecked.length} unchecked promotion criteria`);
  }
  if (/pre-1\.0/i.test(readme)) failures.push('stable release README still declares pre-1.0 status');
}

if (failures.length > 0) {
  console.error(`H2A2H ${pkg.version} release gate failed:`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`H2A2H ${pkg.version} release gate passed (${requiredFiles.length} required artifacts verified).`);
