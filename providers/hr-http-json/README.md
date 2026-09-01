# Human Resources HTTP+JSON Provider Pack

`ProviderPack.HumanResources.HttpJson` provides a vendor-neutral integration for the `hr.*` capabilities used by Human Resources Employee Agents.

```text
hr.hris.read          -> POST /v1/hr/hris/read
hr.hris.write         -> POST /v1/hr/hris/write
hr.ats.query          -> POST /v1/hr/ats/query
hr.policy.query       -> POST /v1/hr/policy/query
hr.approval.request   -> POST /v1/hr/approval/request
```

The pack uses the shared H2A2H HTTP domain provider. It requires `base_url` and an `access_token` secret; `organization_id` and `timeout_ms` are optional.

No Workday, BambooHR, SAP SuccessFactors, Greenhouse or other vendor semantics are embedded. The configured integration endpoint adapts these canonical capabilities to a concrete HRIS, ATS or policy service.

Employee data remains delegation-protected even for reads. Decisions such as hiring, termination, compensation changes, disciplinary actions or sensitive-data access remain governed by the Employee Agent contract and accountable Human. The provider can receive existing approval evidence but cannot create, infer or extend authority.
