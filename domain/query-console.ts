export interface QueryConsoleContract {
  language: "KQL";
  text: string;
}

const contracts: Readonly<Record<string, QueryConsoleContract>> = {
  "QRY-CLOUD-IDENTITY-01": {
    language: "KQL",
    text: `let start_time = datetime(2026-05-29T09:00:00Z);
let end_time = datetime(2026-08-27T09:43:00Z);
IdentitySessions
| where Timestamp between (start_time .. end_time)
| where User == "jdoe" and SessionId == "921"
| join kind=leftouter ChangeRecords on ChangeId
| project Timestamp, User, DeviceId, ChangeId, PriorProdAdminSessions30d
| order by Timestamp desc
| take 50`,
  },
  "QRY-CLOUD-EGRESS-02": {
    language: "KQL",
    text: `let start_time = datetime(2026-07-28T00:00:00Z);
let end_time = datetime(2026-08-27T09:43:00Z);
NetworkEgress
| where Timestamp between (start_time .. end_time)
| where SourceIp == "198.51.100.24"
| join kind=leftouter VpnInventory on SourceIp
| project Timestamp, SourceIp, Pop, ApprovalStatus, SessionId, ChangeId
| order by Timestamp desc
| take 50`,
  },
  "QRY-CLOUD-ROLE-03": {
    language: "KQL",
    text: `let start_time = datetime(2026-05-29T00:00:00Z);
let end_time = datetime(2026-08-27T09:43:00Z);
CloudRoleAssumptions
| where Timestamp between (start_time .. end_time)
| where RoleName == "prod-admin"
| join kind=leftouter IamPolicyInventory on RoleName
| project Timestamp, Principal, ObservedRole, RequiredRole, EffectivePrivilege
| order by Timestamp desc
| take 50`,
  },
  "QRY-CLOUD-EXPORT-04": {
    language: "KQL",
    text: `let start_time = datetime(2026-05-29T00:00:00Z);
let end_time = datetime(2026-08-27T10:00:00Z);
CloudObjectAccess
| where Timestamp between (start_time .. end_time)
| where ObjectName == "customer-export.csv"
| join kind=leftouter ChangeScope on ChangeId
| project Timestamp, ObjectName, BytesRead, Principal, ChangeWindow, RoleAuthorized
| order by Timestamp desc
| take 50`,
  },
  "QRY-ENDPOINT-FILE-01": {
    language: "KQL",
    text: `let start_time = datetime(2026-05-30T00:00:00Z);
let end_time = datetime(2026-08-28T14:05:20Z);
DeviceProcessEvents
| where Timestamp between (start_time .. end_time)
| where FileName == "invoice-sync-helper.exe"
| join kind=leftouter DeviceNetworkEvents on DeviceId, InitiatingProcessId
| project Timestamp, DeviceName, FolderPath, ParentProcess, Signer, RemoteUrl, Prevalence
| order by Timestamp desc
| take 100`,
  },
  "QRY-ENDPOINT-STATIC-08": {
    language: "KQL",
    text: `let start_time = datetime(2026-08-28T14:05:20Z);
let end_time = datetime(2026-08-28T14:05:24Z);
StaticAnalysisArtifacts
| where Timestamp between (start_time .. end_time)
| where FileName == "invoice-sync-helper.exe"
| project Timestamp, FileName, Format, Architecture, Signer, ImportedApi, Interpretation
| order by Timestamp desc
| take 50`,
  },
  "QRY-ENDPOINT-SANDBOX-09": {
    language: "KQL",
    text: `let start_time = datetime(2026-08-28T14:05:20Z);
let end_time = datetime(2026-08-28T14:05:25Z);
SandboxBehaviorArtifacts
| where Timestamp between (start_time .. end_time)
| where FileName == "invoice-sync-helper.exe"
| project Timestamp, Profile, BehaviorType, Target, Outcome, ExternalExecution
| order by Timestamp asc
| take 50`,
  },
  "QRY-ENDPOINT-HOST-02": {
    language: "KQL",
    text: `let start_time = datetime(2026-08-21T00:00:00Z);
let end_time = datetime(2026-08-28T14:05:21Z);
DeviceInventory
| where Timestamp between (start_time .. end_time)
| where DeviceName == "FIN-WS-044"
| join kind=leftouter DeviceHealth on DeviceId
| project Timestamp, DeviceName, Owner, EdrStatus, LastSeen, IsolationSupported
| order by Timestamp desc
| take 50`,
  },
  "QRY-ENDPOINT-IDENTITY-03": {
    language: "KQL",
    text: `let start_time = datetime(2026-05-30T00:00:00Z);
let end_time = datetime(2026-08-28T14:05:22Z);
NetworkLogons
| where Timestamp between (start_time .. end_time)
| where AccountName == "svc-fin-reports"
| join kind=leftouter IdentityScope on AccountName
| project Timestamp, AccountName, SourceHost, TargetHost, ExpectedHost, PriorLogons90d
| order by Timestamp desc
| take 100`,
  },
  "QRY-ENDPOINT-EGRESS-04": {
    language: "KQL",
    text: `let start_time = datetime(2026-07-29T00:00:00Z);
let end_time = datetime(2026-08-28T14:05:23Z);
DeviceNetworkEvents
| where Timestamp between (start_time .. end_time)
| where RemoteIP == "203.0.113.91"
| join kind=leftouter ApprovedEgress on RemoteIP
| project Timestamp, DeviceName, RemoteIP, RemotePort, Protocol, Approved, PriorPeer30d
| order by Timestamp desc
| take 100`,
  },
  "QRY-ENDPOINT-APP-05": {
    language: "KQL",
    text: `let start_time = datetime(2026-08-21T00:00:00Z);
let end_time = datetime(2026-08-28T14:05:20Z);
DeviceExecutionEvents
| where Timestamp between (start_time .. end_time)
| where DeviceName == "APP-SRV-021"
| project Timestamp, DeviceName, AccountName, ServiceStartOutcome, PayloadObserved, EdrStatus
| order by Timestamp desc
| take 100`,
  },
  "QRY-ENDPOINT-SECRET-06": {
    language: "KQL",
    text: `let start_time = datetime(2026-05-30T00:00:00Z);
let end_time = datetime(2026-08-28T14:06:16Z);
CloudSecretAudit
| where Timestamp between (start_time .. end_time)
| where SecretName == "ci/deploy/production"
| project Timestamp, SecretName, Principal, Permission, CredentialAge, RotationSupported
| order by Timestamp desc
| take 50`,
  },
  "QRY-ENDPOINT-WORKLOAD-07": {
    language: "KQL",
    text: `let start_time = datetime(2026-07-29T00:00:00Z);
let end_time = datetime(2026-08-28T14:06:17Z);
WorkloadDeployments
| where Timestamp between (start_time .. end_time)
| where WorkloadName == "billing-api"
| project Timestamp, WorkloadName, CurrentImage, KnownGoodImage, Environment, RollbackSupported
| order by Timestamp desc
| take 50`,
  },
};

export function getQueryConsoleContract(
  queryId: string,
): QueryConsoleContract | null {
  return contracts[queryId] ?? null;
}

export function normalizeQueryConsoleText(value: string): string {
  return value
    .normalize("NFKC")
    .trim()
    .replaceAll(/\s+/g, " ")
    .toLocaleLowerCase("en-US");
}

export function matchesQueryConsoleContract(
  queryId: string,
  value: string,
): boolean {
  const contract = getQueryConsoleContract(queryId);
  return (
    contract !== null &&
    normalizeQueryConsoleText(value) ===
      normalizeQueryConsoleText(contract.text)
  );
}
