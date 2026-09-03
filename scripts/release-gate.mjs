import { access, readFile } from 'node:fs/promises';

const requiredFiles = [
  'SPECIFICATION.md',
  'schemas/h2a2h-v1.schema.json',
  'schemas/h2a2h-agentic-generalization-v1.schema.json',
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
  'formal/H2A2H.tla',
  'independent/reference-b/index.mjs',
  'independent/reference-b/interop.test.mjs',
  'independent/reference-b/manifest.json',
  'src/sdk.ts',
  'src/runtime.ts',
  'src/channels.ts',
  'src/audit.ts',
  'src/security.ts',
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
if (pkg.version !== '1.0.0') failures.push(`package version must be 1.0.0, found ${pkg.version}`);

const independent = JSON.parse(await readFile('independent/reference-b/manifest.json', 'utf8'));
if (independent.version !== '1.0.0') failures.push('Reference B must declare version 1.0.0');
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

if (failures.length > 0) {
  console.error('H2A2H v1.0 release gate failed:');
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log(`H2A2H v1.0 release gate passed (${requiredFiles.length} required artifacts verified).`);
