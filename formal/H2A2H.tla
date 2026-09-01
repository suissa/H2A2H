----------------------------- MODULE H2A2H -----------------------------
EXTENDS Naturals, Sequences, FiniteSets, TLC

CONSTANTS Scopes, MaxDepth

VARIABLES state,
          heldScope,
          childScope,
          delegationDepth,
          now,
          expiresAt,
          revoked,
          responsibility,
          pohr,
          acknowledged

vars == <<state, heldScope, childScope, delegationDepth, now, expiresAt,
          revoked, responsibility, pohr, acknowledged>>

LifecycleStates == {
  "CREATED", "INTENT_CAPTURED", "AUTHORITY_VALIDATED",
  "PARTICIPANTS_RESOLVED", "CHANNEL_BOUND", "EXECUTING",
  "RETURN_PENDING", "HUMAN_RETURNED", "ACKNOWLEDGED", "CLOSED",
  "HEALING_REQUIRED", "HUMAN_ESCALATION_REQUIRED", "SUSPENDED",
  "CANCELLED", "EXPIRED", "REJECTED", "FAILED_TERMINAL"
}

TerminalStates == {"CLOSED", "CANCELLED", "EXPIRED", "REJECTED", "FAILED_TERMINAL"}

Allowed(from, to) ==
  \/ /\ from = "CREATED"
     /\ to \in {"INTENT_CAPTURED", "REJECTED", "FAILED_TERMINAL"}
  \/ /\ from = "INTENT_CAPTURED"
     /\ to \in {"AUTHORITY_VALIDATED", "HEALING_REQUIRED", "HUMAN_ESCALATION_REQUIRED", "REJECTED"}
  \/ /\ from = "AUTHORITY_VALIDATED"
     /\ to \in {"PARTICIPANTS_RESOLVED", "HUMAN_ESCALATION_REQUIRED", "EXPIRED", "REJECTED"}
  \/ /\ from = "PARTICIPANTS_RESOLVED"
     /\ to \in {"CHANNEL_BOUND", "SUSPENDED", "HUMAN_ESCALATION_REQUIRED", "FAILED_TERMINAL"}
  \/ /\ from = "CHANNEL_BOUND"
     /\ to \in {"EXECUTING", "SUSPENDED", "FAILED_TERMINAL"}
  \/ /\ from = "EXECUTING"
     /\ to \in {"RETURN_PENDING", "HEALING_REQUIRED", "HUMAN_ESCALATION_REQUIRED", "SUSPENDED", "FAILED_TERMINAL"}
  \/ /\ from = "RETURN_PENDING"
     /\ to \in {"HUMAN_RETURNED", "HUMAN_ESCALATION_REQUIRED", "SUSPENDED", "FAILED_TERMINAL"}
  \/ /\ from = "HUMAN_RETURNED"
     /\ to \in {"ACKNOWLEDGED", "CLOSED", "FAILED_TERMINAL"}
  \/ /\ from = "ACKNOWLEDGED"
     /\ to = "CLOSED"
  \/ /\ from = "HEALING_REQUIRED"
     /\ to \in {"INTENT_CAPTURED", "AUTHORITY_VALIDATED", "PARTICIPANTS_RESOLVED", "CHANNEL_BOUND", "EXECUTING", "RETURN_PENDING", "HUMAN_ESCALATION_REQUIRED", "FAILED_TERMINAL"}
  \/ /\ from = "HUMAN_ESCALATION_REQUIRED"
     /\ to \in {"INTENT_CAPTURED", "AUTHORITY_VALIDATED", "PARTICIPANTS_RESOLVED", "CHANNEL_BOUND", "EXECUTING", "RETURN_PENDING", "CANCELLED", "EXPIRED", "REJECTED", "FAILED_TERMINAL"}
  \/ /\ from = "SUSPENDED"
     /\ to \in {"PARTICIPANTS_RESOLVED", "CHANNEL_BOUND", "EXECUTING", "RETURN_PENDING", "CANCELLED", "EXPIRED", "FAILED_TERMINAL"}

AuthorityActive == ~revoked /\ now < expiresAt

Init ==
  /\ state = "CREATED"
  /\ heldScope \in SUBSET Scopes
  /\ childScope = {}
  /\ delegationDepth = 0
  /\ now = 0
  /\ expiresAt \in Nat
  /\ expiresAt > 0
  /\ revoked = FALSE
  /\ responsibility = <<"initiating-human">>
  /\ pohr = FALSE
  /\ acknowledged = FALSE

AdvanceLifecycle(to) ==
  /\ state \notin TerminalStates
  /\ Allowed(state, to)
  /\ IF to \in {"AUTHORITY_VALIDATED", "PARTICIPANTS_RESOLVED", "CHANNEL_BOUND", "EXECUTING"}
        THEN AuthorityActive
        ELSE TRUE
  /\ IF to = "HUMAN_RETURNED" THEN pohr ELSE TRUE
  /\ IF to = "ACKNOWLEDGED" THEN pohr ELSE TRUE
  /\ IF to = "CLOSED" THEN pohr ELSE TRUE
  /\ state' = to
  /\ UNCHANGED <<heldScope, childScope, delegationDepth, now, expiresAt,
                  revoked, responsibility, pohr, acknowledged>>

Delegate(scope) ==
  /\ AuthorityActive
  /\ delegationDepth < MaxDepth
  /\ scope \in SUBSET heldScope
  /\ childScope' = scope
  /\ delegationDepth' = delegationDepth + 1
  /\ UNCHANGED <<state, heldScope, now, expiresAt, revoked,
                  responsibility, pohr, acknowledged>>

Tick ==
  /\ now' = now + 1
  /\ UNCHANGED <<state, heldScope, childScope, delegationDepth, expiresAt,
                  revoked, responsibility, pohr, acknowledged>>

Revoke ==
  /\ revoked' = TRUE
  /\ UNCHANGED <<state, heldScope, childScope, delegationDepth, now, expiresAt,
                  responsibility, pohr, acknowledged>>

Handoff(label) ==
  /\ label \in STRING
  /\ responsibility' = Append(responsibility, label)
  /\ UNCHANGED <<state, heldScope, childScope, delegationDepth, now, expiresAt,
                  revoked, pohr, acknowledged>>

ProveHumanReturn ==
  /\ state = "RETURN_PENDING"
  /\ pohr' = TRUE
  /\ UNCHANGED <<state, heldScope, childScope, delegationDepth, now, expiresAt,
                  revoked, responsibility, acknowledged>>

Acknowledge ==
  /\ pohr
  /\ acknowledged' = TRUE
  /\ UNCHANGED <<state, heldScope, childScope, delegationDepth, now, expiresAt,
                  revoked, responsibility, pohr>>

Next ==
  \/ \E to \in LifecycleStates: AdvanceLifecycle(to)
  \/ \E scope \in SUBSET heldScope: Delegate(scope)
  \/ Tick
  \/ Revoke
  \/ \E label \in {"agent", "organization", "service", "device", "human"}: Handoff(label)
  \/ ProveHumanReturn
  \/ Acknowledge

TypeInvariant ==
  /\ state \in LifecycleStates
  /\ heldScope \in SUBSET Scopes
  /\ childScope \in SUBSET Scopes
  /\ delegationDepth \in 0..MaxDepth
  /\ now \in Nat
  /\ expiresAt \in Nat
  /\ revoked \in BOOLEAN
  /\ responsibility \in Seq(STRING)
  /\ pohr \in BOOLEAN
  /\ acknowledged \in BOOLEAN

DelegationScopeMonotonicity == childScope \subseteq heldScope
DelegationDepthBounded == delegationDepth <= MaxDepth
ResponsibilityPreserved == Len(responsibility) >= 1 /\ Head(responsibility) = "initiating-human"
NoExecutionWithoutAuthority == state \in {"AUTHORITY_VALIDATED", "PARTICIPANTS_RESOLVED", "CHANNEL_BOUND", "EXECUTING"} => AuthorityActive
HumanReturnBeforeClose == state = "CLOSED" => pohr
AcknowledgementImpliesReturn == acknowledged => pohr
TerminalIsStable == state \in TerminalStates => ~ENABLED (\E to \in LifecycleStates: AdvanceLifecycle(to))

Spec == Init /\ [][Next]_vars

=============================================================================
