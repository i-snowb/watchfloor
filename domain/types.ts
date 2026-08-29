export type TruthStatus =
  | "observed"
  | "correlated"
  | "supporting"
  | "disputed"
  | "proposed"
  | "modeled"
  | "simulated";

export type SourceCategory =
  | "identity_telemetry"
  | "cloud_audit"
  | "endpoint_telemetry"
  | "windows_authentication"
  | "identity_directory"
  | "network_inventory"
  | "cloud_configuration"
  | "asset_inventory"
  | "sandbox_artifact"
  | "static_analysis"
  | "analyst_judgment"
  | "deterministic_model";

export type ActorKind =
  "source_system" | "tier1_ai" | "agent" | "analyst" | "system";

export interface ActorRef {
  kind: ActorKind;
  id: string;
}

export interface ArtifactBase {
  id: string;
  caseId: string;
  scenarioId: string;
  fixtureVersion: string;
  sequence: number;
  synthetic: true;
  status: TruthStatus;
  sourceCategory: SourceCategory;
  sourceLabel: string;
  timestamp: string;
  actor: ActorRef;
}

interface EntityBase {
  id: string;
  label: string;
  provider: string;
  summary: string;
}

export interface IdentityEntity extends EntityBase {
  kind: "identity";
  accountName: string;
  email: string;
  department: string;
}

export interface SessionEntity extends EntityBase {
  kind: "session";
  externalSessionId: string;
  sourceIp: string;
  deviceId: string;
}

export interface NetworkIndicatorEntity extends EntityBase {
  kind: "network_indicator";
  address: string;
  addressClass: "documentation_range";
}

export interface CloudRoleEntity extends EntityBase {
  kind: "cloud_role";
  roleArn: string;
  privilegeLevel: "administrative";
}

export interface SecretEntity extends EntityBase {
  kind: "secret";
  secretArn: string;
  classification: "production_credential" | "deployment_credential";
}

export interface CloudObjectEntity extends EntityBase {
  kind: "cloud_object";
  bucket: string;
  objectKey: string;
  classification: "restricted_customer_data";
}

export interface EndpointEntity extends EntityBase {
  kind: "endpoint";
  hostname: string;
  deviceId: string;
  platform: "windows";
  assetCriticality: "standard" | "tier_1";
}

export interface FileEntity extends EntityBase {
  kind: "file";
  fileName: string;
  sha256: string;
  classification: "restricted_customer_data" | "untrusted_executable";
}

export interface WorkloadEntity extends EntityBase {
  kind: "workload";
  workloadId: string;
  environment: "production";
  currentImage: string | null;
  knownGoodImage: string | null;
}

export type Entity =
  | IdentityEntity
  | SessionEntity
  | NetworkIndicatorEntity
  | CloudRoleEntity
  | SecretEntity
  | CloudObjectEntity
  | EndpointEntity
  | FileEntity
  | WorkloadEntity;

export type TelemetryPayload =
  | {
      kind: "okta_session_start";
      externalSessionId: string;
      clientIp: string;
      outcome: "SUCCESS";
    }
  | {
      kind: "okta_mfa_verify";
      externalSessionId: string;
      factor: "webauthn";
      outcome: "SUCCESS";
    }
  | {
      kind: "okta_policy_evaluation";
      externalSessionId: string;
      clientIp: string;
      geoRisk: "new_country";
      outcome: "ALLOW";
    }
  | {
      kind: "aws_assume_role";
      roleArn: string;
      principalId: string;
      sourceIdentity: string;
      sourceIp: string;
      outcome: "SUCCESS";
    }
  | {
      kind: "aws_caller_identity";
      principalId: string;
      accountId: string;
      outcome: "SUCCESS";
    }
  | {
      kind: "aws_get_secret";
      principalId: string;
      secretArn: string;
      outcome: "SUCCESS";
    }
  | {
      kind: "aws_list_bucket";
      principalId: string;
      bucketName: string;
      outcome: "SUCCESS";
    }
  | {
      kind: "aws_get_object";
      principalId: string;
      bucketName: string;
      objectKey: string;
      bytesTransferred: number;
      outcome: "SUCCESS";
    }
  | {
      kind: "aws_head_object";
      principalId: string;
      bucketName: string;
      objectKey: string;
      outcome: "SUCCESS";
    }
  | {
      kind: "edr_file_create";
      hostname: string;
      deviceId: string;
      fileName: string;
      sha256: string;
      parentProcess: string;
      sourceFile: string;
      outcome: "OBSERVED";
    }
  | {
      kind: "edr_network_connection";
      hostname: string;
      deviceId: string;
      processName: string;
      destinationIp: string;
      destinationPort: 443;
      protocol: "TLS";
      intervalSeconds: number;
      bytesSent: number;
      outcome: "OBSERVED";
    }
  | {
      kind: "edr_process_start";
      hostname: string;
      deviceId: string;
      processName: string;
      parentProcess: string;
      imagePath: string;
      processGuid: string;
      signer: "unsigned" | "signed";
      commandLineDisplay: string;
      outcome: "OBSERVED";
    }
  | {
      kind: "edr_file_write";
      hostname: string;
      deviceId: string;
      processGuid: string;
      filePath: string;
      outcome: "OBSERVED";
    }
  | {
      kind: "windows_network_logon";
      accountName: string;
      sourceHostname: string;
      targetHostname: string;
      logonType: 3;
      logonId: string;
      outcome: "SUCCESS";
    }
  | {
      kind: "edr_remote_service_attempt";
      sourceHostname: string;
      targetHostname: string;
      processName: string;
      commandLineDisplay: string;
      outcome: "BLOCKED_BEFORE_EXECUTION";
    }
  | {
      kind: "cloud_secret_read";
      principalId: string;
      secretRef: string;
      outcome: "SUCCESS";
    }
  | {
      kind: "cloud_workload_inventory";
      workloadId: string;
      currentImage: string;
      knownGoodImage: string;
      outcome: "OBSERVED";
    };

export interface TelemetryEvent extends ArtifactBase {
  status: "observed";
  action: string;
  entityIds: readonly string[];
  summary: string;
  payload: TelemetryPayload;
}

export interface EvidenceJoin extends ArtifactBase {
  status: "correlated";
  fromEntityId: string;
  toEntityId: string;
  relation: string;
  matchField: string;
  matchValue: string;
  evidenceIds: readonly string[];
  label: string;
  limitation: string;
}

export type EnrichmentPayload =
  | {
      kind: "identity_baseline";
      manager: string;
      normalRole: string;
      priorProdAdminSessions30d: number;
      knownDevice: boolean;
    }
  | {
      kind: "network_context";
      addressClass: "documentation_range";
      geoClassification: "new_country";
      priorIdentitySessions30d: number;
      inventoryMatch: boolean;
      approvedContext: string | null;
    }
  | {
      kind: "role_posture";
      federationTrust: string;
      effectivePrivilege: string;
      maximumSessionHours: number;
      mfaRequired: boolean;
    }
  | {
      kind: "object_inventory";
      classification: string;
      sizeBytes: number;
      priorReadsByIdentity90d: number;
      approvedExportWindow: string | null;
    }
  | {
      kind: "endpoint_posture";
      owner: string;
      edrStatus: "healthy";
      lastSeenAt: string;
      isolationSupported: true;
    }
  | {
      kind: "file_context";
      signer: "unsigned";
      prevalence30d: number;
      screeningVerdict: "suspicious_archive" | "suspicious_untrusted_helper";
      containsRestrictedExport: boolean;
      executionObserved: boolean;
    }
  | {
      kind: "static_analysis_fixture";
      fileFormat: "PE32+";
      signer: "unsigned";
      prevalence30d: number;
      characteristics: readonly (
        "embedded_sync_profile" | "network_client_api" | "service_control_api"
      )[];
      analysisCoverage: "deterministic_fixture_summary_only";
    }
  | {
      kind: "sandbox_behavior_fixture";
      fixtureRunId: string;
      profile: "windows_11_enterprise_fixture";
      observedBehaviors: readonly (
        | "temp_path_execution"
        | "two_tls_connections"
        | "remote_service_control_attempt"
      )[];
      networkDestination: "203.0.113.91";
      externalExecution: false;
    }
  | {
      kind: "destination_context";
      addressClass: "documentation_range";
      inventoryMatch: false;
      priorEndpointConnections30d: number;
      reputation: "not_applicable_documentation_range";
    }
  | {
      kind: "service_identity_baseline";
      expectedScope: string;
      priorTargetLogons90d: number;
      credentialAgeDays: number;
      disableSupported: true;
      rotateSupported: true;
    }
  | {
      kind: "secret_posture";
      classification: "production_deployment_credential";
      lastRotationDays: number;
      rotateSupported: true;
      downstreamPermission: string;
    }
  | {
      kind: "workload_recovery";
      environment: "production";
      currentImage: string;
      knownGoodImage: string;
      rollbackSupported: true;
    };

export type EnrichmentToolName =
  | "enrich_identity"
  | "enrich_network_indicator"
  | "enrich_cloud_role"
  | "enrich_resource"
  | "enrich_endpoint"
  | "enrich_file";

export interface EnrichmentArtifact extends ArtifactBase {
  status: "supporting" | "disputed";
  entityId: string;
  title: string;
  summary: string;
  caveat: string;
  toolName: EnrichmentToolName;
  payload: EnrichmentPayload;
}

export type Tier1RecommendationTool =
  | "inspect_event"
  | "inspect_entity"
  | "inspect_relationship"
  | "query_related_activity"
  | EnrichmentToolName;

export interface Tier1Observation {
  id: string;
  status: Extract<TruthStatus, "observed" | "correlated">;
  title: string;
  summary: string;
  entityIds: readonly string[];
  evidenceIds: readonly string[];
}

export interface Tier1RecommendedStep {
  id: string;
  status: "proposed";
  label: string;
  objective: string;
  recommendedTool: Tier1RecommendationTool;
  entityId: string;
  evidenceIds: readonly string[];
  completionArtifactId: string | null;
  investigationQueryId: string | null;
}

export interface Tier1Escalation extends ArtifactBase {
  status: "correlated";
  confidence: "medium";
  escalationReason: string;
  evidenceIds: readonly string[];
  observations: readonly Tier1Observation[];
  recommendedSteps: readonly Tier1RecommendedStep[];
  checksCompleted: readonly string[];
  unresolvedQuestions: readonly string[];
  actionsWithheld: readonly string[];
}

export interface SyntheticCorpusScope {
  sourceLabel: string;
  sourceCategory: SourceCategory;
  timeRange: {
    start: string;
    end: string;
  };
  syntheticRecordCount: number;
}

export interface InvestigationQueryDefinition {
  id: string;
  title: string;
  question: string;
  objective: string;
  targetEntityId: string;
  toolName: EnrichmentToolName;
  resultArtifactId: string;
  requiresStageId: string | null;
  sourceScopes: readonly SyntheticCorpusScope[];
  matchedRecordCount: number;
  returnedRecordCount: number;
  returnedRecords: readonly InvestigationQueryReturnedRecord[];
  resultChange: string;
  caveat: string;
}

export interface InvestigationQueryReturnedRecord {
  id: string;
  sourceLabel: string;
  timestamp: string;
  recordType: string;
  entityIds: readonly string[];
  fields: readonly {
    label: string;
    value: string;
  }[];
}

export interface DecisionDefinition extends ArtifactBase {
  status: "disputed";
  question: string;
  options: readonly DecisionOption[];
  requiresEnrichmentIds: readonly string[];
  evidenceIds: readonly string[];
  effect: string;
}

export type DecisionOptionId =
  | "authorized_exception"
  | "keep_suspect"
  | "confirmed_malicious"
  | "insufficient_evidence";

export interface DecisionOption {
  id: DecisionOptionId;
  label: string;
  rationale: string;
}

export interface ReachabilityDefinition extends ArtifactBase {
  status: "modeled";
  model: "graph_reachability_v1";
  sourceEntityId: string;
  assumption: string;
  reachableEntityIds: readonly string[];
  paths: readonly {
    id: string;
    entityIds: readonly string[];
  }[];
  caveat: string;
}

export interface CounterfactualDefinition extends ArtifactBase {
  status: "simulated";
  control: "remove_role_trust" | "isolate_compromised_path";
  changedEntityId: string;
  severedPathIds: readonly string[];
  remainingPathIds: readonly string[];
  caveat: string;
}

export type ResponseActionId =
  | "contain_endpoint"
  | "block_network_indicator"
  | "disable_service_identity"
  | "rotate_deployment_credential"
  | "rollback_workload_image";

export type ResponseActionPhase = "containment" | "eradication" | "recovery";

export interface IncidentStreamStage {
  id: string;
  ordinal: number;
  title: string;
  summary: string;
  receivedAt: string;
  entities: readonly Entity[];
  events: readonly TelemetryEvent[];
  joins: readonly EvidenceJoin[];
  enrichments: readonly EnrichmentArtifact[];
  responseActionIds: readonly ResponseActionId[];
}

export interface ResponseActionDefinition {
  id: ResponseActionId;
  phase: ResponseActionPhase;
  title: string;
  targetEntityId: string;
  requiresStageId: string;
  dependsOnActionIds: readonly ResponseActionId[];
  requiresEnrichmentIds: readonly string[];
  evidenceIds: readonly string[];
  seversPathIds: readonly string[];
  requiresHumanAuthorization: true;
  executionScope: "synthetic_demo_only";
  preconditions: readonly string[];
  proposalReasoning: string;
  simulatedEffect: string;
  caveat: string;
}

export interface AlertSummary {
  id: string;
  caseId: string | null;
  title: string;
  subject: string;
  severity: "high" | "medium";
  status: "escalated" | "linked" | "triaged";
  source: string;
  occurredAt: string;
  selected: boolean;
}

export interface CaseFixture {
  id: string;
  scenarioId: string;
  fixtureVersion: string;
  organization: string;
  classification: "synthetic_demo_data";
  title: string;
  summary: string;
  severity: "critical" | "high";
  status: "investigating";
  timeRange: {
    start: string;
    end: string;
  };
  alerts: readonly AlertSummary[];
  entities: readonly Entity[];
  events: readonly TelemetryEvent[];
  primaryTraceEventIds: readonly string[];
  joins: readonly EvidenceJoin[];
  enrichments: readonly EnrichmentArtifact[];
  investigationQueries: readonly InvestigationQueryDefinition[];
  tier1Escalation: Tier1Escalation;
  decision: DecisionDefinition;
  reachability: ReachabilityDefinition;
  counterfactual: CounterfactualDefinition;
  stream: {
    mode: "deterministic_manual_replay";
    stages: readonly IncidentStreamStage[];
  };
  responseActions: readonly ResponseActionDefinition[];
  presentation: CasePresentation;
  impact: ImpactDefinition;
  conclusion: CaseConclusionDefinition;
}

export type EvidenceView = "trace" | "impact";

export interface CaseGraphNode {
  entityId: string;
  x: number;
  y: number;
  lane: "entry" | "execution" | "access" | "lateral" | "impact";
}

export interface CasePresentation {
  defaultEvidenceView: EvidenceView;
  graphWidth: number;
  graphHeight: number;
  nodes: readonly CaseGraphNode[];
  stageQuestions: readonly string[];
  coverageNotes: readonly string[];
  command: {
    observed: string;
    initialScope: string;
    stageScopes: readonly string[];
    scopeMilestones: readonly {
      requiresEnrichmentIds: readonly string[];
      summary: string;
    }[];
  };
}

export interface ImpactDefinition {
  observedEntityIds: readonly string[];
  atRiskEntityIds: readonly string[];
  blockedJoinIds: readonly string[];
  initialHeadline: string;
  modeledHeadline: string;
  containedHeadline: string;
}

export interface CaseConclusionDefinition {
  reportId: string;
  reportVersion: string;
  disposition:
    "authorized_activity_policy_exception" | "confirmed_malicious_synthetic";
  title: string;
  executiveSummary: string;
  confirmedFindings: readonly string[];
  limitations: readonly string[];
  residualRisk: readonly string[];
  requiredDecision: DecisionOptionId;
  requiredEnrichmentIds: readonly string[];
  requiredActionIds: readonly ResponseActionId[];
}

export interface InvestigationProposal {
  id: string;
  phase: "inspect" | "decide" | "scope" | "model" | "respond";
  objective: string;
  recommendedTool: string;
  targetEntityId: string | null;
  basedOnRevision: number;
  reportedSurface: OperationSurface;
}

export interface DecisionState {
  status: "pending" | DecisionOptionId;
  rationale: string | null;
  decidedAt: string | null;
}

export type CaseLifecycle =
  "investigating" | "contained_in_demo" | "report_drafted" | "closed_in_demo";

export interface CaseReport {
  id: string;
  version: string;
  title: string;
  disposition: CaseConclusionDefinition["disposition"];
  executiveSummary: string;
  confirmedFindings: readonly string[];
  limitations: readonly string[];
  residualRisk: readonly string[];
  evidenceIds: readonly string[];
  actionIds: readonly ResponseActionId[];
  generatedAt: string;
}

export interface CaseReportState {
  status: "unavailable" | "drafted" | "approved_in_demo";
  report: CaseReport | null;
  approvedAt: string | null;
}

export interface ResponseProposal {
  id: string;
  actionId: ResponseActionId;
  reasoning: string;
  basedOnRevision: number;
  reportedSurface: OperationSurface;
}

export type ResponseBundleId = "containment" | "recovery";

export interface ResponseBundleProposal {
  id: string;
  bundleId: ResponseBundleId;
  actionIds: readonly ResponseActionId[];
  reasoning: string;
  basedOnRevision: number;
  reportedSurface: OperationSurface;
  preparedAt: string;
}

export interface ObservationRequest {
  stageId: string;
  rationale: string;
  targetEntityIds: readonly string[];
  basedOnRevision: number;
  requestedAt: string;
  releasedAt: string | null;
  status: "pending" | "released";
}

export interface PreparedInvestigationQuery {
  queryId: string;
  targetEntityId: string;
  actor: "agent" | "analyst";
  preparedAtRevision: number;
  preparedAt: string;
}

export interface ResponseActionState {
  actionId: ResponseActionId;
  status:
    | "unavailable"
    | "available"
    | "proposed"
    | "simulated"
    | "authorized_in_demo";
  proposalId: string | null;
  simulatedAt: string | null;
  authorizedAt: string | null;
}

export interface CaseState {
  caseId: string;
  fixtureVersion: string;
  revision: number;
  attachedEnrichmentIds: string[];
  preparedQuery: PreparedInvestigationQuery | null;
  proposal: InvestigationProposal | null;
  decision: DecisionState;
  reachabilityAttached: boolean;
  counterfactualAttached: boolean;
  releasedStreamStageIds: string[];
  observationRequest: ObservationRequest | null;
  responseProposal: ResponseProposal | null;
  responseBundle: ResponseBundleProposal | null;
  authorizedResponseBundleIds: ResponseBundleId[];
  responseActions: ResponseActionState[];
  lifecycle: CaseLifecycle;
  report: CaseReportState;
}

export interface OperationReceipt {
  id: string;
  requestId: string;
  sequence: number;
  reportedSurface: OperationSurface;
  attributionAssurance: "client_reported_unauthenticated";
  toolName: string;
  title: string;
  target: string | null;
  resultSummary: string;
  status: "completed" | "rejected";
  baseRevision: number;
  resultRevision: number;
  occurredAt: string;
}

export type OperationSurface = "webmcp_callback" | "analyst_control";

export interface CaseQueueItem {
  id: string;
  caseId: string | null;
  title: string;
  impact: string;
  severity: "critical" | "high" | "medium";
  status:
    | "awaiting_review"
    | "tier1_triage"
    | "investigating"
    | "response_pending"
    | "contained_in_demo"
    | "closed_in_demo";
  source: string;
  latestObservedAt: string;
  latestObservation: string;
  entityLabels: readonly string[];
  signalCount: number;
  tier1Label: string;
  investigationDepth: "full_response" | "reference_brief";
}

export interface CaseSnapshot {
  state: CaseState;
  receipts: OperationReceipt[];
}
