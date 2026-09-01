# Finance HTTP+JSON Provider Pack

`ProviderPack.Finance.HttpJson` is a vendor-neutral implementation pack for the five Finance Employee Tool capabilities:

- `finance.erp.read`
- `finance.erp.write`
- `finance.ledger.query`
- `finance.report.generate`
- `finance.approval.request`

The pack requires a runtime `base_url` and an `api_token` secret. Optional `tenant_id` and `timeout_ms` values may be supplied through non-secret configuration.

The pack does not encode SAP, Oracle, ContaAzul, NetSuite, Dynamics, or any other ERP vendor. The configured service is responsible for adapting the stable H2A2H Finance capability contract to a concrete backend.

## HTTP mapping

```text
finance.erp.read          -> POST /v1/finance/erp/read
finance.erp.write         -> POST /v1/finance/erp/write
finance.ledger.query      -> POST /v1/finance/ledger/query
finance.report.generate   -> POST /v1/finance/report/generate
finance.approval.request  -> POST /v1/finance/approval/request
```

Each request carries the canonical capability plus interaction, correlation and delegation references. Human approval evidence is forwarded when already granted by the Employee Agent runtime.

The Provider Pack never creates approval evidence, extends delegation, selects an Employee role, or decides that a financial operation is authorized. Those decisions remain above the provider layer in H2A2H policy and runtime governance.
