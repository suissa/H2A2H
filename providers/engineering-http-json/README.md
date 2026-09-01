# Engineering/IT HTTP+JSON Provider Pack

`ProviderPack.Engineering.HttpJson` is a vendor-neutral integration pack for Engineering/IT Employee Agents.

It intentionally spans two semantic capability namespaces:

- `engineering`: SCM, CI and change-management operations;
- `observability`: read-only telemetry query.

The pack's organizational domain is `engineering-it`; its `capability_domains` are explicitly declared as `engineering` and `observability`. This keeps capability identities truthful instead of renaming `observability.query` to fit an organizational boundary.

## Capability mapping

```text
engineering.scm.read        -> POST /v1/engineering/scm/read
engineering.scm.write       -> POST /v1/engineering/scm/write
engineering.ci.execute      -> POST /v1/engineering/ci/execute
observability.query         -> POST /v1/observability/query
engineering.change.request  -> POST /v1/engineering/change/request
```

The pack requires `base_url` configuration and an `access_token` secret. `workspace` and `timeout_ms` are optional.

No GitHub, GitLab, Jenkins, Argo, Datadog, Grafana, Kubernetes or cloud-provider semantics are hard-coded. The service behind `base_url` maps the stable H2A2H capabilities to concrete infrastructure.

Delegation is required before invocation. Production/security approval remains an Employee policy decision above this provider layer; the pack can forward existing approval evidence but cannot create or infer approval.
