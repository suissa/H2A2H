#!/usr/bin/env node

const REQUIRED_PATTERN = 'refs/tags/v*';
const REQUIRED_RULES = ['deletion', 'update'];

export function evaluateTagProtection(rulesets) {
  if (!Array.isArray(rulesets)) {
    return { ok: false, reason: 'ruleset response must be an array' };
  }

  const candidates = rulesets.filter((ruleset) =>
    ruleset?.target === 'tag'
    && ruleset?.enforcement === 'active'
    && ruleset?.conditions?.ref_name?.include?.includes(REQUIRED_PATTERN)
    && Array.isArray(ruleset?.conditions?.ref_name?.exclude)
    && ruleset.conditions.ref_name.exclude.length === 0,
  );

  for (const ruleset of candidates) {
    const ruleTypes = new Set((ruleset.rules ?? []).map((rule) => rule?.type));
    if (REQUIRED_RULES.some((type) => !ruleTypes.has(type))) continue;
    if (Array.isArray(ruleset.bypass_actors) && ruleset.bypass_actors.length > 0) continue;

    return {
      ok: true,
      evidence: {
        id: ruleset.id,
        name: ruleset.name,
        target: ruleset.target,
        enforcement: ruleset.enforcement,
        include: ruleset.conditions.ref_name.include,
        exclude: ruleset.conditions.ref_name.exclude,
        rules: [...ruleTypes].sort(),
        bypass_actors: Array.isArray(ruleset.bypass_actors) ? 0 : 'not-disclosed',
      },
    };
  }

  return {
    ok: false,
    reason: `no active tag ruleset protects ${REQUIRED_PATTERN} from update and deletion without declared bypass actors`,
  };
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

  const summaries = await githubJson(`/repos/${repository}/rulesets?includes_parents=true&per_page=100`, token);
  const details = await Promise.all(summaries.map((ruleset) =>
    githubJson(`/repos/${repository}/rulesets/${ruleset.id}?includes_parents=true`, token),
  ));
  const result = evaluateTagProtection(details);
  if (!result.ok) {
    console.error(`Stable release blocked: ${result.reason}`);
    process.exitCode = 1;
    return;
  }
  console.log(`Immutable tag ruleset verified: ${JSON.stringify(result.evidence)}`);
}

if (process.argv[1]?.endsWith('verify-tag-ruleset.mjs')) await main();
