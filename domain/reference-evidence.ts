export interface ReferenceReturnedRecord {
  id: string;
  timestamp: string;
  source: string;
  recordType: string;
  fields: readonly { label: string; value: string }[];
}

export interface ReferenceQueryExecution {
  language: "KQL";
  text: string;
  records: readonly ReferenceReturnedRecord[];
}

const executions: Readonly<Record<string, ReferenceQueryExecution>> = {
  "QRY-OAUTH-APP": {
    language: "KQL",
    text: `EnterpriseApplications
| where AppDisplayName == "Inbox Sync Pro"
| join kind=leftouter ApprovedIntegrations on AppId
| project AppId, PublisherVerification, CreatedAt, ApprovedOwner`,
    records: [
      record(
        "OAUTH-APP-01",
        "2026-08-27T09:23:07Z",
        "Enterprise application inventory",
        "Service principal",
        {
          Application: "Inbox Sync Pro",
          "Publisher verification": "Unverified",
          Created: "2026-08-27T09:23:07Z",
          "Approved owner": "No match",
        },
      ),
    ],
  },
  "QRY-OAUTH-SCOPE": {
    language: "KQL",
    text: `EntraAudit
| where TargetApp == "Inbox Sync Pro"
| where Activity in ("Consent to application", "Add delegated permission grant")
| project TimeGenerated, InitiatedBy, Permission, ConsentType, Result`,
    records: [
      record(
        "OAUTH-SCOPE-01",
        "2026-08-27T09:23:02Z",
        "Entra directory audit",
        "Delegated consent",
        {
          "Initiated by": "Maya Chen",
          Permission: "Mail.Read",
          "Consent type": "Principal",
          Result: "Success",
        },
      ),
      record(
        "OAUTH-SCOPE-02",
        "2026-08-27T09:23:07Z",
        "Entra directory audit",
        "Service principal",
        {
          Application: "Inbox Sync Pro",
          "Admin consent": "Not observed",
          "Additional scopes": "None returned",
        },
      ),
    ],
  },
  "QRY-OAUTH-MAIL": {
    language: "KQL",
    text: `GraphActivity
| where AppDisplayName == "Inbox Sync Pro"
| where RequestUri has "/messages"
| summarize Requests=count(), Records=sum(ResponseRecordCount) by Mailbox
| order by Records desc`,
    records: [
      record(
        "OAUTH-MAIL-01",
        "2026-08-27T09:31:18Z",
        "Microsoft Graph activity",
        "messages.list",
        {
          Mailbox: "maya.chen@example.test",
          "HTTP status": "200",
          "Records returned": "100",
        },
      ),
      record(
        "OAUTH-MAIL-02",
        "2026-08-27T09:33:49Z",
        "Microsoft Graph activity",
        "messages.list",
        {
          Mailbox: "maya.chen@example.test",
          "HTTP status": "200",
          "Records returned": "84",
        },
      ),
      record(
        "OAUTH-MAIL-03",
        "2026-08-27T09:38:42Z",
        "Microsoft Graph activity",
        "Mailbox summary",
        {
          Mailboxes: "1",
          Requests: "2",
          "Records returned": "184",
        },
      ),
    ],
  },
  "QRY-K8S-WORKLOAD": {
    language: "KQL",
    text: `RuntimeInventory
| where Workload == "build-runner" and Namespace == "payments-prod"
| join kind=leftouter ApprovedApiSources on SourceIp
| project Workload, ServiceAccount, TokenAutomount, SourceIp, ApprovedSource`,
    records: [
      record(
        "K8S-WORKLOAD-01",
        "2026-08-27T09:27:02Z",
        "Runtime inventory",
        "Pod posture",
        {
          Workload: "build-runner",
          Namespace: "payments-prod",
          "Service account": "build-runner",
          "Token automount": "Enabled",
        },
      ),
      record(
        "K8S-WORKLOAD-02",
        "2026-08-27T09:27:03Z",
        "Network inventory",
        "API source lookup",
        {
          "Source IP": "203.0.113.77",
          "Approved API source": "No match",
          "Expected boundary": "Cluster pod CIDRs",
        },
      ),
      record(
        "K8S-WORKLOAD-03",
        "2026-08-27T09:27:03Z",
        "Runtime inventory",
        "Token projection",
        {
          Audience: "kubernetes.default.svc",
          Expiration: "Bound token",
          Node: "worker-pool-3",
        },
      ),
      record(
        "K8S-WORKLOAD-04",
        "2026-08-27T09:27:03Z",
        "Network inventory",
        "Observed source",
        {
          "Source IP": "203.0.113.77",
          "Network zone": "External",
          "Prior observations": "0 in 30 days",
        },
      ),
    ],
  },
  "QRY-K8S-RBAC": {
    language: "KQL",
    text: `KubernetesAudit
| where User == "system:serviceaccount:payments-prod:build-runner"
| summarize Requests=count(), FirstSeen=min(TimeGenerated) by Verb, Resource, SourceIp
| join kind=leftouter RbacInventory on User`,
    records: [
      record(
        "K8S-RBAC-01",
        "2026-08-27T09:27:03Z",
        "Kubernetes audit",
        "API request",
        {
          Verb: "list",
          Resource: "pods",
          Namespace: "payments-prod",
          "Source IP": "203.0.113.77",
        },
      ),
      record(
        "K8S-RBAC-02",
        "2026-08-27T09:27:18Z",
        "Kubernetes audit",
        "API request",
        {
          Verb: "list",
          Resource: "secrets",
          Namespace: "payments-prod",
          "Objects returned": "14 metadata records",
        },
      ),
      record(
        "K8S-RBAC-03",
        "2026-08-27T09:27:19Z",
        "RBAC inventory",
        "RoleBinding",
        {
          Binding: "legacy-build-reader",
          Role: "payments-build-reader",
          "Granted verb": "list",
          "Granted resource": "secrets",
        },
      ),
      record(
        "K8S-RBAC-04",
        "2026-08-27T09:27:19Z",
        "Kubernetes audit",
        "Historical baseline",
        {
          "External requests": "0",
          Lookback: "30 days",
          "Expected callers": "Cluster workloads only",
        },
      ),
      record(
        "K8S-RBAC-05",
        "2026-08-27T09:27:19Z",
        "RBAC inventory",
        "Permission review",
        {
          "Service account": "build-runner",
          Namespace: "payments-prod",
          "Secret value reads": "Not granted",
        },
      ),
    ],
  },
  "QRY-K8S-CLOUD": {
    language: "KQL",
    text: `CloudTrail
| where SessionName == "payments-prod:build-runner"
| where TimeGenerated between (datetime(2026-08-27T09:27:00Z) .. datetime(2026-08-27T10:02:00Z))
| project TimeGenerated, EventName, Resource, SourceIp, ErrorCode`,
    records: [
      record(
        "K8S-CLOUD-01",
        "2026-08-27T09:28:05Z",
        "CloudTrail role corpus",
        "AssumeRoleWithWebIdentity",
        {
          Role: "payments-workload",
          Subject: "system:serviceaccount:payments-prod:build-runner",
          Result: "Success",
        },
      ),
      record(
        "K8S-CLOUD-02",
        "2026-08-27T09:29:11Z",
        "CloudTrail role corpus",
        "GetAuthorizationToken",
        {
          Service: "ECR",
          Resource: "payments registry",
          Result: "Success",
        },
      ),
      record(
        "K8S-CLOUD-03",
        "2026-08-27T09:29:14Z",
        "CloudTrail role corpus",
        "BatchGetImage",
        {
          Repository: "payments-api",
          "Protected resource reads": "0",
        },
      ),
    ],
  },
  "QRY-CICD-TRUST": {
    language: "KQL",
    text: `GitHubOidcAudit
| where Repository == "payments-api"
| join kind=leftouter IamTrustHistory on RoleArn
| project TimeGenerated, Subject, WorkflowRef, RoleArn, SubjectAllowed`,
    records: [
      record(
        "CICD-TRUST-01",
        "2026-08-27T09:14:22Z",
        "GitHub OIDC audit",
        "OIDC exchange",
        {
          Repository: "payments-api",
          Subject: "repo:northstar/payments-api:pull_request",
          Workflow: "release.yml",
        },
      ),
      record(
        "CICD-TRUST-02",
        "2026-08-27T09:14:23Z",
        "IAM configuration history",
        "Trust policy",
        {
          Role: "ci-publisher",
          "Approved subject":
            "repo:northstar/payments-api:ref:refs/heads/release",
          "Pull-request exception": "None",
        },
      ),
    ],
  },
  "QRY-CICD-PROVENANCE": {
    language: "KQL",
    text: `RegistryProvenance
| where Digest startswith "sha256:7b3d"
| join kind=leftouter ArtifactAnalysisArchive on Digest
| project Digest, Signature, Attestation, ReviewId, BehaviorSummary`,
    records: [
      record(
        "CICD-PROV-01",
        "2026-08-27T09:16:04Z",
        "Registry provenance index",
        "Artifact manifest",
        {
          Digest: "sha256:7b3d…",
          Signature: "Absent",
          Attestation: "Absent",
          "Review ID": "No match",
        },
      ),
      record(
        "CICD-PROV-02",
        "2026-08-27T09:16:07Z",
        "Artifact analysis archive",
        "Static analysis",
        {
          Digest: "sha256:7b3d…",
          "Critical findings": "0",
          "Review state": "Unreviewed",
        },
      ),
      record(
        "CICD-PROV-03",
        "2026-08-27T09:17:14Z",
        "Artifact analysis archive",
        "Archived detonation",
        {
          "Outbound requests": "1",
          Destination: "203.0.113.91:443",
          Verdict: "Review required",
        },
      ),
    ],
  },
  "QRY-CICD-DEPLOYMENT": {
    language: "KQL",
    text: `DeploymentHistory
| where ImageDigest startswith "sha256:7b3d"
| summarize Workloads=make_set(Workload), Replicas=sum(Replicas) by Environment
| join kind=leftouter KnownGoodImages on Workload`,
    records: [
      record(
        "CICD-DEPLOY-01",
        "2026-08-27T09:20:41Z",
        "Argo CD history",
        "Deployment sync",
        {
          Workload: "payments-api",
          Environment: "production",
          Digest: "sha256:7b3d…",
          "Sync state": "Healthy",
        },
      ),
      record(
        "CICD-DEPLOY-02",
        "2026-08-27T09:20:44Z",
        "EKS inventory",
        "Workload inventory",
        {
          Workload: "payments-api",
          Replicas: "6",
          "Other workloads on digest": "0",
        },
      ),
      record(
        "CICD-DEPLOY-03",
        "2026-08-27T09:20:44Z",
        "Argo CD history",
        "Rollback target",
        {
          "Known-good digest": "sha256:2a91…",
          "Last healthy revision": "payments-api@1924",
        },
      ),
      record(
        "CICD-DEPLOY-04",
        "2026-08-27T09:20:44Z",
        "EKS inventory",
        "Exposure summary",
        {
          Service: "payments-api",
          Namespaces: "production",
          "Customer impact": "Not represented",
        },
      ),
    ],
  },
};

export function getReferenceQueryExecution(
  queryId: string,
): ReferenceQueryExecution | null {
  return executions[queryId] ?? null;
}

function record(
  id: string,
  timestamp: string,
  source: string,
  recordType: string,
  fields: Readonly<Record<string, string>>,
): ReferenceReturnedRecord {
  return {
    id,
    timestamp,
    source,
    recordType,
    fields: Object.entries(fields).map(([label, value]) => ({ label, value })),
  };
}
