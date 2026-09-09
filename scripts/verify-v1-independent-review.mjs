#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const SCOPE_PATH = 'review/v1/scope.json';
const ATTESTATION_PATH = 'review/v1/attestation.json';
const SCHEMA_PATH = 'schemas/h2a2h-v1-review-attestation.schema.json';

async function readJson(root, path) {
  return JSON.parse(await readFile(resolve(root, path), 'utf8'));
}

export async function computeScopeDigest(root = '.') {
  const scope = await readJson(root, SCOPE_PATH);
  if (scope?.scope_id !== 'h2a2h-v1-independent-review' || !Array.isArray(scope.artifacts)) {
    throw new Error('invalid independent-review scope');
  }
  const paths = [...scope.artifacts].sort();
  if (paths.length === 0 || new Set(paths).size !== paths.length) {
    throw new Error('review scope must contain unique artifacts');
  }

  const hash = createHash('sha256');
  for (const path of paths) {
    if (typeof path !== 'string' || path.startsWith('/') || path.split('/').includes('..')) {
      throw new Error(`unsafe review-scope path: ${path}`);
    }
    const content = await readFile(resolve(root, path));
    const pathBytes = Buffer.from(path, 'utf8');
    hash.update(Buffer.from(`${pathBytes.byteLength}:`, 'utf8'));
    hash.update(pathBytes);
    hash.update(Buffer.from(`${content.byteLength}:`, 'utf8'));
    hash.update(content);
  }
  return `sha256-${hash.digest('hex')}`;
}

export async function validateLocalAttestation(attestation, owner, root = '.') {
  const schema = await readJson(root, SCHEMA_PATH);
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  addFormats(ajv);
  const validate = ajv.compile(schema);
  if (!validate(attestation)) {
    return { ok: false, reason: `attestation schema failed: ${JSON.stringify(validate.errors)}` };
  }
  if (attestation.reviewer.github_login.toLowerCase() === owner.toLowerCase()) {
    return { ok: false, reason: 'repository owner cannot provide the independent review' };
  }
  if (attestation.decision !== 'approved') {
    return { ok: false, reason: 'independent review decision is not approved' };
  }
  const blocking = attestation.findings.filter((finding) =>
    ['critical', 'high'].includes(finding.severity)
    && (finding.status !== 'resolved' || finding.conformance_tests.length === 0),
  );
  if (blocking.length > 0) {
    return { ok: false, reason: `unresolved critical/high findings: ${blocking.map((finding) => finding.id).join(', ')}` };
  }
  const digest = await computeScopeDigest(root);
  if (attestation.scope_digest !== digest) {
    return { ok: false, reason: `review scope changed: expected ${attestation.scope_digest}, computed ${digest}` };
  }
  return { ok: true, digest };
}

async function githubJson(path, token) {
  const response = await fetch(`https://api.github.com${path}`, {
    headers: {
      Accept: 'application/vnd.github+json',
      Authorization: `Bearer ${token}`,
      'X-GitHub-Api-Version': '2026-03-10',
      'User-Agent': 'H2A2H-release-gate',
    },
  });
  if (!response.ok) throw new Error(`GitHub API ${response.status} for ${path}`);
  return response.json();
}

async function main() {
  const repository = process.env.GITHUB_REPOSITORY;
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  if (!repository || !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository)) {
    throw new Error('GITHUB_REPOSITORY must identify owner/repository');
  }
  if (!token) throw new Error('GH_TOKEN or GITHUB_TOKEN is required');

  const owner = process.env.GITHUB_REPOSITORY_OWNER || repository.split('/')[0];
  const attestation = await readJson('.', ATTESTATION_PATH);
  const local = await validateLocalAttestation(attestation, owner);
  if (!local.ok) throw new Error(`Stable release blocked: ${local.reason}`);

  const pull = await githubJson(`/repos/${repository}/pulls/${attestation.review_pull_request}`, token);
  const reviews = await githubJson(
    `/repos/${repository}/pulls/${attestation.review_pull_request}/reviews?per_page=100`,
    token,
  );
  if (pull.merged !== true || pull.head?.sha !== attestation.review_commit_sha) {
    throw new Error('Stable release blocked: review PR is not merged at the attested head commit');
  }
  const approval = reviews.find((review) =>
    review?.state === 'APPROVED'
    && review?.user?.login?.toLowerCase() === attestation.reviewer.github_login.toLowerCase()
    && review?.commit_id === attestation.review_commit_sha,
  );
  if (!approval) {
    throw new Error('Stable release blocked: attested independent GitHub approval was not found');
  }

  console.log(`Independent v1 review verified: reviewer=${attestation.reviewer.github_login} digest=${local.digest} review=${approval.html_url}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) await main();
