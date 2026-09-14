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
          effect,
          accounted,
          unaccounted,
          causalEvents,
          trustLevel,
          authorityEpoch

vars == <<authenticated, capabilityValid, popValid, intentValid, accepted,
          actionAuthorized, humanRequired, humanAccepted, effect, accounted,
          unaccounted, causalEvents, trustLevel, authorityEpoch>>

Init ==
  /\ authenticated = FALSE
  /\ capabilityValid = FALSE
  /\ popValid = FALSE
  /\ intentValid = FALSE
  /\ accepted = FALSE
  /\ actionAuthorized = FALSE
  /\ humanRequired \in BOOLEAN
  /\ humanAccepted = FALSE
  /\ effect = FALSE
  /\ accounted = FALSE
  /\ unaccounted = FALSE
  /\ causalEvents = {}
  /\ trustLevel = 0
  /\ authorityEpoch = 0

Authenticate ==
  /\ authenticated' = TRUE
  /\ UNCHANGED <<capabilityValid, popValid, intentValid, accepted,
                  actionAuthorized, humanRequired, humanAccepted, effect,
                  accounted, unaccounted, causalEvents, trustLevel,
                  authorityEpoch>>

ValidateCapability ==
  /\ authenticated
  /\ capabilityValid' = TRUE
  /\ authorityEpoch' = authorityEpoch + 1
  /\ UNCHANGED <<authenticated, popValid, intentValid, accepted,
                  actionAuthorized, humanRequired, humanAccepted, effect,
                  accounted, unaccounted, causalEvents, trustLevel>>

ValidatePoP ==
  /\ authenticated
  /\ capabilityValid
  /\ popValid' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, intentValid, accepted,
                  actionAuthorized, humanRequired, humanAccepted, effect,
                  accounted, unaccounted, causalEvents, trustLevel,
                  authorityEpoch>>

ValidateIntent ==
  /\ authenticated
  /\ capabilityValid
  /\ popValid
  /\ intentValid' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, accepted,
                  actionAuthorized, humanRequired, humanAccepted, effect,
                  accounted, unaccounted, causalEvents, trustLevel,
                  authorityEpoch>>

RecordCausalEvent(e) ==
  /\ e \in Events
  /\ causalEvents' = causalEvents \cup {e}
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, actionAuthorized, humanRequired, humanAccepted,
                  effect, accounted, unaccounted, trustLevel, authorityEpoch>>

Accept ==
  /\ authenticated
  /\ capabilityValid
  /\ popValid
  /\ intentValid
  /\ accepted' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  actionAuthorized, humanRequired, humanAccepted, effect,
                  accounted, unaccounted, causalEvents, trustLevel,
                  authorityEpoch>>

AuthorizeAction ==
  /\ accepted
  /\ actionAuthorized' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, humanRequired, humanAccepted, effect, accounted,
                  unaccounted, causalEvents, trustLevel, authorityEpoch>>

HumanAccept ==
  /\ humanRequired
  /\ accepted
  /\ humanAccepted' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, actionAuthorized, humanRequired, effect,
                  accounted, unaccounted, causalEvents, trustLevel,
                  authorityEpoch>>

ExecuteAccountedEffect ==
  /\ accepted
  /\ actionAuthorized
  /\ capabilityValid
  /\ authenticated
  /\ popValid
  /\ intentValid
  /\ causalEvents # {}
  /\ IF humanRequired THEN humanAccepted ELSE TRUE
  /\ effect' = TRUE
  /\ accounted' = TRUE
  /\ unaccounted' = FALSE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, actionAuthorized, humanRequired, humanAccepted,
                  causalEvents, trustLevel, authorityEpoch>>

ObserveUnaccountedEffect ==
  /\ effect' = TRUE
  /\ accounted' = FALSE
  /\ unaccounted' = TRUE
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, actionAuthorized, humanRequired, humanAccepted,
                  causalEvents, trustLevel, authorityEpoch>>

RaiseTrust ==
  /\ trustLevel' = trustLevel + 1
  /\ UNCHANGED <<authenticated, capabilityValid, popValid, intentValid,
                  accepted, actionAuthorized, humanRequired, humanAccepted,
                  effect, accounted, unaccounted, causalEvents,
                  authorityEpoch>>

Next ==
  \/ Authenticate
  \/ ValidateCapability
  \/ ValidatePoP
  \/ ValidateIntent
  \/ \E e \in Events: RecordCausalEvent(e)
  \/ Accept
  \/ AuthorizeAction
  \/ HumanAccept
  \/ ExecuteAccountedEffect
  \/ ObserveUnaccountedEffect
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
  /\ effect \in BOOLEAN
  /\ accounted \in BOOLEAN
  /\ unaccounted \in BOOLEAN
  /\ causalEvents \in SUBSET Events
  /\ trustLevel \in Nat
  /\ authorityEpoch \in Nat

AccountedEffectRequiresAuthentication == accounted => authenticated
AccountedEffectRequiresCapability == accounted => capabilityValid
AccountedEffectRequiresPoP == accounted => popValid
AccountedEffectRequiresIntent == accounted => intentValid
AccountedEffectRequiresLocalAcceptance == accounted => accepted
AccountedEffectRequiresActionAuthorization == accounted => actionAuthorized
AccountedEffectRequiresCausalEvents == accounted => causalEvents # {}
HumanBoundaryPreserved == accounted /\ humanRequired => humanAccepted
EffectAccountedOrClassified == effect => accounted \/ unaccounted
UnaccountedIsNotAccounted == unaccounted => ~accounted
AccountedIsNotUnaccounted == accounted => ~unaccounted

\* RaiseTrust deliberately leaves authorityEpoch and capabilityValid unchanged.
\* This projects the normative rule TrustDoesNotExpandAuthority.

Spec == Init /\ [][Next]_vars

=============================================================================
