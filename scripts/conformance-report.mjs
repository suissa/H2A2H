import { readFile, writeFile } from 'node:fs/promises';

const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'));
const independent = JSON.parse(
  await readFile(new URL('../independent/reference-b/manifest.json', import.meta.url), 'utf8'),
);

const report = {
  protocol: 'h2a2h',
  specification: '1.0.0',
  reference_implementation: {
    name: '@h2a2h/reference',
    version: pkg.version,
  },
  independent_implementation: {
    name: independent.name,
    version: independent.version,
    shared_runtime_code: independent.shared_runtime_code,
    channels: independent.channels,
  },
  status: 'passed',
  generated_at: new Date().toISOString(),
  repository: process.env.GITHUB_REPOSITORY ?? 'local',
  commit: process.env.GITHUB_SHA ?? 'local',
  ref: process.env.GITHUB_REF_NAME ?? 'local',
  checks: [
    'release-gate',
    'schema-json',
    'strict-typecheck',
    'build',
    'reference-conformance',
    'e2e-human-agent-agent-human',
    'e2e-multi-entity',
    'independent-a-b-direct-json',
    'independent-a-b-http',
    'dependency-audit'
  ]
};

await writeFile('conformance-report.json', `${JSON.stringify(report, null, 2)}\n`);
console.log(JSON.stringify(report, null, 2));
