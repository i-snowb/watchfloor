import type {
  EnrichmentArtifact,
  Entity,
  TelemetryEvent,
} from "@/domain/types";

export interface DisplayField {
  label: string;
  value: string;
}

export function formatUtcTime(timestamp: string): string {
  return `${timestamp.slice(11, 19)}Z`;
}

export function formatUtcRange(start: string, end: string): string {
  return `${start.slice(11, 16)}–${end.slice(11, 16)} UTC`;
}

export function humanizeEntityKind(kind: Entity["kind"]): string {
  const labels: Record<Entity["kind"], string> = {
    identity: "Identity",
    session: "Session",
    network_indicator: "Network indicator",
    cloud_role: "Cloud role",
    secret: "Secret",
    cloud_object: "Cloud object",
    endpoint: "Endpoint",
    file: "File",
    workload: "Workload",
  };
  return labels[kind];
}

export function entityFields(entity: Entity): DisplayField[] {
  switch (entity.kind) {
    case "identity":
      return [
        { label: "Account", value: entity.accountName },
        { label: "Email", value: entity.email },
        { label: "Department", value: entity.department },
      ];
    case "session":
      return [
        { label: "Session ID", value: entity.externalSessionId },
        { label: "Source IP", value: entity.sourceIp },
        { label: "Device", value: entity.deviceId },
      ];
    case "network_indicator":
      return [
        { label: "Address", value: entity.address },
        { label: "Address class", value: "RFC 5737 documentation range" },
      ];
    case "cloud_role":
      return [
        { label: "Role ARN", value: entity.roleArn },
        { label: "Privilege", value: entity.privilegeLevel },
      ];
    case "secret":
      return [
        { label: "Secret ARN", value: entity.secretArn },
        {
          label: "Classification",
          value:
            entity.classification === "deployment_credential"
              ? "Deployment credential"
              : "Production credential",
        },
      ];
    case "cloud_object":
      return [
        { label: "Bucket", value: entity.bucket },
        { label: "Object key", value: entity.objectKey },
        { label: "Classification", value: "Restricted customer data" },
      ];
    case "endpoint":
      return [
        { label: "Hostname", value: entity.hostname },
        { label: "Device ID", value: entity.deviceId },
        { label: "Platform", value: entity.platform },
        { label: "Criticality", value: entity.assetCriticality },
      ];
    case "file":
      return [
        { label: "File", value: entity.fileName },
        { label: "SHA-256", value: entity.sha256 },
        {
          label: "Classification",
          value:
            entity.classification === "untrusted_executable"
              ? "Untrusted executable"
              : "Restricted customer data",
        },
      ];
    case "workload":
      return [
        { label: "Workload", value: entity.workloadId },
        { label: "Environment", value: entity.environment },
        {
          label: "Current image",
          value: entity.currentImage ?? "Not yet observed",
        },
        {
          label: "Known-good image",
          value: entity.knownGoodImage ?? "Not yet observed",
        },
      ];
  }
}

export function eventFields(event: TelemetryEvent): DisplayField[] {
  const payload = event.payload;
  switch (payload.kind) {
    case "okta_session_start":
      return [
        { label: "externalSessionId", value: payload.externalSessionId },
        { label: "clientIp", value: payload.clientIp },
        { label: "outcome", value: payload.outcome },
      ];
    case "okta_mfa_verify":
      return [
        { label: "externalSessionId", value: payload.externalSessionId },
        { label: "factor", value: payload.factor },
        { label: "outcome", value: payload.outcome },
      ];
    case "okta_policy_evaluation":
      return [
        { label: "externalSessionId", value: payload.externalSessionId },
        { label: "clientIp", value: payload.clientIp },
        { label: "geoRisk", value: payload.geoRisk },
        { label: "outcome", value: payload.outcome },
      ];
    case "aws_assume_role":
      return [
        { label: "roleArn", value: payload.roleArn },
        { label: "principalId", value: payload.principalId },
        { label: "sourceIdentity", value: payload.sourceIdentity },
        { label: "sourceIp", value: payload.sourceIp },
        { label: "outcome", value: payload.outcome },
      ];
    case "aws_caller_identity":
      return [
        { label: "principalId", value: payload.principalId },
        { label: "accountId", value: payload.accountId },
        { label: "outcome", value: payload.outcome },
      ];
    case "aws_get_secret":
      return [
        { label: "principalId", value: payload.principalId },
        { label: "secretArn", value: payload.secretArn },
        { label: "outcome", value: payload.outcome },
      ];
    case "aws_list_bucket":
      return [
        { label: "principalId", value: payload.principalId },
        { label: "bucketName", value: payload.bucketName },
        { label: "outcome", value: payload.outcome },
      ];
    case "aws_get_object":
      return [
        { label: "principalId", value: payload.principalId },
        { label: "bucketName", value: payload.bucketName },
        { label: "objectKey", value: payload.objectKey },
        {
          label: "bytesTransferred",
          value: formatBytes(payload.bytesTransferred),
        },
        { label: "outcome", value: payload.outcome },
      ];
    case "aws_head_object":
      return [
        { label: "principalId", value: payload.principalId },
        { label: "bucketName", value: payload.bucketName },
        { label: "objectKey", value: payload.objectKey },
        { label: "outcome", value: payload.outcome },
      ];
    case "edr_file_create":
      return [
        { label: "hostname", value: payload.hostname },
        { label: "deviceId", value: payload.deviceId },
        { label: "fileName", value: payload.fileName },
        { label: "parentProcess", value: payload.parentProcess },
        { label: "sourceFile", value: payload.sourceFile },
        { label: "sha256", value: payload.sha256 },
        { label: "outcome", value: payload.outcome },
      ];
    case "edr_network_connection":
      return [
        { label: "hostname", value: payload.hostname },
        { label: "process", value: payload.processName },
        {
          label: "destination",
          value: `${payload.destinationIp}:${payload.destinationPort}`,
        },
        { label: "protocol", value: payload.protocol },
        { label: "interval", value: `${payload.intervalSeconds} seconds` },
        { label: "bytesSent", value: formatBytes(payload.bytesSent) },
        { label: "outcome", value: payload.outcome },
      ];
    case "edr_process_start":
      return [
        { label: "hostname", value: payload.hostname },
        { label: "process", value: payload.processName },
        { label: "parentProcess", value: payload.parentProcess },
        { label: "imagePath", value: payload.imagePath },
        { label: "command", value: payload.commandLineDisplay },
        { label: "signer", value: payload.signer },
        { label: "outcome", value: payload.outcome },
      ];
    case "edr_file_write":
      return [
        { label: "hostname", value: payload.hostname },
        { label: "processGuid", value: payload.processGuid },
        { label: "filePath", value: payload.filePath },
        { label: "outcome", value: payload.outcome },
      ];
    case "windows_network_logon":
      return [
        { label: "account", value: payload.accountName },
        { label: "source", value: payload.sourceHostname },
        { label: "target", value: payload.targetHostname },
        { label: "logonType", value: String(payload.logonType) },
        { label: "logonId", value: payload.logonId },
        { label: "outcome", value: payload.outcome },
      ];
    case "edr_remote_service_attempt":
      return [
        { label: "source", value: payload.sourceHostname },
        { label: "target", value: payload.targetHostname },
        { label: "process", value: payload.processName },
        { label: "command", value: payload.commandLineDisplay },
        { label: "outcome", value: payload.outcome },
      ];
    case "cloud_secret_read":
      return [
        { label: "principalId", value: payload.principalId },
        { label: "secret", value: payload.secretRef },
        { label: "outcome", value: payload.outcome },
      ];
    case "cloud_workload_inventory":
      return [
        { label: "workload", value: payload.workloadId },
        { label: "currentImage", value: payload.currentImage },
        { label: "knownGoodImage", value: payload.knownGoodImage },
        { label: "outcome", value: payload.outcome },
      ];
  }
}

export function enrichmentFields(artifact: EnrichmentArtifact): DisplayField[] {
  const payload = artifact.payload;
  switch (payload.kind) {
    case "identity_baseline":
      return [
        { label: "Manager", value: payload.manager },
        { label: "Normal role", value: payload.normalRole },
        {
          label: "prod-admin sessions · 30d",
          value: String(payload.priorProdAdminSessions30d),
        },
        { label: "Known device", value: payload.knownDevice ? "Yes" : "No" },
      ];
    case "network_context":
      return [
        { label: "Address class", value: "Documentation range" },
        { label: "Geo classification", value: payload.geoClassification },
        {
          label: "Inventory match",
          value: payload.inventoryMatch ? "Yes" : "No",
        },
        {
          label: "Approved context",
          value: payload.approvedContext ?? "None recorded",
        },
        {
          label: "Identity sessions · 30d",
          value: String(payload.priorIdentitySessions30d),
        },
      ];
    case "role_posture":
      return [
        { label: "Federation trust", value: payload.federationTrust },
        { label: "Effective privilege", value: payload.effectivePrivilege },
        {
          label: "Maximum session",
          value: `${payload.maximumSessionHours} hours`,
        },
        {
          label: "MFA condition",
          value: payload.mfaRequired ? "Required" : "None",
        },
      ];
    case "object_inventory":
      return [
        { label: "Classification", value: payload.classification },
        { label: "Object size", value: formatBytes(payload.sizeBytes) },
        {
          label: "Prior reads by identity · 90d",
          value: String(payload.priorReadsByIdentity90d),
        },
        {
          label: "Approved export window",
          value: payload.approvedExportWindow ?? "None recorded",
        },
      ];
    case "endpoint_posture":
      return [
        { label: "Owner", value: payload.owner },
        { label: "EDR status", value: payload.edrStatus },
        { label: "Last seen", value: formatUtcTime(payload.lastSeenAt) },
        {
          label: "Isolation supported",
          value: payload.isolationSupported ? "Yes" : "No",
        },
      ];
    case "file_context":
      return [
        { label: "Signer", value: payload.signer },
        {
          label: "Peer prevalence · 30d",
          value: String(payload.prevalence30d),
        },
        { label: "Screening", value: payload.screeningVerdict },
        {
          label: "Contains restricted export",
          value: payload.containsRestrictedExport ? "Yes" : "No",
        },
        {
          label: "Execution observed",
          value: payload.executionObserved ? "Yes" : "No",
        },
      ];
    case "static_analysis_fixture":
      return [
        { label: "Format", value: payload.fileFormat },
        { label: "Signer", value: payload.signer },
        {
          label: "Peer prevalence · 30d",
          value: String(payload.prevalence30d),
        },
        {
          label: "Characteristics",
          value: payload.characteristics
            .map((item) => item.replaceAll("_", " "))
            .join(" · "),
        },
        { label: "Coverage", value: "Deterministic fixture summary only" },
      ];
    case "sandbox_behavior_fixture":
      return [
        { label: "Fixture run", value: payload.fixtureRunId },
        { label: "Profile", value: "Windows 11 Enterprise fixture" },
        {
          label: "Represented behavior",
          value: payload.observedBehaviors
            .map((item) => item.replaceAll("_", " "))
            .join(" · "),
        },
        { label: "Destination", value: payload.networkDestination },
        { label: "External execution", value: "No" },
      ];
    case "destination_context":
      return [
        { label: "Address class", value: "Documentation range" },
        { label: "Inventory match", value: "No" },
        {
          label: "Endpoint connections · 30d",
          value: String(payload.priorEndpointConnections30d),
        },
        { label: "Reputation", value: "Not applicable to fixture address" },
      ];
    case "service_identity_baseline":
      return [
        { label: "Expected scope", value: payload.expectedScope },
        {
          label: "Target logons · 90d",
          value: String(payload.priorTargetLogons90d),
        },
        {
          label: "Credential age",
          value: `${payload.credentialAgeDays} days`,
        },
        {
          label: "Disable / rotate",
          value:
            payload.disableSupported && payload.rotateSupported
              ? "Supported"
              : "Unavailable",
        },
      ];
    case "secret_posture":
      return [
        { label: "Classification", value: payload.classification },
        {
          label: "Last rotation",
          value: `${payload.lastRotationDays} days`,
        },
        { label: "Downstream permission", value: payload.downstreamPermission },
        {
          label: "Rotation supported",
          value: payload.rotateSupported ? "Yes" : "No",
        },
      ];
    case "workload_recovery":
      return [
        { label: "Environment", value: payload.environment },
        { label: "Current image", value: payload.currentImage },
        { label: "Known-good image", value: payload.knownGoodImage },
        {
          label: "Rollback supported",
          value: payload.rollbackSupported ? "Yes" : "No",
        },
      ];
  }
}

function formatBytes(value: number): string {
  return `${(value / 1_000_000).toFixed(1)} MB`;
}
