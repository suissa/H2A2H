import fs from 'node:fs/promises';
import path from 'node:path';

const catalog = JSON.parse(await fs.readFile('employees/catalog.json', 'utf8'));

const departments = {
  executive: {
    accountable: 'Board / designated Human principal', risk: 'critical',
    tools: ['enterprise.strategy.read','enterprise.kpi.read','enterprise.decision.record','enterprise.communication.publish','enterprise.approval.request'],
    systems: ['strategy repository','enterprise KPI platform','board records','policy registry'],
    approvals: ['material financial commitment','organization-wide policy change','external legal commitment','irreversible strategic action'],
    responsibilities: ['synthesize enterprise signals into decisions','coordinate cross-functional priorities','record rationale and delegated authority','escalate material uncertainty to accountable Humans']
  },
  finance: {
    accountable: 'Chief Financial Officer or delegated Finance leader', risk: 'high',
    tools: ['finance.erp.read','finance.erp.write','finance.ledger.query','finance.report.generate','finance.approval.request'],
    systems: ['ERP','general ledger','treasury/banking interface','tax/compliance repository'],
    approvals: ['payment or transfer','journal posting above policy threshold','tax filing','financial statement publication'],
    responsibilities: ['analyze financial records and policy constraints','prepare or execute authorized finance operations','reconcile outputs with the system of record','surface exceptions and approval requirements']
  },
  'human-resources': {
    accountable: 'Chief Human Resources Officer or delegated People leader', risk: 'high',
    tools: ['hr.hris.read','hr.hris.write','hr.ats.query','hr.policy.query','hr.approval.request'],
    systems: ['HRIS','ATS','learning platform','people policy repository'],
    approvals: ['hire or termination','compensation change','disciplinary action','access to sensitive employee data'],
    responsibilities: ['operate on workforce processes under privacy constraints','apply people policies consistently','preserve employee-data confidentiality','escalate irreversible people decisions']
  },
  'legal-risk-compliance': {
    accountable: 'Chief Legal Officer / Compliance leader', risk: 'critical',
    tools: ['legal.clm.read','legal.clm.write','legal.policy.query','risk.register.read','legal.approval.request'],
    systems: ['contract lifecycle management','legal matter management','policy registry','risk register'],
    approvals: ['binding legal commitment','regulatory filing','waiver or exception','privileged disclosure'],
    responsibilities: ['interpret contracts, policy and regulatory constraints','prepare controlled legal/risk actions','preserve privilege and provenance','escalate binding or exception decisions']
  },
  'sales-customer': {
    accountable: 'Chief Revenue Officer or delegated Sales/Customer leader', risk: 'medium',
    tools: ['sales.crm.read','sales.crm.write','sales.quote.generate','customer.history.query','sales.approval.request'],
    systems: ['CRM','CPQ','customer support platform','billing/customer master'],
    approvals: ['discount beyond policy','contractual promise','refund above threshold','customer data export'],
    responsibilities: ['understand account/customer context','advance authorized revenue or service work','record CRM/customer outcomes','escalate promises outside policy']
  },
  'marketing-communications': {
    accountable: 'Chief Marketing Officer or delegated Communications leader', risk: 'medium',
    tools: ['marketing.analytics.read','marketing.cms.write','marketing.campaign.manage','brand.policy.query','marketing.approval.request'],
    systems: ['marketing automation','CMS','analytics','brand asset repository'],
    approvals: ['public statement','campaign spend above threshold','regulated claim','use of sensitive audience data'],
    responsibilities: ['analyze audience/brand context','prepare and execute authorized communications','measure campaign/content outcomes','escalate public or regulated claims']
  },
  'product-design': {
    accountable: 'Chief Product Officer or delegated Product/Design leader', risk: 'medium',
    tools: ['product.backlog.read','product.backlog.write','research.repository.query','design.assets.read','product.approval.request'],
    systems: ['product backlog','design system','research repository','roadmap'],
    approvals: ['roadmap commitment','breaking UX/policy change','production experiment involving sensitive data'],
    responsibilities: ['translate user/business evidence into product work','maintain traceability from requirement to artifact','coordinate research/design/product decisions','escalate policy or roadmap commitments']
  },
  'engineering-it': {
    accountable: 'CTO/CIO or delegated Engineering/IT leader', risk: 'high',
    tools: ['engineering.scm.read','engineering.scm.write','engineering.ci.execute','observability.query','engineering.change.request'],
    systems: ['source control','CI/CD','cloud platform','observability stack'],
    approvals: ['production deployment','privileged access change','destructive data operation','security control modification'],
    responsibilities: ['inspect technical state and constraints','execute least-privilege technical actions','produce verifiable change evidence','escalate production/security risk']
  },
  'operations-programs': {
    accountable: 'Chief Operating Officer or delegated Operations leader', risk: 'medium',
    tools: ['operations.erp.read','operations.workflow.write','operations.schedule.manage','operations.asset.query','operations.approval.request'],
    systems: ['ERP','workflow platform','project portfolio','facilities/asset system'],
    approvals: ['operational shutdown','safety-impacting change','budget commitment above threshold','external vendor commitment'],
    responsibilities: ['coordinate operational work and dependencies','maintain schedule/asset/process state','record decisions and exceptions','escalate safety or material operational risk']
  },
  'supply-chain-manufacturing': {
    accountable: 'COO / Supply Chain or Manufacturing leader', risk: 'high',
    tools: ['supply.erp.read','supply.erp.write','supply.wms.query','supply.tms.query','supply.approval.request'],
    systems: ['ERP/MRP','WMS','TMS','supplier portal','quality management system'],
    approvals: ['purchase order above threshold','supplier award','production stop','safety/quality disposition'],
    responsibilities: ['plan and execute authorized supply/production work','maintain inventory/supplier/quality traceability','coordinate physical-world dependencies','escalate safety, quality or material spend']
  },
  'analytics-strategy': {
    accountable: 'Chief Data Officer / Strategy leader', risk: 'medium',
    tools: ['data.warehouse.query','data.catalog.query','analytics.notebook.execute','bi.report.publish','data.approval.request'],
    systems: ['data warehouse','data catalog','BI platform','analytics workspace'],
    approvals: ['production model decision','publication of sensitive metrics','cross-domain data access'],
    responsibilities: ['query governed data sources','produce reproducible analysis','record assumptions and lineage','escalate decisions requiring accountable Human judgment']
  },
  'corporate-affairs': {
    accountable: 'CEO / Chief Legal Officer / Corporate Affairs leader', risk: 'critical',
    tools: ['corp.records.read','corp.filings.prepare','stakeholder.crm.read','corp.communication.draft','corp.approval.request'],
    systems: ['corporate records','filing systems','stakeholder CRM','communications repository'],
    approvals: ['regulatory/public filing','investor guidance','government representation','board governance action'],
    responsibilities: ['prepare governance/stakeholder materials','maintain official records and provenance','respect disclosure and representation rules','escalate public, regulatory or fiduciary commitments']
  },
  'personal-services': {
    accountable: 'Delegating Human', risk: 'medium',
    tools: ['commerce.catalog.search','commerce.offer.compare','commerce.cart.prepare','commerce.order.status','commerce.purchase.request'],
    systems: ['product catalogs','merchant APIs','price/availability services','order tracking'],
    approvals: ['purchase commitment','substitution outside delegated preference','spend above delegated threshold','sharing personal preference data'],
    responsibilities: ["capture the Human's preferences and constraints",'search and compare suitable products','prepare a purchase decision with evidence','request explicit approval when delegation does not already authorize purchase']
  }
};

function pascal(slug) {
  const parts = slug.split('-').filter(Boolean).map(x => x[0].toUpperCase() + x.slice(1));
  const joined = parts.join('');
  return joined.endsWith('Agent') ? joined : `${joined}Agent`;
}

function canonical(slug) { return `Enterprise.Employee.${pascal(slug)}`; }
function hasSideEffect(name) { return /(write|execute|manage|request|publish|record|prepare)/.test(name); }

function agentCard(e) {
  return {
    name: `${e.name} Agent`,
    description: `H2A2H enterprise employee agent implementing the ${e.name} role. The A2A Agent Card provides discovery identity; H2A2H adds delegation, Human responsibility, policy, provenance and Proof-of-Human-Return.`,
    supportedInterfaces: [
      { url: `https://agents.example.com/${e.slug}/a2a`, protocolBinding: 'HTTP+JSON', protocolVersion: '1.0' },
      { url: `https://agents.example.com/${e.slug}/a2a`, protocolBinding: 'JSONRPC', protocolVersion: '1.0' }
    ],
    provider: { organization: 'Example Enterprise', url: 'https://enterprise.example.com' },
    version: '0.1.0',
    documentationUrl: `https://enterprise.example.com/agents/${e.slug}`,
    capabilities: { streaming: true, extendedAgentCard: true },
    defaultInputModes: ['text/plain','application/json'],
    defaultOutputModes: ['text/plain','application/json'],
    skills: [
      { id: `${e.slug}.analyze`, name: `Analyze as ${e.name}`, description: `Analyze information relevant to the ${e.name} role and produce evidence-backed findings.`, tags: [e.department,e.slug,'analysis'] },
      { id: `${e.slug}.execute`, name: `Execute ${e.name} work`, description: `Execute delegated ${e.name} work using only the declared tool allowlist and approval policy.`, tags: [e.department,e.slug,'execution'] },
      { id: `${e.slug}.report`, name: `Report ${e.name} outcome`, description: `Return a structured ${e.name} result with provenance, audit references and Human-return status.`, tags: [e.department,e.slug,'reporting','pohr'] }
    ]
  };
}

function employeeProfile(e) {
  const d = departments[e.department];
  const label = canonical(e.slug);
  return {
    employee_agent: {
      identity: {
        canonical_label: label,
        human_role: e.name,
        department: e.department,
        entity_kind: 'Agent',
        a2a_agent_card: './agent-card.json',
        identity_model: 'A2A Agent Card for discovery + H2A2H responsibility/delegation identity'
      },
      purpose: `Act as the delegated digital counterpart of a ${e.name}, without exceeding the authority of the responsible Human or enterprise policy.`,
      responsibilities: d.responsibilities,
      authority: {
        accountable_human_role: d.accountable,
        delegation_required: true,
        default_session_ttl: 'PT30M',
        maximum_session_ttl: 'PT8H',
        scope: [`department:${e.department}`,`role:${e.slug}`],
        self_extension_forbidden: true,
        self_approval_forbidden: true
      },
      intents: [
        { canonical_label: `${label}.Analyze`, effect: 'read-only', pohr: 'optional' },
        { canonical_label: `${label}.Prepare`, effect: 'draft', pohr: 'optional' },
        { canonical_label: `${label}.Execute`, effect: 'side-effect', pohr: 'required' },
        { canonical_label: `${label}.Review`, effect: 'read-only', pohr: 'optional' },
        { canonical_label: `${label}.Report`, effect: 'return-to-human', pohr: 'required' }
      ],
      tools: [
        ...d.tools.map(name => ({ name, permission: 'allow', side_effect: hasSideEffect(name) })),
        { name: 'h2a2h.delegation.validate', permission: 'required', side_effect: false },
        { name: 'h2a2h.audit.append', permission: 'required', side_effect: true },
        { name: 'h2a2h.pohr.issue', permission: 'required-on-human-return', side_effect: true },
        { name: 'h2a2h.human.escalate', permission: 'required-on-uncertainty', side_effect: true }
      ],
      systems_of_record: d.systems,
      inputs: { required: ['intent','delegation_ref','correlation_id','request_payload'], optional: ['context_ref','policy_context','attachments','human_preferences'] },
      outputs: { required: ['status','result_or_artifact','provenance','audit_ref'], human_boundary: ['pohr'] },
      events: { success: 'Ok', failure: 'Error', escalation: 'HumanRequired', delegation_expired: 'DelegationExpired' },
      risk: {
        class: d.risk,
        human_approval_required_for: d.approvals,
        deny: ['operate outside declared role','invent authority','hide tool side effects','silently bypass enterprise policy']
      },
      channels: {
        discovery: 'A2A Agent Card at /.well-known/agent-card.json',
        a2a_preferred: 'HTTP+JSON / A2A 1.0',
        a2a_alternate: 'JSONRPC / A2A 1.0',
        h2a2h: 'resolved from OpenEntityChannels/OpenIntent; never chosen ad hoc by role code'
      },
      proof_of_human_return: {
        required_for: ['Execute','Report','HumanRequired'],
        minimum_evidence: ['correlation_id','responsibility_chain','delivery_or_presentation_evidence'],
        acknowledgement_required_when: d.approvals
      },
      memory: {
        working: 'ephemeral per delegated session',
        durable: 'only through declared systems of record and audit trail',
        forbidden: ['shadow employee profiles','undeclared personal memory','credentials/secrets']
      },
      security: {
        least_privilege: true,
        no_secrets_in_agent_card: true,
        delegation_validation_before_side_effect: true,
        audit_all_side_effects: true,
        recommended_enterprise_profile: ['mTLS','DPoP or equivalent proof-of-possession','short-lived credentials']
      },
      observability: ['intent lifecycle','tool calls','delegation checks','approval requests','policy decisions','PoHR issuance'],
      acceptance_tests: [
        'Agent Card validates against A2A v1 discovery model',
        'canonical_label is stable and unique',
        'side effects fail closed without valid delegation',
        'tool invocation is restricted to declared allowlist',
        'high-risk actions request accountable Human approval',
        'human-boundary result carries PoHR evidence',
        'audit trail preserves correlation and responsibility chain',
        'agent interoperates without implementation-specific coupling'
      ]
    }
  };
}

for (const e of catalog) {
  const dir = path.join('employees', e.department, e.slug);
  await fs.mkdir(dir, { recursive: true });
  await fs.writeFile(path.join(dir, 'agent-card.json'), `${JSON.stringify(agentCard(e), null, 2)}\n`);
  // JSON is a strict subset of YAML 1.2, so this remains a valid YAML document without an extra generator dependency.
  await fs.writeFile(path.join(dir, 'h2a2h.employee.yml'), `${JSON.stringify(employeeProfile(e), null, 2)}\n`);
}

console.log(`generated ${catalog.length} employee agent folders (${catalog.length * 2} role files)`);
