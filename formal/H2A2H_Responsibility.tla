---------------------- MODULE H2A2H_Responsibility ----------------------
EXTENDS Naturals, FiniteSets, TLC

CONSTANTS Events

VARIABLES authenticated,
          capabilityValid,
          popValid,
          intentValid,
          accepted,
          actionAuthorized,
          humanRequired,
          humanAccepted,
          humanReturnRequired,
          humanReturned,
          effect,
          accounted,
          unaccounted,
          reconciled,
          closed,
          causalEvents,
          trustLevel,
          authorityEpoch,
          actionAuthorizationEpoch

vars == <<authenticated, capabilityValid, popValid, intentValid, accepted,
          actionAuthorized, humanRequired, humanAccepted,
          humanReturnRequired, humanReturned, effect, accounted, unaccounted,
          reconciled, closed, causalEvents, trustLevel, authorityEpoch,
          actionAuthorizationEpoch>>

Init ==
  /\ authenticated = FALSE
  /\ capabilityValid = FALSE
  /\ popValid = FALSE
  /\ intentValid = FALSE
  /\ accepted = FALSE
  /\ actionAuthorized = FALSE
  /\ humanRequired \in BOOLEAN
  /\ humanAccepted = FALSE
  /\ humanReturnRequired \in BOOLEAN
  /\ humanReturned = FALSE
  /\ effect = FALSE
  /\ accounted = FALSE
  /\ unaccounted = FALSE
  /\ reconciled = FALSE
  /\ closed = FALSE
  /\ causalEvents = {}
  /\ trustLevel = 0
  /\ authorityEpoch = 0
  /\ actionAuthorizationEpoch = 0

Authenticate ==
  /\ authenticated' = TRUE
  /\ UNCHANGED <<capabilityValid, popValid, intentValid, accepted,
                  actionAuthorized, humanRequired, humanAccepted,
                  humanReturnRequired, humanReturned, effect, accounted,
                  unaccounted, reconciled, closed, causalEvents, trustLevel,
                  authorityEpoch, actionAuthorizationEpoch>>

ValidateCapability ==
  /\ authenticated
  /\ ~effect
  /\ authorityEpoch < 2
  /\ capabilityValid' = TRUE
  /\ authorityEpoch' = authorityEpoch + 1
  /\ UNCHANGED <<authenticated, popValid, intentValid, accepted,
                  actionAuthorized, humanRequired, humanAccepted,
                  humanReturnRequired, humanReturned, effect, accounted,
                  unaccounted, reconciled, closed, causalEvents, trustLevel,
                  actionAuthorizationEpoch>>

RevokeCapability ==
  /\ capabilityValid
  /\ ~effect
  /\ authorityEpoch < 2
  /\ capabilityValid' = FALSE
  /\ authorityEpoch' = authorityEpoch + 1
  /\ UNCHANGED <<authenticated, popValid, intentValid, accepted,
                  actionAuthorized, humanRequired, humanAccepted,
                  humanReturnRequired, humanReturned, effect, accounted,
                  unaccounted, reconciled, closed, causalEvents, trustLevel,
                  actionAuthorizationEpoch>>

ValidatePoP ==
  /\ authenticated
  /\ capabilityValid
  /\ popValid' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, intentValid, accepted,
                  actionAuthorized, humanRequired, humanAccepted,
                  humanReturnRequired, humanReturned, effect, accounted,
                  unaccounted, reconciled, closed, causalEvents, trustLevel,
                  authorityEpoch, actionAuthorizationEpoch>>

ValidateIntent ==
  /\ authenticated
  /\ capabilityValid
  /\ popValid
  /\ intentValid' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, accepted,
                  actionAuthorized, humanRequired, humanAccepted,
                  humanReturnRequired, humanReturned, effect, accounted,
                  unaccounted, reconciled, closed, causalEvents, trustLevel,
                  authorityEpoch, actionAuthorizationEpoch>>

RecordCausalEvent(e) ==
  /\ e \in Events
  /\ causalEvents' = causalEvents \cup {e}
  /\ ~effect
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, actionAuthorized, humanRequired, humanAccepted,
                  humanReturnRequired, humanReturned, effect, accounted,
                  unaccounted, reconciled, closed, trustLevel, authorityEpoch,
                  actionAuthorizationEpoch>>

Accept ==
  /\ authenticated
  /\ capabilityValid
  /\ popValid
  /\ intentValid
  /\ accepted' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  actionAuthorized, humanRequired, humanAccepted,
                  humanReturnRequired, humanReturned, effect, accounted,
                  unaccounted, reconciled, closed, causalEvents, trustLevel,
                  authorityEpoch, actionAuthorizationEpoch>>

AuthorizeAction ==
  /\ accepted
  /\ actionAuthorized' = TRUE
  /\ actionAuthorizationEpoch' = authorityEpoch
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, humanRequired, humanAccepted,
                  humanReturnRequired, humanReturned, effect, accounted,
                  unaccounted, reconciled, closed, causalEvents, trustLevel,
                  authorityEpoch>>

HumanAccept ==
  /\ humanRequired
  /\ accepted
  /\ humanAccepted' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, actionAuthorized, humanRequired,
                  humanReturnRequired, humanReturned, effect, accounted,
                  unaccounted, reconciled, closed, causalEvents, trustLevel,
                  authorityEpoch, actionAuthorizationEpoch>>

ExecuteAccountedEffect ==
  /\ accepted
  /\ actionAuthorized
  /\ capabilityValid
  /\ authenticated
  /\ popValid
  /\ intentValid
  /\ causalEvents # {}
  /\ actionAuthorizationEpoch = authorityEpoch
  /\ ~effect
  /\ IF humanRequired THEN humanAccepted ELSE TRUE
  /\ effect' = TRUE
  /\ accounted' = TRUE
  /\ unaccounted' = FALSE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, actionAuthorized, humanRequired, humanAccepted,
                  humanReturnRequired, humanReturned, reconciled, closed,
                  causalEvents, trustLevel, authorityEpoch,
                  actionAuthorizationEpoch>>

ObserveUnaccountedEffect ==
  /\ ~effect
  /\ effect' = TRUE
  /\ accounted' = FALSE
  /\ unaccounted' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, actionAuthorized, humanRequired, humanAccepted,
                  humanReturnRequired, humanReturned, reconciled, closed,
                  causalEvents, trustLevel, authorityEpoch,
                  actionAuthorizationEpoch>>

ReconcileUnaccountedEffect ==
  /\ unaccounted
  /\ ~reconciled
  /\ reconciled' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, actionAuthorized, humanRequired, humanAccepted,
                  humanReturnRequired, humanReturned, effect, accounted,
                  unaccounted, closed, causalEvents, trustLevel,
                  authorityEpoch, actionAuthorizationEpoch>>

HumanReturn ==
  /\ effect
  /\ humanReturnRequired
  /\ humanReturned' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, actionAuthorized, humanRequired, humanAccepted,
                  humanReturnRequired, effect, accounted, unaccounted,
                  reconciled, closed, causalEvents, trustLevel,
                  authorityEpoch, actionAuthorizationEpoch>>

Close ==
  /\ effect
  /\ IF humanReturnRequired THEN humanReturned ELSE TRUE
  /\ closed' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, actionAuthorized, humanRequired, humanAccepted,
                  humanReturnRequired, humanReturned, effect, accounted,
                  unaccounted, reconciled, causalEvents, trustLevel,
                  authorityEpoch, actionAuthorizationEpoch>>

RaiseTrust ==
  /\ trustLevel < 2
  /\ trustLevel' = trustLevel + 1
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, actionAuthorized, humanRequired, humanAccepted,
                  humanReturnRequired, humanReturned, effect, accounted,
                  unaccounted, reconciled, closed, causalEvents,
                  authorityEpoch, actionAuthorizationEpoch>>

Next ==
  \/ Authenticate
  \/ ValidateCapability
  \/ RevokeCapability
  \/ ValidatePoP
  \/ ValidateIntent
  \/ \E e \in Events: RecordCausalEvent(e)
  \/ Accept
  \/ AuthorizeAction
  \/ HumanAccept
  \/ ExecuteAccountedEffect
  \/ ObserveUnaccountedEffect
  \/ ReconcileUnaccountedEffect
  \/ HumanReturn
  \/ Close
  \/ RaiseTrust

TypeInvariant ==
  /\ authenticated \in BOOLEAN
  /\ capabilityValid \in BOOLEAN
  /\ popValid \in BOOLEAN
  /\ intentValid \in BOOLEAN
  /\ accepted \in BOOLEAN
  /\ actionAuthorized \in BOOLEAN
  /\ humanRequired \in BOOLEAN
  /\ humanAccepted \in BOOLEAN
  /\ humanReturnRequired \in BOOLEAN
  /\ humanReturned \in BOOLEAN
  /\ effect \in BOOLEAN
  /\ accounted \in BOOLEAN
  /\ unaccounted \in BOOLEAN
  /\ reconciled \in BOOLEAN
  /\ closed \in BOOLEAN
  /\ causalEvents \in SUBSET Events
  /\ trustLevel \in Nat
  /\ authorityEpoch \in Nat
  /\ actionAuthorizationEpoch \in Nat

AccountedEffectRequiresAuthentication == accounted => authenticated
AccountedEffectRequiresCapability == accounted => capabilityValid
AccountedEffectRequiresPoP == accounted => popValid
AccountedEffectRequiresIntent == accounted => intentValid
AccountedEffectRequiresLocalAcceptance == accounted => accepted
AccountedEffectRequiresActionAuthorization == accounted => actionAuthorized
AccountedEffectRequiresCausalEvents == accounted => causalEvents # {}
HumanBoundaryPreserved == accounted /\ humanRequired => humanAccepted
HumanReturnBeforeClose == closed /\ humanReturnRequired => humanReturned
ActionAuthorizationCurrent == accounted => actionAuthorizationEpoch = authorityEpoch
EffectAccountedOrClassified == effect => accounted \/ unaccounted
UnaccountedIsNotAccounted == unaccounted => ~accounted
AccountedIsNotUnaccounted == accounted => ~unaccounted
UnaccountedClassificationIsStable == unaccounted => ~accounted

\* RaiseTrust deliberately leaves authorityEpoch and capabilityValid unchanged.
\* This projects the normative rule TrustDoesNotExpandAuthority.

Spec == Init /\ [][Next]_vars

=============================================================================
