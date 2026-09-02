# Domain Capability Profiles for the Agentic Web

Status: Exploratory vNext research note. Non-normative.

## Thesis

Commerce is only one family of actions performed on the Web, yet commerce and payments currently have a disproportionately mature agentic protocol stack: UCP, ACP, AP2, payment handlers and adjacent legal-context work.

The correct response is not to create one isolated protocol for every industry. That would reproduce the integration fragmentation that MCP, A2A, AG-UI and UCP are trying to remove.

H2A2H should instead define **Domain Capability Profiles (DCPs)** built from reusable horizontal action capabilities.

A Domain Capability Profile does not replace an industry's established data standards. It defines the semantic agentic lifecycle around those standards: discovery, Intent, constraints, delegated authority, negotiation, execution, observation, evidence, correction, cancellation, escalation and Human return.

## Why horizontal capabilities first

Most user goals are compositions of recurring action families rather than industry-specific operations.

Examples:

- buying something = discover + compare + select + authorize + transact + fulfill;
- booking a doctor = discover + schedule + identify + consent + share + confirm;
- applying for a government benefit = discover + determine-eligibility + submit + provide-evidence + track + correct + appeal;
- applying for a job = discover + qualify + submit + schedule + consent + track + negotiate;
- performing research = discover + retrieve + cite + compare + reproduce + publish;
- customer support = identify + diagnose + request-evidence + act + track + escalate + resolve;
- personal assistant work = communicate + schedule + monitor + retrieve + submit + approve + notify.

This means the most reusable standards are the verbs shared by many domains.

## Proposed horizontal capability families

### 1. Discovery and Retrieval

Canonical actions:

- `discover`
- `search`
- `lookup`
- `retrieve`
- `compare`
- `cite`
- `verify_source`
- `subscribe_to_source`

Missing agentic semantics today include evidence requirements, freshness, provenance, contradictions, confidence, source constraints and the ability to continue a research task across providers while preserving the user's Intent.

### 2. Communication

Canonical actions:

- `draft`
- `send`
- `reply`
- `forward`
- `request_response`
- `acknowledge`
- `escalate`
- `handoff`

Existing protocols such as SMTP, IMAP/JMAP, Matrix, ActivityPub and vendor messaging APIs move messages, but do not provide a universal semantic contract for an Agent acting under delegated Human authority across channels.

A communication profile should standardize recipient intent, audience, channel constraints, approval thresholds, delivery evidence, Human acknowledgement and escalation.

### 3. Scheduling and Coordination

Canonical actions:

- `get_availability`
- `propose_time`
- `hold_time`
- `accept_time`
- `decline_time`
- `reschedule`
- `cancel`
- `check_in`

Calendar standards describe events and synchronization well, but there is no broadly adopted cross-vendor agentic negotiation profile for multi-party scheduling, temporary holds, preference constraints, authority and Human approval.

### 4. Monitoring, Conditions and Notification

Canonical actions:

- `watch`
- `evaluate_condition`
- `notify`
- `pause_watch`
- `resume_watch`
- `expire_watch`

This is one of the largest unstandardized everyday Agent actions. Webhooks, feeds and pub/sub move events, but the semantic object "watch this condition on my behalf until X, then tell/do Y" lacks a universal interoperable contract.

A watch must contain at least: subject, observable, condition, cadence or event source, validity period, authority, notification target, deduplication policy and termination condition.

### 5. Forms, Applications and Submissions

Canonical actions:

- `start_application`
- `fill`
- `attach_evidence`
- `validate_submission`
- `submit`
- `correct`
- `withdraw`
- `track_status`
- `appeal`

This single horizontal profile can serve government, hiring, education, banking, insurance, healthcare intake, grants and many enterprise workflows.

The Web has form encodings and domain APIs but no common Agent-oriented submission lifecycle with delegated authority, evidence provenance, correction and appeal semantics.

### 6. Approval, Consent and Signature

Canonical actions:

- `request_consent`
- `grant_consent`
- `deny_consent`
- `request_approval`
- `approve`
- `reject`
- `sign`
- `revoke`

OAuth, Verifiable Credentials, digital signatures, AP2 mandates and sector-specific consent standards provide important primitives. H2A2H can supply the missing generic action semantics by binding the proof to an OpenIntent and OpenDelegation scope.

This should be a core cross-domain profile, not recreated independently in every vertical.

### 7. Document and Content Collaboration

Canonical actions:

- `create`
- `edit`
- `comment`
- `suggest_change`
- `review`
- `approve_revision`
- `publish`
- `archive`

File formats, office APIs and version-control systems exist, but cross-application Agent collaboration lacks a standard semantic lifecycle for proposed modifications, authorship, review authority, acceptance, provenance and publication.

### 8. Case Management and Support

Canonical actions:

- `open_case`
- `classify_case`
- `request_information`
- `provide_information`
- `assign`
- `escalate`
- `propose_resolution`
- `accept_resolution`
- `reopen`
- `close_case`

This pattern applies to customer support, insurance claims, public services, healthcare administration, disputes, IT service management and legal matters.

### 9. Negotiation and Decision

Canonical actions:

- `request_options`
- `propose`
- `counter_propose`
- `compare_options`
- `recommend`
- `vote`
- `decide`
- `record_rationale`

Commerce has rich offer/checkout negotiation patterns, but equivalent neutral semantics are missing for hiring, contracts, scheduling, project decisions, procurement, dispute resolution and governance.

### 10. Data Sharing and Portability

Canonical actions:

- `request_data`
- `authorize_access`
- `export`
- `transfer`
- `synchronize`
- `revoke_access`
- `prove_deletion`

The data formats remain domain-specific. The profile standardizes Intent, delegation, purpose, duration, minimization, provenance and revocation across domains.

## Domain profiles to build from the horizontal capabilities

The following table ranks promising collaboration areas. "Gap" means no comparably mature, broadly adopted cross-vendor agentic action protocol was found; it does not mean the domain lacks standards.

| Priority | Domain profile | Existing substrate standards / emerging work | Missing agentic layer |
| --- | --- | --- | --- |
| P0 | Communication | SMTP, IMAP/JMAP, Matrix, ActivityPub, vendor messaging APIs | Cross-channel delegated send/reply/handoff semantics, audience constraints, approval and Human-return evidence |
| P0 | Scheduling | iCalendar, CalDAV, scheduling APIs | Agent negotiation, holds, preference constraints, multi-party approval and commitment lifecycle |
| P0 | Monitoring / Alerts | Webhooks, RSS/Atom, pub/sub, event buses | Portable condition/watch contract, lifecycle, authority, dedupe and trigger-to-action semantics |
| P0 | Forms / Applications | HTML forms, JSON Schema, sector APIs | Universal start/fill/evidence/submit/correct/status/appeal lifecycle |
| P0 | Document Collaboration | Office formats/APIs, Git, CRDT/OT systems | Cross-vendor propose/review/approve/publish semantics with provenance and delegated authority |
| P0 | Case Management / Support | CRM/ITSM APIs and proprietary schemas | Portable case lifecycle, evidence requests, escalation, remedy and Human closure |
| P1 | Government / Public Services | GovStack building blocks, national digital identity stacks, W3C VC/OIDC | Agent-ready eligibility/application/evidence/status/correction/appeal profile across agencies |
| P1 | Education | 1EdTech LTI, OneRoster, Caliper, QTI, Open Badges/CLR, xAPI ecosystems | Agent enrollment, tutoring delegation, learner state portability, assessment consent and credential workflows |
| P1 | Healthcare administration | HL7 FHIR, SMART on FHIR, FHIRcast, DICOM and health identity/consent profiles | Agent appointment, referral, record-request, administrative coordination and scoped delegation. Clinical decision actions require separate high-assurance governance |
| P1 | Employment / Hiring | HR data standards, JobPosting schemas, ATS APIs | Candidate-authorized discovery/application/interview/offer/onboarding lifecycle |
| P1 | Research / Science | DOI/Crossref, ORCID, PROV, RO-Crate, repositories; Agentic Publication Protocol is emerging | End-to-end agentic research lifecycle: evidence retrieval, experiment delegation, reproducibility, review and provenance across institutions |
| P1 | Legal / Administrative Procedure | LegalRuleML, Akoma Ntoso/LegalDocML, e-signature; Legal Context Protocol is emerging for agentic transactions | General representation scope, filing, notice, negotiation, evidence, deadline and appeal semantics outside commerce |
| P2 | Insurance | ACORD and insurer APIs | Agentic quote/policy/claim/evidence/adjustment/appeal lifecycle |
| P2 | Banking / Personal Finance | Open Banking/FAPI, ISO 20022, FDX and payment protocols | Non-payment financial delegation, advisory constraints, account actions, recurring authority and Human approval |
| P2 | Real Estate | RESO and listing/transaction systems | Discovery/viewing/offer/document/inspection/closing agent lifecycle |
| P2 | Social / Reputation | ActivityPub, AT Protocol, WebFinger, credential/reputation systems | Delegated publishing, relationship actions, moderation requests, reputation evidence and portable Agent representation |
| P2 | Physical / IoT | Matter and emerging hardware/agent protocols | H2A2H mapping for Human authority, safety boundaries, proof and cross-device execution rather than a new device transport |

## Areas that are NOT empty

H2A2H should avoid claiming novelty where active standards already exist.

### Commerce

UCP and ACP are active, substantive protocols and should be adopted/bridged rather than reimplemented.

### Travel and hospitality booking

This area is no longer empty. Agentic Booking is explicitly extending A2A and UCP for hotels, restaurants and experiences. IATA/OTA/hospitality standards also provide mature domain substrate data.

The H2A2H opportunity is therefore authority, Human return, cross-domain composition and conformance rather than inventing another booking protocol.

### Research publication

The Agentic Publication Protocol (APP) is emerging around packaging papers, code, data and reproducibility context into agent-readable publication repositories. H2A2H should interoperate with it and focus on the broader research interaction lifecycle.

### Legal context for agentic transactions

The Legal Context Protocol (LCP) is emerging for discoverable legal terms, jurisdiction and dispute context in agentic commerce. A broader legal-workflow profile must not duplicate that scope.

### Generic action governance

There are emerging proposals such as capability-mediation and governed-action protocols. H2A2H should differentiate itself through its explicit Human-to-Agent-to-Human responsibility chain, OpenIntent semantic identity, OpenDelegation and Proof-of-Human-Return instead of merely renaming a generic action RPC protocol.

## Proposed Domain Capability Profile shape

A DCP should use a UCP-like schema-first capability model while remaining domain-neutral.

Each profile SHOULD define:

1. `profile_id` and version;
2. semantic domain;
3. participant Entity roles;
4. capability identifiers;
5. request/response/event schemas;
6. lifecycle/state machine;
7. required Intents and canonical labels;
8. required delegation scopes;
9. Human intervention boundaries;
10. proof/evidence requirements;
11. supported extensions;
12. protocol bindings;
13. channel constraints;
14. security profile requirements;
15. conformance fixtures;
16. domain-standard mappings.

Suggested capability identifiers use URI or reverse-domain governance rather than short global strings, for example:

```text
space.h2a2h.communication.send
space.h2a2h.communication.reply
space.h2a2h.scheduling.propose_time
space.h2a2h.scheduling.reschedule
space.h2a2h.monitoring.watch
space.h2a2h.submission.submit
space.h2a2h.submission.appeal
space.h2a2h.case.escalate
space.h2a2h.research.reproduce
```

These are capability identifiers, not hidden code paths. Their concrete implementation remains selected by configuration and protocol/channel bindings.

## Transport and protocol bindings

A single DCP capability may expose multiple bindings, following the same semantic contract:

- A2A when the provider is an independent Agent;
- MCP when the provider exposes a tool/resource surface;
- REST/OpenAPI for conventional application integration;
- AG-UI for user interaction/events;
- A2UI for renderer-safe UI artifacts;
- OpenEntityChannels for QUIC, NATS, Kafka, RabbitMQ, Redpanda, BullMQ or other configured messaging transports;
- domain-native protocols where required (FHIR, CalDAV, ActivityPub, etc.).

The semantic capability MUST NOT change merely because the transport changes.

## Universal lifecycle pattern

The common lifecycle inherited from UCP/ACP-style negotiation and H2A2H responsibility can be generalized as:

```text
DISCOVER
  -> NEGOTIATE_CAPABILITIES
  -> DECLARE_INTENT
  -> VALIDATE_CONSTRAINTS
  -> ESTABLISH_DELEGATION
  -> PLAN/PROPOSE
  -> HUMAN_INTERVENTION? 
  -> EXECUTE
  -> OBSERVE
  -> PRODUCE_EVIDENCE
  -> CORRECT/CANCEL/ESCALATE?
  -> RETURN_TO_HUMAN
  -> PROVE_RETURN
```

Not every capability requires every stage. The profile declares which transitions are mandatory.

## First standards to implement

The first H2A2H DCPs should be horizontal, because they unlock the greatest number of domains with the smallest specification surface:

1. **Communication Capability Profile**
2. **Scheduling Capability Profile**
3. **Monitoring & Notification Capability Profile**
4. **Submission & Application Capability Profile**
5. **Approval / Consent Capability Profile**
6. **Document Collaboration Capability Profile**
7. **Case Management Capability Profile**

After those are stable, compose vertical profiles:

- Public Services;
- Education;
- Healthcare Administration;
- Employment;
- Research;
- Legal Procedure;
- Insurance.

This creates a protocol vocabulary for the actions people actually perform across the Web rather than centering the entire Agentic Web on shopping.

## Research references

- UCP: https://ucp.dev/
- ACP: https://github.com/agentic-commerce-protocol/agentic-commerce-protocol
- A2A: https://a2a-protocol.org/
- MCP: https://modelcontextprotocol.io/
- AG-UI: https://docs.ag-ui.com/
- A2UI: https://github.com/google/A2UI
- SMART on FHIR: https://hl7.org/fhir/smart-app-launch/
- 1EdTech standards: https://www.1edtech.org/specifications
- GovStack specifications: https://specs.govstack.global/
- ActivityPub: https://www.w3.org/TR/activitypub/
- W3C AI Agent Protocol Community Group: https://www.w3.org/community/agentprotocol/
- NIST AI Agent Standards Initiative: https://www.nist.gov/news-events/news/2026/02/announcing-ai-agent-standards-initiative-interoperable-and-secure
- Agentic Booking: https://agenticbooking.org/
- Agentic Publication Protocol: https://github.com/LionSR/AgenticPublicationProtocol
- Legal Context Protocol: https://github.com/legal-context-protocol/legal-context-protocol
