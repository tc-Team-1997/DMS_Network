export type ReplicationMode = "sync" | "async" | "none";
export type BranchStatus = "Active" | "Degraded" | "Offline";

export interface Branch {
  id: string; code: string; name: string; region?: string;
  replication_mode: ReplicationMode; status: BranchStatus; created_at?: string;
}
export interface NewBranch {
  code: string; name: string; region?: string;
  replication_mode?: ReplicationMode; status?: BranchStatus;
}
export interface BranchAccess {
  id: string; source_branch: string; target_branch: string; policy: "read" | "write"; created_at?: string;
}
export interface NewBranchAccess {
  source_branch: string; target_branch: string; policy?: "read" | "write";
}

// ---- Customer 360 (Task 2) ----
export interface KycRequirement { key: string; label: string; satisfied: boolean; }
export interface CustomerProfile {
  cid: string;
  documents: { id: string; doc_no?: string; doc_type: string; status: string; created_at?: string }[];
  kyc: { requirements: KycRequirement[]; completeness: number; status: "Complete" | "Partial" | "Missing"; escalated: boolean };
  portfolio: { doc_type: string; count: number }[];
  timeline: { ts: string; action: string; entity_id?: string; details?: string }[];
}

// ---- Records Management (Task 3) ----
export interface RetentionPolicy {
  id: string; doc_class: string; retention_years: number; trigger: string; regulation?: string;
}
export interface LegalHold {
  id: string; ref: string; scope: string; status: "Active" | "Released"; doc_count: number;
  placed_by?: string; placed_at?: string; released_at?: string;
}
export interface DisposalCandidate {
  document_id: string; doc_no?: string; doc_type: string; destruction_date: string; on_hold: boolean;
}

// ---- Compliance & Audit (Task 4) ----
export interface FrameworkRow { framework: string; control: string; status: "Met" | "Partial" | "Gap"; evidence?: string; }
export interface ComplianceScorecard {
  score: number; frameworks: { framework: string; met: number; total: number }[];
}
export interface ChainVerification { ok: boolean; checked: number; brokenAt: number | null; }

// ---- Document Lifecycle (Task 5) ----
export interface LifecycleStage { stage: string; at: string | null; actor?: string; detail?: string; complete: boolean; }
export interface LifecycleTrace {
  document_id: string; doc_no?: string; doc_type: string;
  stages: LifecycleStage[];
  versions: { version_no: number; file_hash_sha256: string; created_at?: string; created_by?: string }[];
  funnel: { capture: number; index: number; workflow: number; archive: number; disposal: number };
}

// ---- System Administration / DR (Task 6) ----
export interface ServiceHealth { service: string; status: "Up" | "Degraded" | "Down"; latency_ms: number; }
export interface DrPosture {
  primary_site: string; dr_site: string; rpo_minutes: number; rto_minutes: number;
  replication_lag_seconds: number; last_failover_test?: string;
}
export interface ScheduleEntry { name: string; kind: "backup" | "maintenance"; cron: string; last_run?: string; next_run?: string; }
