import { createPrivateKey, createPublicKey } from 'node:crypto';
import {
  H2A2H_CRYPTO_SUITE_V0_1,
  ROOT_IDENTITY_ARGON2ID_V0_1,
  createCryptoEnvelope,
  deriveArtifactId,
  deriveBranchId,
  deriveDomainKey,
  deriveRootIdentitySeed,
} from '../dist/index.js';

const b64 = (value) => Buffer.from(value).toString('base64url');
const secret = Uint8Array.from({ length: 32 }, (_, index) => index);
const rootSalt = Uint8Array.from({ length: 16 }, (_, index) => 0xa0 + index);
const domainSalt = Uint8Array.from({ length: 16 }, (_, index) => 0xb0 + index);
const privateSeed = Uint8Array.from({ length: 32 }, (_, index) => index + 1);
const privateKey = createPrivateKey({
  key: Buffer.concat([
    Buffer.from('302e020100300506032b657004220420', 'hex'),
    Buffer.from(privateSeed),
  ]),
  format: 'der',
  type: 'pkcs8',
});
const publicKey = createPublicKey(privateKey);

const payload = {
  action: 'approve',
  amount: 1250,
  currency: 'BRL',
  intent: 'Commerce.PurchaseProducts',
};
const rootSeed = deriveRootIdentitySeed(secret, rootSalt);
const domainKey = deriveDomainKey(rootSeed, {
  purpose: 'signing',
  context: 'agent:personal-shopper:key:1',
  salt: domainSalt,
});
const artifactId = deriveArtifactId(payload);
const branchInput = {
  parent_id: artifactId,
  canonical_label: 'Commerce.PurchaseProducts.Approved',
  ordinal: 1,
  state: { approved: true, amount: 1250 },
};
const envelopeOptions = {
  private_key: privateKey,
  key_id: 'key:test-ed25519:1',
  issuer: 'entity:test-human',
  artifact_id: artifactId,
  purpose: 'h2a2h.test-vector',
  created_at: new Date('2026-09-09T12:00:00.000Z'),
  expires_at: new Date('2026-09-10T12:00:00.000Z'),
};

const vectors = {
  suite: H2A2H_CRYPTO_SUITE_V0_1,
  encoding: 'base64url-no-padding',
  warning: 'TEST MATERIAL ONLY. Never use these secrets or keys in production.',
  root_identity: {
    secret: b64(secret),
    salt: b64(rootSalt),
    parameters: ROOT_IDENTITY_ARGON2ID_V0_1,
    output: b64(rootSeed),
  },
  domain_key: {
    root_seed: b64(rootSeed),
    salt: b64(domainSalt),
    purpose: 'signing',
    context: 'agent:personal-shopper:key:1',
    length: 32,
    output: b64(domainKey),
  },
  artifact: {
    input: payload,
    id: artifactId,
  },
  branch: {
    input: branchInput,
    id: deriveBranchId(branchInput),
  },
  envelope: {
    private_key_seed: b64(privateSeed),
    public_key_spki: b64(publicKey.export({ format: 'der', type: 'spki' })),
    payload,
    options: {
      key_id: envelopeOptions.key_id,
      issuer: envelopeOptions.issuer,
      artifact_id: envelopeOptions.artifact_id,
      purpose: envelopeOptions.purpose,
      created_at: envelopeOptions.created_at.toISOString(),
      expires_at: envelopeOptions.expires_at.toISOString(),
    },
    output: createCryptoEnvelope(payload, envelopeOptions),
  },
};

process.stdout.write(`${JSON.stringify(vectors, null, 2)}\n`);
