export type ReferenceEntityKind =
  | "identity"
  | "session"
  | "network"
  | "application"
  | "permission"
  | "mailbox"
  | "workload"
  | "service_account"
  | "secret"
  | "cloud_role"
  | "workflow"
  | "oidc_subject"
  | "artifact";

export interface ReferenceEntity {
  id: string;
  kind: ReferenceEntityKind;
  label: string;
  summary: string;
  x: number;
  y: number;
  attributes: readonly { label: string; value: string }[];
}

export interface ReferenceEvent {
  id: string;
  timestamp: string;
  source: string;
  action: string;
  summary: string;
  entityIds: readonly string[];
}

export interface ReferenceJoin {
  id: string;
  fromEntityId: string;
  toEntityId: string;
  label: string;
  status: "correlated" | "supporting";
  evidenceIds: readonly string[];
  limitation: string;
}

export interface ReferenceQueryInsight {
  id: string;
  title: string;
  question: string;
  targetEntityId: string;
  capability: string;
  sources: readonly {
    label: string;
    records: number;
    window: string;
  }[];
  matchedRecords: number;
  returnedRecords: number;
  dominantMetric: string;
  result: string;
  caveat: string;
  workspace: "bounded_query" | "fixture_artifact";
}

export interface ReferenceCase {
  id: string;
  title: string;
  summary: string;
  severity: "high";
  timeRange: string;
  sources: readonly string[];
  observedImpact: string;
  primaryQuestion: string;
  entities: readonly ReferenceEntity[];
  events: readonly ReferenceEvent[];
  joins: readonly ReferenceJoin[];
  tier1: {
    reason: string;
    observations: readonly string[];
    recommendations: readonly {
      id: string;
      label: string;
      queryId: string;
      targetEntityId: string;
    }[];
    actionsWithheld: readonly string[];
  };
  queries: readonly ReferenceQueryInsight[];
  techniques: readonly { id: string; label: string; qualification: string }[];
  assessment: {
    disposition: string;
    conclusion: string;
    confirmed: readonly string[];
    limitations: readonly string[];
  };
}

const oauthCase: ReferenceCase = {
  id: "case-oauth-0437",
  title: "OAuth consent followed by mailbox collection",
  summary:
    "A new multitenant application received delegated Mail.Read access and queried one mailbox. No approved integration owner was found.",
  severity: "high",
  timeRange: "09:22–09:38 UTC",
  sources: ["Entra sign-in", "Entra audit", "Microsoft Graph"],
  observedImpact: "184 message records returned from one mailbox",
  primaryQuestion: "Is this integration approved for Maya Chen’s mailbox?",
  entities: [
    {
      id: "identity:maya-chen",
      kind: "identity",
      label: "Maya Chen",
      summary: "Finance Operations analyst and mailbox owner",
      x: 70,
      y: 250,
      attributes: [
        { label: "Provider", value: "Microsoft Entra ID" },
        { label: "Device", value: "Managed · compliant" },
        { label: "MFA", value: "Verified" },
      ],
    },
    {
      id: "session:entra-662",
      kind: "session",
      label: "Entra session 662",
      summary: "MFA-verified browser session",
      x: 300,
      y: 80,
      attributes: [
        { label: "Session", value: "synth-entra-662" },
        { label: "Risk", value: "None reported" },
      ],
    },
    {
      id: "indicator:203.0.113.77",
      kind: "network",
      label: "203.0.113.77",
      summary: "Documentation address outside approved egress inventory",
      x: 550,
      y: 80,
      attributes: [
        { label: "Class", value: "Documentation range" },
        { label: "Inventory", value: "No approved match" },
      ],
    },
    {
      id: "oauth:inbox-sync-pro",
      kind: "application",
      label: "Inbox Sync Pro",
      summary: "New unverified multitenant application",
      x: 330,
      y: 310,
      attributes: [
        { label: "Publisher", value: "Unverified" },
        { label: "Catalog", value: "No approved owner" },
        { label: "Tenant type", value: "Multitenant" },
      ],
    },
    {
      id: "scope:mail-read",
      kind: "permission",
      label: "Mail.Read",
      summary: "Delegated permission to read the consenting mailbox",
      x: 610,
      y: 310,
      attributes: [
        { label: "Consent", value: "User delegated" },
        { label: "Admin consent", value: "Not observed" },
      ],
    },
    {
      id: "mailbox:maya-chen",
      kind: "mailbox",
      label: "maya.chen@example.test",
      summary: "Finance Operations user mailbox",
      x: 900,
      y: 310,
      attributes: [
        { label: "Requests", value: "2" },
        { label: "Returned", value: "184 messages" },
      ],
    },
  ],
  events: [
    {
      id: "EVT-OAUTH-01",
      timestamp: "2026-08-27T09:22:14Z",
      source: "Entra sign-in",
      action: "user.sign_in",
      summary: "Maya Chen completed an MFA-verified sign-in.",
      entityIds: [
        "identity:maya-chen",
        "session:entra-662",
        "indicator:203.0.113.77",
      ],
    },
    {
      id: "EVT-OAUTH-02",
      timestamp: "2026-08-27T09:23:02Z",
      source: "Entra audit",
      action: "application.consent_granted",
      summary: "Maya Chen granted Inbox Sync Pro delegated Mail.Read.",
      entityIds: [
        "identity:maya-chen",
        "oauth:inbox-sync-pro",
        "scope:mail-read",
      ],
    },
    {
      id: "EVT-OAUTH-03",
      timestamp: "2026-08-27T09:23:07Z",
      source: "Entra audit",
      action: "service_principal.observed",
      summary: "Inbox Sync Pro became active through user consent.",
      entityIds: ["oauth:inbox-sync-pro"],
    },
    {
      id: "EVT-OAUTH-04",
      timestamp: "2026-08-27T09:31:18Z",
      source: "Microsoft Graph",
      action: "messages.list",
      summary: "The application returned 100 mailbox records.",
      entityIds: [
        "oauth:inbox-sync-pro",
        "scope:mail-read",
        "mailbox:maya-chen",
      ],
    },
    {
      id: "EVT-OAUTH-05",
      timestamp: "2026-08-27T09:33:49Z",
      source: "Microsoft Graph",
      action: "messages.list",
      summary: "A second request returned 84 additional records.",
      entityIds: [
        "oauth:inbox-sync-pro",
        "scope:mail-read",
        "mailbox:maya-chen",
      ],
    },
    {
      id: "EVT-OAUTH-06",
      timestamp: "2026-08-27T09:38:42Z",
      source: "Microsoft Graph",
      action: "mailbox_access.summary",
      summary: "184 message records were returned in 7 minutes 24 seconds.",
      entityIds: ["oauth:inbox-sync-pro", "mailbox:maya-chen"],
    },
  ],
  joins: [
    {
      id: "JOIN-OAUTH-01",
      fromEntityId: "identity:maya-chen",
      toEntityId: "session:entra-662",
      label: "Authenticated as",
      status: "correlated",
      evidenceIds: ["EVT-OAUTH-01"],
      limitation:
        "MFA success does not establish that the user understood the requested scope.",
    },
    {
      id: "JOIN-OAUTH-02",
      fromEntityId: "session:entra-662",
      toEntityId: "indicator:203.0.113.77",
      label: "Originated from",
      status: "correlated",
      evidenceIds: ["EVT-OAUTH-01"],
      limitation:
        "Documentation-range address; no real geography or ownership claim.",
    },
    {
      id: "JOIN-OAUTH-03",
      fromEntityId: "identity:maya-chen",
      toEntityId: "oauth:inbox-sync-pro",
      label: "Granted consent",
      status: "correlated",
      evidenceIds: ["EVT-OAUTH-02"],
      limitation: "The audit event proves consent, not user intent.",
    },
    {
      id: "JOIN-OAUTH-04",
      fromEntityId: "oauth:inbox-sync-pro",
      toEntityId: "scope:mail-read",
      label: "Received delegated access",
      status: "correlated",
      evidenceIds: ["EVT-OAUTH-02"],
      limitation:
        "Token lifetime and conditional-access evaluation are not modeled.",
    },
    {
      id: "JOIN-OAUTH-05",
      fromEntityId: "scope:mail-read",
      toEntityId: "mailbox:maya-chen",
      label: "Queried mailbox",
      status: "correlated",
      evidenceIds: ["EVT-OAUTH-04", "EVT-OAUTH-05"],
      limitation: "Result counts prove API access, not content exfiltration.",
    },
  ],
  tier1: {
    reason:
      "An unapproved application received Mail.Read and retrieved 184 mailbox records. Tier 1 found no approved owner or expected synchronization pattern.",
    observations: [
      "New application received mailbox-read access",
      "Mailbox collection followed consent",
      "No approved integration record was found",
    ],
    recommendations: [
      {
        id: "OAUTH-STEP-1",
        label: "Verify application ownership",
        queryId: "QRY-OAUTH-APP",
        targetEntityId: "oauth:inbox-sync-pro",
      },
      {
        id: "OAUTH-STEP-2",
        label: "Review granted access",
        queryId: "QRY-OAUTH-SCOPE",
        targetEntityId: "scope:mail-read",
      },
      {
        id: "OAUTH-STEP-3",
        label: "Bound mailbox activity",
        queryId: "QRY-OAUTH-MAIL",
        targetEntityId: "mailbox:maya-chen",
      },
    ],
    actionsWithheld: [
      "Consent revocation",
      "Service-principal disablement",
      "Mailbox access block",
    ],
  },
  queries: [
    {
      id: "QRY-OAUTH-APP",
      title: "Application ownership and approval",
      question: "Is Inbox Sync Pro approved or known?",
      targetEntityId: "oauth:inbox-sync-pro",
      capability: "query_application_inventory",
      sources: [
        {
          label: "Enterprise application inventory",
          records: 18426,
          window: "90 days",
        },
        {
          label: "Approved integration catalog",
          records: 1184,
          window: "Current",
        },
      ],
      matchedRecords: 1,
      returnedRecords: 1,
      dominantMetric: "0 approved owners",
      result:
        "The application is new, unverified, and absent from the approved catalog.",
      caveat: "Catalog absence does not prove malicious intent.",
      workspace: "bounded_query",
    },
    {
      id: "QRY-OAUTH-SCOPE",
      title: "Consent and scope posture",
      question: "What access was granted?",
      targetEntityId: "scope:mail-read",
      capability: "query_consent_history",
      sources: [
        { label: "Entra directory audit", records: 2604118, window: "7 days" },
      ],
      matchedRecords: 2,
      returnedRecords: 2,
      dominantMetric: "1 delegated scope",
      result:
        "Mail.Read was user-granted. No admin consent or additional scope was returned.",
      caveat: "Refresh-token persistence is outside this case record.",
      workspace: "bounded_query",
    },
    {
      id: "QRY-OAUTH-MAIL",
      title: "Mailbox access scope",
      question: "How far did Graph activity extend?",
      targetEntityId: "mailbox:maya-chen",
      capability: "query_graph_activity",
      sources: [
        {
          label: "Microsoft Graph activity",
          records: 864272,
          window: "10 hours",
        },
      ],
      matchedRecords: 3,
      returnedRecords: 3,
      dominantMetric: "184 records · 1 mailbox",
      result:
        "Two list operations returned 184 records. No second mailbox appears in scope.",
      caveat:
        "Message bodies, attachments, and content export are not represented.",
      workspace: "bounded_query",
    },
  ],
  techniques: [
    {
      id: "T1671",
      label: "Cloud Application Integration",
      qualification: "Observed consent event",
    },
    {
      id: "T1114.002",
      label: "Remote Email Collection",
      qualification: "Observed Graph result counts",
    },
    {
      id: "T1550.001",
      label: "Application Access Token",
      qualification: "Investigation lens; token telemetry not present",
    },
  ],
  assessment: {
    disposition: "Keep suspect pending owner confirmation",
    conclusion:
      "The evidence supports an unapproved OAuth integration with observed mailbox API collection. It does not establish content exfiltration or attacker identity.",
    confirmed: [
      "Delegated Mail.Read consent",
      "Unapproved application",
      "184 records returned from one mailbox",
    ],
    limitations: [
      "No message content",
      "No token telemetry",
      "No verified user intent",
    ],
  },
};

const kubernetesCase: ReferenceCase = {
  id: "case-k8s-0414",
  title: "Workload token used outside the cluster",
  summary:
    "A production service-account identity authenticated from outside approved ranges, listed production secrets, and assumed its cloud workload role.",
  severity: "high",
  timeRange: "09:21–09:32 UTC",
  sources: ["Kubernetes audit", "Runtime inventory", "CloudTrail"],
  observedImpact: "14 secret objects listed; no secret-value read observed",
  primaryQuestion: "Approved automation path or suspected token compromise?",
  entities: [
    {
      id: "workload:build-runner",
      kind: "workload",
      label: "build-runner",
      summary: "Production build workload in payments-prod",
      x: 70,
      y: 250,
      attributes: [
        { label: "Namespace", value: "payments-prod" },
        { label: "Pod IP", value: "10.42.18.24" },
        { label: "Token mount", value: "Enabled" },
      ],
    },
    {
      id: "identity:k8s-build-runner",
      kind: "service_account",
      label: "build-runner service account",
      summary: "Workload identity expected to access build metadata only",
      x: 330,
      y: 250,
      attributes: [
        {
          label: "Subject",
          value: "system:serviceaccount:payments-prod:build-runner",
        },
        { label: "Prior external use", value: "0 in 30 days" },
      ],
    },
    {
      id: "indicator:203.0.113.77",
      kind: "network",
      label: "203.0.113.77",
      summary: "Outside cluster, VPN, and approved build-egress ranges",
      x: 600,
      y: 80,
      attributes: [
        { label: "Class", value: "Documentation range" },
        { label: "Policy", value: "Not approved" },
      ],
    },
    {
      id: "secret:payments-prod",
      kind: "secret",
      label: "payments-prod secrets",
      summary: "Fourteen production secret objects",
      x: 610,
      y: 330,
      attributes: [
        { label: "List result", value: "14 objects" },
        { label: "Get secret", value: "Not observed" },
      ],
    },
    {
      id: "role:payments-workload",
      kind: "cloud_role",
      label: "payments-workload",
      summary: "Federated workload role for artifact access",
      x: 900,
      y: 210,
      attributes: [
        { label: "Assumption", value: "Successful" },
        { label: "Follow-on", value: "2 expected registry reads" },
      ],
    },
    {
      id: "artifact:manifest",
      kind: "artifact",
      label: "build-runner manifest",
      summary: "Recorded inventory for binding and expected network path",
      x: 320,
      y: 470,
      attributes: [
        { label: "Image", value: "build-runner:2026.08.27.3" },
        { label: "State", value: "Healthy" },
      ],
    },
  ],
  events: [
    {
      id: "EVT-K8S-01",
      timestamp: "2026-08-27T09:21:48Z",
      source: "Runtime inventory",
      action: "workload.observed",
      summary: "build-runner was healthy with pod IP 10.42.18.24.",
      entityIds: [
        "workload:build-runner",
        "identity:k8s-build-runner",
        "artifact:manifest",
      ],
    },
    {
      id: "EVT-K8S-02",
      timestamp: "2026-08-27T09:29:54Z",
      source: "Kubernetes audit",
      action: "authentication.tokenreview",
      summary: "The service account authenticated from 203.0.113.77.",
      entityIds: ["identity:k8s-build-runner", "indicator:203.0.113.77"],
    },
    {
      id: "EVT-K8S-03",
      timestamp: "2026-08-27T09:30:02Z",
      source: "Kubernetes audit",
      action: "list.pods",
      summary: "The external identity listed 31 pods in payments-prod.",
      entityIds: ["identity:k8s-build-runner", "indicator:203.0.113.77"],
    },
    {
      id: "EVT-K8S-04",
      timestamp: "2026-08-27T09:30:16Z",
      source: "Kubernetes audit",
      action: "list.secrets",
      summary: "The external identity listed 14 secret objects.",
      entityIds: [
        "identity:k8s-build-runner",
        "indicator:203.0.113.77",
        "secret:payments-prod",
      ],
    },
    {
      id: "EVT-K8S-05",
      timestamp: "2026-08-27T09:31:04Z",
      source: "CloudTrail",
      action: "AssumeRoleWithWebIdentity",
      summary:
        "The same subject assumed payments-workload from the external address.",
      entityIds: [
        "identity:k8s-build-runner",
        "role:payments-workload",
        "indicator:203.0.113.77",
      ],
    },
    {
      id: "EVT-K8S-06",
      timestamp: "2026-08-27T09:32:11Z",
      source: "Kubernetes audit",
      action: "list.secrets.complete",
      summary:
        "The list response completed; no Get secret request was observed.",
      entityIds: ["identity:k8s-build-runner", "secret:payments-prod"],
    },
  ],
  joins: [
    {
      id: "JOIN-K8S-01",
      fromEntityId: "workload:build-runner",
      toEntityId: "identity:k8s-build-runner",
      label: "Runs as",
      status: "correlated",
      evidenceIds: ["EVT-K8S-01"],
      limitation:
        "Binding inventory does not identify the process that obtained the token.",
    },
    {
      id: "JOIN-K8S-02",
      fromEntityId: "identity:k8s-build-runner",
      toEntityId: "indicator:203.0.113.77",
      label: "Authenticated from",
      status: "correlated",
      evidenceIds: ["EVT-K8S-02"],
      limitation:
        "API audit proves token use, not token theft or operator identity.",
    },
    {
      id: "JOIN-K8S-03",
      fromEntityId: "identity:k8s-build-runner",
      toEntityId: "secret:payments-prod",
      label: "Listed secret metadata",
      status: "correlated",
      evidenceIds: ["EVT-K8S-04", "EVT-K8S-06"],
      limitation: "A list response does not prove a secret value was read.",
    },
    {
      id: "JOIN-K8S-04",
      fromEntityId: "identity:k8s-build-runner",
      toEntityId: "role:payments-workload",
      label: "Federated into",
      status: "correlated",
      evidenceIds: ["EVT-K8S-02", "EVT-K8S-05"],
      limitation:
        "Shared subject and source do not establish one initiating process.",
    },
    {
      id: "JOIN-K8S-05",
      fromEntityId: "workload:build-runner",
      toEntityId: "artifact:manifest",
      label: "Configured by",
      status: "supporting",
      evidenceIds: ["EVT-K8S-01"],
      limitation:
        "Recorded inventory snapshot; not live cluster configuration.",
    },
  ],
  tier1: {
    reason:
      "A production workload identity used the API outside approved ranges, enumerated resources, and assumed its cloud role. Tier 1 cannot determine whether the token was copied, proxied, or used through an unmodeled approved path.",
    observations: [
      "Production workload identity used outside the cluster",
      "The identity enumerated production secrets",
      "The identity also assumed its cloud workload role",
    ],
    recommendations: [
      {
        id: "K8S-STEP-1",
        label: "Assess workload token posture",
        queryId: "QRY-K8S-WORKLOAD",
        targetEntityId: "workload:build-runner",
      },
      {
        id: "K8S-STEP-2",
        label: "Review service-account permissions",
        queryId: "QRY-K8S-RBAC",
        targetEntityId: "identity:k8s-build-runner",
      },
      {
        id: "K8S-STEP-3",
        label: "Trace cloud-role activity",
        queryId: "QRY-K8S-CLOUD",
        targetEntityId: "role:payments-workload",
      },
    ],
    actionsWithheld: ["Token revocation", "Workload isolation", "RBAC change"],
  },
  queries: [
    {
      id: "QRY-K8S-WORKLOAD",
      title: "Workload and token posture",
      question: "Should this token reach the API from this source?",
      targetEntityId: "workload:build-runner",
      capability: "enrich_kubernetes_workload",
      sources: [
        { label: "Runtime inventory", records: 184226, window: "7 days" },
        { label: "Network inventory", records: 12884, window: "7 days" },
      ],
      matchedRecords: 6,
      returnedRecords: 4,
      dominantMetric: "0 approved external paths",
      result:
        "Token automount is enabled; 203.0.113.77 is not an approved API source.",
      caveat: "Posture does not prove packet-level token exfiltration.",
      workspace: "bounded_query",
    },
    {
      id: "QRY-K8S-RBAC",
      title: "Service-account API baseline",
      question: "Is secret enumeration expected?",
      targetEntityId: "identity:k8s-build-runner",
      capability: "enrich_kubernetes_identity",
      sources: [
        { label: "Kubernetes audit", records: 7384401, window: "30 days" },
        { label: "RBAC inventory", records: 36428, window: "Current" },
      ],
      matchedRecords: 19,
      returnedRecords: 5,
      dominantMetric: "0 prior external requests",
      result:
        "A legacy RoleBinding permits list secrets. No prior external API use appears in 30 days.",
      caveat:
        "Available evidence does not establish complete logging of every environment path.",
      workspace: "bounded_query",
    },
    {
      id: "QRY-K8S-CLOUD",
      title: "Cloud role follow-on activity",
      question: "What happened after role assumption?",
      targetEntityId: "role:payments-workload",
      capability: "query_related_activity",
      sources: [
        {
          label: "CloudTrail role corpus",
          records: 2108823,
          window: "35 minutes",
        },
      ],
      matchedRecords: 3,
      returnedRecords: 3,
      dominantMetric: "0 protected-resource reads",
      result:
        "Only the assumption and two expected registry reads are present.",
      caveat: "The result does not exclude an unmodeled cloud account.",
      workspace: "bounded_query",
    },
  ],
  techniques: [
    {
      id: "T1078",
      label: "Valid Accounts",
      qualification: "Legitimate workload identity used",
    },
    {
      id: "T1613",
      label: "Container and Resource Discovery",
      qualification: "Pod and secret-object enumeration observed",
    },
    {
      id: "T1552.007",
      label: "Container API",
      qualification: "Investigation lens; secret-value access not observed",
    },
  ],
  assessment: {
    disposition: "Suspected service-account token compromise",
    conclusion:
      "The evidence proves externally sourced use of a valid workload identity and secret enumeration. It does not prove token theft, secret-value access, or downstream credential use.",
    confirmed: [
      "External API authentication",
      "Pod and secret enumeration",
      "Cloud-role assumption",
    ],
    limitations: [
      "No secret-value read",
      "No actor attribution",
      "No process-level causality",
    ],
  },
};

const cicdCase: ReferenceCase = {
  id: "case-cicd-0392",
  title: "CI identity published an unreviewed artifact",
  summary:
    "A release workflow used an unexpected OIDC subject, published an image without review attestation, and deployed that digest to production.",
  severity: "high",
  timeRange: "09:14–09:20 UTC",
  sources: [
    "GitHub audit",
    "CloudTrail",
    "ECR",
    "Argo CD",
    "Artifact analysis",
  ],
  observedImpact: "payments-api runs a digest without required provenance",
  primaryQuestion: "Does this release meet the production trust policy?",
  entities: [
    {
      id: "workflow:payments-release",
      kind: "workflow",
      label: "release.yml",
      summary: "Production release workflow",
      x: 50,
      y: 250,
      attributes: [
        { label: "Repository", value: "northstar-example/payments" },
        { label: "Run", value: "90842" },
        { label: "Ref", value: "refs/heads/release" },
      ],
    },
    {
      id: "oidc:pull-request",
      kind: "oidc_subject",
      label: "repo:payments:pull_request",
      summary: "Pull-request subject in a release context",
      x: 270,
      y: 250,
      attributes: [
        { label: "Issuer", value: "token.actions.githubusercontent.com" },
        { label: "Audience", value: "sts.amazonaws.com" },
        { label: "Approved", value: "No" },
      ],
    },
    {
      id: "role:ci-publisher",
      kind: "cloud_role",
      label: "ci-production-publisher",
      summary: "Production artifact publishing role",
      x: 510,
      y: 250,
      attributes: [
        { label: "Assumption", value: "Successful" },
        { label: "Expected subject", value: "release branch" },
      ],
    },
    {
      id: "artifact:payments-7b3d",
      kind: "artifact",
      label: "payments-api@sha256:7b3d…",
      summary: "Production image without review attestation",
      x: 760,
      y: 250,
      attributes: [
        { label: "Review attestation", value: "Missing" },
        { label: "Signature", value: "Absent" },
        { label: "Prior deployments", value: "0 in 90 days" },
      ],
    },
    {
      id: "workload:payments-api",
      kind: "workload",
      label: "payments-api",
      summary: "Production workload on the unreviewed digest",
      x: 1020,
      y: 250,
      attributes: [
        { label: "Environment", value: "Production" },
        { label: "Rollout", value: "Healthy" },
        { label: "Known-good", value: "sha256:4ac9…" },
      ],
    },
    {
      id: "indicator:203.0.113.42",
      kind: "network",
      label: "203.0.113.42",
      summary: "Self-hosted runner egress",
      x: 510,
      y: 460,
      attributes: [
        { label: "Class", value: "Documentation range" },
        { label: "Runner", value: "Self-hosted" },
      ],
    },
  ],
  events: [
    {
      id: "EVT-CICD-01",
      timestamp: "2026-08-27T09:14:12Z",
      source: "GitHub audit",
      action: "workflow_run.completed",
      summary: "release.yml completed from refs/heads/release.",
      entityIds: ["workflow:payments-release"],
    },
    {
      id: "EVT-CICD-02",
      timestamp: "2026-08-27T09:14:19Z",
      source: "GitHub OIDC audit",
      action: "oidc_token.issued",
      summary: "The release run received a pull-request OIDC subject.",
      entityIds: ["workflow:payments-release", "oidc:pull-request"],
    },
    {
      id: "EVT-CICD-03",
      timestamp: "2026-08-27T09:14:22Z",
      source: "CloudTrail",
      action: "AssumeRoleWithWebIdentity",
      summary: "The unexpected subject assumed ci-production-publisher.",
      entityIds: [
        "oidc:pull-request",
        "role:ci-publisher",
        "indicator:203.0.113.42",
      ],
    },
    {
      id: "EVT-CICD-04",
      timestamp: "2026-08-27T09:16:08Z",
      source: "ECR data event",
      action: "PutImage",
      summary: "The role published sha256:7b3d… without review attestation.",
      entityIds: ["role:ci-publisher", "artifact:payments-7b3d"],
    },
    {
      id: "EVT-CICD-05",
      timestamp: "2026-08-27T09:18:11Z",
      source: "Artifact analysis",
      action: "analysis.completed",
      summary: "Archived analysis observed an outbound bootstrap request.",
      entityIds: ["artifact:payments-7b3d"],
    },
    {
      id: "EVT-CICD-06",
      timestamp: "2026-08-27T09:18:56Z",
      source: "Argo CD",
      action: "application.sync",
      summary: "payments-api updated to sha256:7b3d… in production.",
      entityIds: ["artifact:payments-7b3d", "workload:payments-api"],
    },
    {
      id: "EVT-CICD-07",
      timestamp: "2026-08-27T09:20:41Z",
      source: "EKS inventory",
      action: "workload.image.observed",
      summary: "payments-api remained on the published digest.",
      entityIds: ["workload:payments-api"],
    },
  ],
  joins: [
    {
      id: "JOIN-CICD-01",
      fromEntityId: "workflow:payments-release",
      toEntityId: "oidc:pull-request",
      label: "Requested identity",
      status: "correlated",
      evidenceIds: ["EVT-CICD-01", "EVT-CICD-02"],
      limitation:
        "Claim issuance does not identify who initiated the workflow.",
    },
    {
      id: "JOIN-CICD-02",
      fromEntityId: "oidc:pull-request",
      toEntityId: "role:ci-publisher",
      label: "Assumed production role",
      status: "correlated",
      evidenceIds: ["EVT-CICD-02", "EVT-CICD-03"],
      limitation: "Complete IAM trust-policy history is not represented.",
    },
    {
      id: "JOIN-CICD-03",
      fromEntityId: "role:ci-publisher",
      toEntityId: "artifact:payments-7b3d",
      label: "Published artifact",
      status: "correlated",
      evidenceIds: ["EVT-CICD-03", "EVT-CICD-04"],
      limitation:
        "Missing attestation is a provenance failure, not proof of malicious code.",
    },
    {
      id: "JOIN-CICD-04",
      fromEntityId: "artifact:payments-7b3d",
      toEntityId: "workload:payments-api",
      label: "Deployed to production",
      status: "correlated",
      evidenceIds: ["EVT-CICD-04", "EVT-CICD-06", "EVT-CICD-07"],
      limitation:
        "Production runtime and outbound network telemetry are not included.",
    },
    {
      id: "JOIN-CICD-05",
      fromEntityId: "indicator:203.0.113.42",
      toEntityId: "role:ci-publisher",
      label: "Runner egress context",
      status: "supporting",
      evidenceIds: ["EVT-CICD-03"],
      limitation:
        "The documentation address does not establish a real runner owner.",
    },
  ],
  tier1: {
    reason:
      "A release workflow assumed a production role with a pull-request subject, then published and deployed an image without review attestation. Tier 1 cannot establish an approved exception or safe artifact provenance.",
    observations: [
      "Unexpected OIDC subject reached production publishing",
      "Artifact lacks required review attestation",
      "Unreviewed digest reached production",
    ],
    recommendations: [
      {
        id: "CICD-STEP-1",
        label: "Verify OIDC trust condition",
        queryId: "QRY-CICD-TRUST",
        targetEntityId: "oidc:pull-request",
      },
      {
        id: "CICD-STEP-2",
        label: "Inspect artifact provenance",
        queryId: "QRY-CICD-PROVENANCE",
        targetEntityId: "artifact:payments-7b3d",
      },
      {
        id: "CICD-STEP-3",
        label: "Confirm production image state",
        queryId: "QRY-CICD-DEPLOYMENT",
        targetEntityId: "workload:payments-api",
      },
    ],
    actionsWithheld: [
      "Workload rollback",
      "OIDC trust-policy change",
      "Artifact deletion",
    ],
  },
  queries: [
    {
      id: "QRY-CICD-TRUST",
      title: "OIDC subject and trust policy",
      question: "Does the role permit this subject?",
      targetEntityId: "oidc:pull-request",
      capability: "query_trust_policy_history",
      sources: [
        { label: "GitHub OIDC audit", records: 182441, window: "30 days" },
        {
          label: "IAM configuration history",
          records: 3264,
          window: "30 days",
        },
      ],
      matchedRecords: 2,
      returnedRecords: 2,
      dominantMetric: "Subject not approved",
      result:
        "The approved subject is the release branch. No exception permits pull_request.",
      caveat: "Policy evidence is a point-in-time snapshot.",
      workspace: "bounded_query",
    },
    {
      id: "QRY-CICD-PROVENANCE",
      title: "Artifact provenance and analysis",
      question: "What release evidence exists for sha256:7b3d…?",
      targetEntityId: "artifact:payments-7b3d",
      capability: "inspect_artifact_provenance",
      sources: [
        {
          label: "Registry provenance index",
          records: 94122,
          window: "90 days",
        },
        {
          label: "Artifact analysis archive",
          records: 18,
          window: "3 minutes",
        },
      ],
      matchedRecords: 3,
      returnedRecords: 3,
      dominantMetric: "0 attestations · 1 behavior flag",
      result:
        "Review and signing records are absent. Archived analysis observed one outbound bootstrap request.",
      caveat:
        "The artifact result requires review; malicious production behavior is not confirmed.",
      workspace: "fixture_artifact",
    },
    {
      id: "QRY-CICD-DEPLOYMENT",
      title: "Deployment and rollback posture",
      question: "Where is the digest active?",
      targetEntityId: "workload:payments-api",
      capability: "map_deployment_blast_radius",
      sources: [
        { label: "Argo CD history", records: 1268, window: "7 days" },
        { label: "EKS inventory", records: 412, window: "Current" },
      ],
      matchedRecords: 4,
      returnedRecords: 4,
      dominantMetric: "1 workload · rollback ready",
      result:
        "payments-api is the only active workload on sha256:7b3d…. A known-good digest remains available.",
      caveat:
        "Customer impact and runtime process telemetry are not represented.",
      workspace: "bounded_query",
    },
  ],
  techniques: [
    {
      id: "T1078.004",
      label: "Cloud Accounts",
      qualification: "Unexpected workload identity context observed",
    },
    {
      id: "T1195",
      label: "Supply Chain Compromise",
      qualification:
        "Provenance-control failure; malicious artifact not confirmed",
    },
    {
      id: "T1071.001",
      label: "Web Protocols",
      qualification: "Hypothesis based on archived analysis",
    },
  ],
  assessment: {
    disposition: "Keep suspect · preserve and review",
    conclusion:
      "Evidence confirms an unapproved OIDC-to-production publishing path and missing build provenance. It does not establish malicious code or production compromise.",
    confirmed: [
      "Unexpected OIDC subject",
      "Unattested artifact publish",
      "Digest active in production",
    ],
    limitations: [
      "No workflow initiator attribution",
      "No production runtime telemetry",
      "Analysis behavior is supporting evidence",
    ],
  },
};

const referenceCases: readonly ReferenceCase[] = [
  oauthCase,
  kubernetesCase,
  cicdCase,
];

export function getReferenceCase(caseId: string): ReferenceCase | null {
  return referenceCases.find((item) => item.id === caseId) ?? null;
}

export function getReferenceCases(): readonly ReferenceCase[] {
  return referenceCases;
}
