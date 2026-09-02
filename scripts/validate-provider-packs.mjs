import { readdir, readFile } from 'node:fs/promises';
import { resolve, relative } from 'node:path';
import { pathToFileURL } from 'node:url';
import Ajv2020 from 'ajv/dist/2020.js';
import addFormats from 'ajv-formats';

const ROOT = resolve(process.cwd());
const PROVIDERS_DIR = resolve(ROOT, 'providers');
const SCHEMA_PATH = resolve(ROOT, 'schemas/employee-provider-pack.schema.json');
const CATALOG_PATH = resolve(ROOT, 'capabilities/employee-tools/catalog.json');

function fail(message) {
  throw new Error(`Provider Pack validation failed: ${message}`);
}

async function readJson(path) {
  try {
    return JSON.parse(await readFile(path, 'utf8'));
  } catch (error) {
    fail(`${relative(ROOT, path)} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
}

export async function discoverProviderManifests(directory = PROVIDERS_DIR) {
  const found = [];
  async function visit(current) {
    const entries = await readdir(current, { withFileTypes: true });
    for (const entry of entries) {
      const path = resolve(current, entry.name);
      if (entry.isDirectory()) await visit(path);
      else if (entry.isFile() && entry.name === 'manifest.json') found.push(path);
    }
  }
  await visit(directory);
  return found.sort();
}

export function buildCapabilityIndex(catalog) {
  const defaults = catalog.defaults ?? {};
  const index = new Map();
  for (const [department, definition] of Object.entries(catalog.departments ?? {})) {
    const sideEffects = new Set(definition.side_effects ?? []);
    for (const canonicalLabel of definition.tools ?? []) {
      if (index.has(canonicalLabel)) fail(`capability ${canonicalLabel} is declared by more than one department`);
      index.set(canonicalLabel, {
        canonical_label: canonicalLabel,
        department,
        domain: canonicalLabel.split('.')[0],
        side_effect: sideEffects.has(canonicalLabel),
        provider_required: defaults.provider_required !== false,
        provider_bindings: [...(defaults.provider_bindings ?? [])],
      });
    }
  }
  return index;
}

export function validateProviderManifestSemantics(manifest, capabilityIndex) {
  const allowedDomains = new Set(manifest.capability_domains ?? [manifest.domain]);
  if (allowedDomains.size === 0) fail(`${manifest.canonical_label} declares no capability domains`);

  for (const label of manifest.capabilities) {
    const capability = capabilityIndex.get(label);
    if (!capability) fail(`${manifest.canonical_label} references unknown capability ${label}`);
    if (!capability.provider_required) fail(`${manifest.canonical_label} cannot bind internal capability ${label}`);
    if (!allowedDomains.has(capability.domain)) {
      fail(`${manifest.canonical_label} capability ${label} belongs to undeclared domain ${capability.domain}`);
    }
    if (!capability.provider_bindings.includes(manifest.provider_kind)) {
      fail(`${manifest.canonical_label} capability ${label} does not permit provider kind ${manifest.provider_kind}`);
    }
  }

  if (manifest.provider_kind === 'http-json') {
    if (!manifest.binding) fail(`${manifest.canonical_label} HTTP pack requires binding`);
    const capabilityLabels = [...manifest.capabilities].sort();
    const routeLabels = Object.keys(manifest.binding.routes ?? {}).sort();
    if (JSON.stringify(capabilityLabels) !== JSON.stringify(routeLabels)) {
      fail(`${manifest.canonical_label} HTTP routes must exactly cover declared capabilities`);
    }
    for (const [label, path] of Object.entries(manifest.binding.routes)) {
      if (typeof path !== 'string' || !path.startsWith('/')) fail(`${manifest.canonical_label} route ${label} must start with /`);
    }
    if (manifest.binding.authorization?.type !== 'bearer') {
      fail(`${manifest.canonical_label} HTTP authorization must be bearer`);
    }
    const declaredSecrets = new Set(manifest.secrets.map((secret) => secret.name));
    const authorizationSecret = manifest.binding.authorization?.secret;
    if (!declaredSecrets.has(authorizationSecret)) {
      fail(`${manifest.canonical_label} authorization references undeclared secret ${authorizationSecret}`);
    }
    const declaredConfig = new Set(Object.keys(manifest.config_schema.properties ?? {}));
    for (const configKey of Object.keys(manifest.binding.config_headers ?? {})) {
      if (!declaredConfig.has(configKey)) {
        fail(`${manifest.canonical_label} config header references undeclared config ${configKey}`);
      }
    }
  } else if (manifest.binding) {
    fail(`${manifest.canonical_label} declares HTTP binding for non-HTTP provider kind ${manifest.provider_kind}`);
  }
}

export async function validateAllProviderPacks({ providersDir = PROVIDERS_DIR, schemaPath = SCHEMA_PATH, catalogPath = CATALOG_PATH } = {}) {
  const [schema, catalog, paths] = await Promise.all([
    readJson(schemaPath),
    readJson(catalogPath),
    discoverProviderManifests(providersDir),
  ]);
  if (paths.length === 0) fail('no providers/**/manifest.json files discovered');

  const ajv = new Ajv2020({ allErrors: true, strict: true });
  addFormats(ajv);
  const validateSchema = ajv.compile(schema);
  const capabilityIndex = buildCapabilityIndex(catalog);
  const identities = new Map();
  let capabilityBindings = 0;

  for (const path of paths) {
    const manifest = await readJson(path);
    if (!validateSchema(manifest)) {
      const details = (validateSchema.errors ?? [])
        .map((error) => `${error.instancePath || '/'} ${error.message ?? 'invalid'}`)
        .join('; ');
      fail(`${relative(ROOT, path)} violates employee-provider-pack schema: ${details}`);
    }
    const existing = identities.get(manifest.canonical_label);
    if (existing) {
      fail(`duplicate canonical label ${manifest.canonical_label}: ${relative(ROOT, existing)} and ${relative(ROOT, path)}`);
    }
    identities.set(manifest.canonical_label, path);
    validateProviderManifestSemantics(manifest, capabilityIndex);
    capabilityBindings += manifest.capabilities.length;
  }

  return { packs: paths.length, capabilityBindings, paths };
}

async function main() {
  const result = await validateAllProviderPacks();
  console.log(`Provider Pack catalog valid: ${result.packs} packs, ${result.capabilityBindings} declared capability bindings.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error);
    process.exitCode = 1;
  });
}
