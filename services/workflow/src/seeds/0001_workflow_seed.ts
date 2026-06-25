/**
 * ZorDMS Workflow Service — Seed Data
 * Bank of Bhutan (BoB) realistic demo data for the Workflow Engine and Case Management screens.
 *
 * Idempotency: every insert is guarded on a natural unique key (ref_code, case_ref, template name).
 * The seed is safe to run multiple times — re-seeding on boot will not duplicate rows.
 */
import type { Knex } from "knex";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

async function upsertTemplate(
  knex: Knex,
  row: { name: string; doc_type: string; steps_json: string; active: boolean },
): Promise<number> {
  const existing = await knex("workflow_templates").where({ name: row.name }).first();
  if (existing) return existing.id as number;
  await knex("workflow_templates").insert(row);
  const inserted = await knex("workflow_templates").where({ name: row.name }).first();
  return (inserted as { id: number }).id;
}

async function upsertWorkflow(
  knex: Knex,
  row: {
    ref_code: string;
    title: string;
    doc_id?: string;
    template_id: number;
    stage: string;
    priority: string;
    status: string;
    sla_due_at?: string;
    assigned_to?: string;
    created_by?: string;
    created_at?: string;
  },
): Promise<number> {
  const existing = await knex("workflows").where({ ref_code: row.ref_code }).first();
  if (existing) return existing.id as number;
  await knex("workflows").insert(row);
  const inserted = await knex("workflows").where({ ref_code: row.ref_code }).first();
  return (inserted as { id: number }).id;
}

async function upsertCase(
  knex: Knex,
  row: {
    case_ref: string;
    case_type: string;
    title: string;
    status: string;
    assigned_to?: string;
    due_at?: string;
    workflow_id?: number;
    resolution?: string;
    created_by?: string;
    created_at?: string;
    resolved_at?: string;
  },
): Promise<number> {
  const existing = await knex("cases").where({ case_ref: row.case_ref }).first();
  if (existing) return existing.id as number;
  await knex("cases").insert(row);
  const inserted = await knex("cases").where({ case_ref: row.case_ref }).first();
  return (inserted as { id: number }).id;
}

async function addWorkflowStepsIfAbsent(
  knex: Knex,
  workflowId: number,
  steps: Array<{
    seq: number;
    name: string;
    required_permissions: string[];
    min_confidence: number;
    status: string;
    sla_minutes?: number;
    due_at?: string;
    actor_id?: number;
    acted_at?: string;
  }>,
): Promise<void> {
  const existing = await knex("workflow_steps").where({ workflow_id: workflowId }).first();
  if (existing) return; // already seeded
  for (const s of steps) {
    await knex("workflow_steps").insert({
      workflow_id: workflowId,
      seq: s.seq,
      name: s.name,
      required_permissions: JSON.stringify(s.required_permissions),
      min_confidence: s.min_confidence,
      status: s.status,
      sla_minutes: s.sla_minutes ?? null,
      due_at: s.due_at ?? null,
      actor_id: s.actor_id ?? null,
      acted_at: s.acted_at ?? null,
    });
  }
}

// ---------------------------------------------------------------------------
// Dates relative to 2026-06-24 (today) for believable SLA windows
// ---------------------------------------------------------------------------
const NOW = new Date("2026-06-24T06:00:00.000Z");

function daysFromNow(days: number): string {
  return new Date(NOW.getTime() + days * 86_400_000).toISOString();
}

// ---------------------------------------------------------------------------
// Main seed
// ---------------------------------------------------------------------------
export async function seed(knex: Knex): Promise<void> {
  // =========================================================================
  // 1. WORKFLOW TEMPLATES (3)
  // =========================================================================

  // Template A — Standard KYC / Account Opening (3 steps)
  const tplKycId = await upsertTemplate(knex, {
    name: "KYC & Account Opening",
    doc_type: "BT_CID_4G",
    steps_json: JSON.stringify([
      {
        name: "Maker Review",
        required_permissions: ["workflow:act"],
        min_confidence: 0.85,
        sla_minutes: 480, // 8 h
      },
      {
        name: "Checker Approval",
        required_permissions: ["document:approve"],
        min_confidence: 0.9,
        sla_minutes: 240, // 4 h
      },
      {
        name: "Manager Sign-off",
        required_permissions: ["document:approve"],
        min_confidence: 0.92,
        sla_minutes: 120, // 2 h
      },
    ]),
    active: true,
  });

  // Template B — Loan Disbursement (3 steps)
  const tplLoanId = await upsertTemplate(knex, {
    name: "Loan Disbursement",
    doc_type: "LOAN_APP",
    steps_json: JSON.stringify([
      {
        name: "Maker Review",
        required_permissions: ["workflow:act"],
        min_confidence: 0.88,
        sla_minutes: 720, // 12 h
      },
      {
        name: "Checker Approval",
        required_permissions: ["document:approve"],
        min_confidence: 0.9,
        sla_minutes: 480, // 8 h
      },
      {
        name: "Manager Sign-off",
        required_permissions: ["document:approve"],
        min_confidence: 0.95,
        sla_minutes: 240, // 4 h
      },
    ]),
    active: true,
  });

  // Template C — AML / Suspicious Activity Review (2 steps, tighter SLAs)
  const tplAmlId = await upsertTemplate(knex, {
    name: "AML Suspicious Activity Review",
    doc_type: "AML_STR",
    steps_json: JSON.stringify([
      {
        name: "Checker Approval",
        required_permissions: ["document:approve", "workflow:act"],
        min_confidence: 0.92,
        sla_minutes: 180, // 3 h — regulatory urgency
      },
      {
        name: "Manager Sign-off",
        required_permissions: ["document:approve"],
        min_confidence: 0.95,
        sla_minutes: 60, // 1 h
      },
    ]),
    active: true,
  });

  // =========================================================================
  // 2. WORKFLOWS (10) — across stages, priorities, statuses
  // =========================================================================

  // WF-SEED-01 — Active, Maker Review stage, High priority, not yet overdue
  const wf01Id = await upsertWorkflow(knex, {
    ref_code: "WF-SEED-01",
    title: "KYC Onboarding — Dorji Wangchuk (CID 11001234567)",
    doc_id: "DOC-BT-2026-00101",
    template_id: tplKycId,
    stage: "Maker Review",
    priority: "High",
    status: "Active",
    sla_due_at: daysFromNow(1),
    assigned_to: "maker.sonam",
    created_by: "maker.sonam",
    created_at: daysFromNow(-2),
  });
  await addWorkflowStepsIfAbsent(knex, wf01Id, [
    {
      seq: 1,
      name: "Maker Review",
      required_permissions: ["workflow:act"],
      min_confidence: 0.85,
      status: "Pending",
      sla_minutes: 480,
      due_at: daysFromNow(1),
    },
    {
      seq: 2,
      name: "Checker Approval",
      required_permissions: ["document:approve"],
      min_confidence: 0.9,
      status: "Pending",
      sla_minutes: 240,
    },
    {
      seq: 3,
      name: "Manager Sign-off",
      required_permissions: ["document:approve"],
      min_confidence: 0.92,
      status: "Pending",
      sla_minutes: 120,
    },
  ]);

  // WF-SEED-02 — Active, Checker Approval stage, Normal priority, OVERDUE
  const wf02Id = await upsertWorkflow(knex, {
    ref_code: "WF-SEED-02",
    title: "KYC Onboarding — Pema Lhamo (CID 11702987654)",
    doc_id: "DOC-BT-2026-00102",
    template_id: tplKycId,
    stage: "Checker Approval",
    priority: "Normal",
    status: "Active",
    sla_due_at: daysFromNow(-1), // OVERDUE
    assigned_to: "checker.kinley",
    created_by: "maker.sonam",
    created_at: daysFromNow(-5),
  });
  await addWorkflowStepsIfAbsent(knex, wf02Id, [
    {
      seq: 1,
      name: "Maker Review",
      required_permissions: ["workflow:act"],
      min_confidence: 0.85,
      status: "Approved",
      sla_minutes: 480,
      due_at: daysFromNow(-4),
      actor_id: 1,
      acted_at: daysFromNow(-4),
    },
    {
      seq: 2,
      name: "Checker Approval",
      required_permissions: ["document:approve"],
      min_confidence: 0.9,
      status: "Pending",
      sla_minutes: 240,
      due_at: daysFromNow(-1),
    },
    {
      seq: 3,
      name: "Manager Sign-off",
      required_permissions: ["document:approve"],
      min_confidence: 0.92,
      status: "Pending",
      sla_minutes: 120,
    },
  ]);

  // WF-SEED-03 — Active, Manager Sign-off stage, Critical priority, OVERDUE
  const wf03Id = await upsertWorkflow(knex, {
    ref_code: "WF-SEED-03",
    title: "Loan Disbursement — Tshering Choden (BTN 2,500,000)",
    doc_id: "DOC-BT-2026-00201",
    template_id: tplLoanId,
    stage: "Manager Sign-off",
    priority: "Critical",
    status: "Active",
    sla_due_at: daysFromNow(-2), // OVERDUE
    assigned_to: "manager.rinzin",
    created_by: "maker.dawa",
    created_at: daysFromNow(-7),
  });
  await addWorkflowStepsIfAbsent(knex, wf03Id, [
    {
      seq: 1,
      name: "Maker Review",
      required_permissions: ["workflow:act"],
      min_confidence: 0.88,
      status: "Approved",
      sla_minutes: 720,
      due_at: daysFromNow(-6),
      actor_id: 1,
      acted_at: daysFromNow(-6),
    },
    {
      seq: 2,
      name: "Checker Approval",
      required_permissions: ["document:approve"],
      min_confidence: 0.9,
      status: "Approved",
      sla_minutes: 480,
      due_at: daysFromNow(-4),
      actor_id: 2,
      acted_at: daysFromNow(-3),
    },
    {
      seq: 3,
      name: "Manager Sign-off",
      required_permissions: ["document:approve"],
      min_confidence: 0.95,
      status: "Pending",
      sla_minutes: 240,
      due_at: daysFromNow(-2),
    },
  ]);

  // WF-SEED-04 — Approved (Archived equivalent), all steps done
  const wf04Id = await upsertWorkflow(knex, {
    ref_code: "WF-SEED-04",
    title: "KYC Onboarding — Karma Tshering (CID 11301456789)",
    doc_id: "DOC-BT-2026-00103",
    template_id: tplKycId,
    stage: "Completed",
    priority: "Normal",
    status: "Approved",
    sla_due_at: daysFromNow(-10),
    assigned_to: "manager.rinzin",
    created_by: "maker.sonam",
    created_at: daysFromNow(-15),
  });
  await addWorkflowStepsIfAbsent(knex, wf04Id, [
    {
      seq: 1,
      name: "Maker Review",
      required_permissions: ["workflow:act"],
      min_confidence: 0.85,
      status: "Approved",
      sla_minutes: 480,
      due_at: daysFromNow(-14),
      actor_id: 1,
      acted_at: daysFromNow(-14),
    },
    {
      seq: 2,
      name: "Checker Approval",
      required_permissions: ["document:approve"],
      min_confidence: 0.9,
      status: "Approved",
      sla_minutes: 240,
      due_at: daysFromNow(-13),
      actor_id: 2,
      acted_at: daysFromNow(-13),
    },
    {
      seq: 3,
      name: "Manager Sign-off",
      required_permissions: ["document:approve"],
      min_confidence: 0.92,
      status: "Approved",
      sla_minutes: 120,
      due_at: daysFromNow(-12),
      actor_id: 3,
      acted_at: daysFromNow(-12),
    },
  ]);

  // WF-SEED-05 — Rejected
  const wf05Id = await upsertWorkflow(knex, {
    ref_code: "WF-SEED-05",
    title: "Loan Disbursement — Ugyen Dorji (BTN 750,000 — Incomplete Docs)",
    doc_id: "DOC-BT-2026-00202",
    template_id: tplLoanId,
    stage: "Checker Approval",
    priority: "Normal",
    status: "Rejected",
    sla_due_at: daysFromNow(-8),
    assigned_to: "checker.kinley",
    created_by: "maker.dawa",
    created_at: daysFromNow(-10),
  });
  await addWorkflowStepsIfAbsent(knex, wf05Id, [
    {
      seq: 1,
      name: "Maker Review",
      required_permissions: ["workflow:act"],
      min_confidence: 0.88,
      status: "Approved",
      sla_minutes: 720,
      due_at: daysFromNow(-9),
      actor_id: 1,
      acted_at: daysFromNow(-9),
    },
    {
      seq: 2,
      name: "Checker Approval",
      required_permissions: ["document:approve"],
      min_confidence: 0.9,
      status: "Rejected",
      sla_minutes: 480,
      due_at: daysFromNow(-8),
      actor_id: 2,
      acted_at: daysFromNow(-8),
    },
    {
      seq: 3,
      name: "Manager Sign-off",
      required_permissions: ["document:approve"],
      min_confidence: 0.95,
      status: "Pending",
      sla_minutes: 240,
    },
  ]);

  // WF-SEED-06 — OnHold, AML, Critical
  const wf06Id = await upsertWorkflow(knex, {
    ref_code: "WF-SEED-06",
    title: "AML Review — Suspicious Transaction BTN 8,200,000 (Ref: TXN-2026-0611)",
    doc_id: "DOC-BT-2026-00301",
    template_id: tplAmlId,
    stage: "Checker Approval",
    priority: "Critical",
    status: "OnHold",
    sla_due_at: daysFromNow(-3), // OVERDUE while on hold
    assigned_to: "checker.sangay",
    created_by: "maker.sonam",
    created_at: daysFromNow(-4),
  });
  await addWorkflowStepsIfAbsent(knex, wf06Id, [
    {
      seq: 1,
      name: "Checker Approval",
      required_permissions: ["document:approve", "workflow:act"],
      min_confidence: 0.92,
      status: "Pending",
      sla_minutes: 180,
      due_at: daysFromNow(-3),
    },
    {
      seq: 2,
      name: "Manager Sign-off",
      required_permissions: ["document:approve"],
      min_confidence: 0.95,
      status: "Pending",
      sla_minutes: 60,
    },
  ]);

  // WF-SEED-07 — Active, Maker Review stage, Low priority, due in 3 days
  const wf07Id = await upsertWorkflow(knex, {
    ref_code: "WF-SEED-07",
    title: "Account Upgrade — Fixed Deposit — Namgay Wangdi (CID 11404321987)",
    doc_id: "DOC-BT-2026-00104",
    template_id: tplKycId,
    stage: "Maker Review",
    priority: "Low",
    status: "Active",
    sla_due_at: daysFromNow(3),
    assigned_to: "maker.dawa",
    created_by: "maker.dawa",
    created_at: daysFromNow(-1),
  });
  await addWorkflowStepsIfAbsent(knex, wf07Id, [
    {
      seq: 1,
      name: "Maker Review",
      required_permissions: ["workflow:act"],
      min_confidence: 0.85,
      status: "Pending",
      sla_minutes: 480,
      due_at: daysFromNow(3),
    },
    {
      seq: 2,
      name: "Checker Approval",
      required_permissions: ["document:approve"],
      min_confidence: 0.9,
      status: "Pending",
      sla_minutes: 240,
    },
    {
      seq: 3,
      name: "Manager Sign-off",
      required_permissions: ["document:approve"],
      min_confidence: 0.92,
      status: "Pending",
      sla_minutes: 120,
    },
  ]);

  // WF-SEED-08 — Escalated, Loan, High priority
  const wf08Id = await upsertWorkflow(knex, {
    ref_code: "WF-SEED-08",
    title: "Loan Disbursement — Phuntsho Pelbar (BTN 4,800,000 — Escalated for MD Review)",
    doc_id: "DOC-BT-2026-00203",
    template_id: tplLoanId,
    stage: "Manager Sign-off",
    priority: "High",
    status: "Escalated",
    sla_due_at: daysFromNow(0), // due today
    assigned_to: "manager.rinzin",
    created_by: "maker.sonam",
    created_at: daysFromNow(-6),
  });
  await addWorkflowStepsIfAbsent(knex, wf08Id, [
    {
      seq: 1,
      name: "Maker Review",
      required_permissions: ["workflow:act"],
      min_confidence: 0.88,
      status: "Approved",
      sla_minutes: 720,
      due_at: daysFromNow(-5),
      actor_id: 1,
      acted_at: daysFromNow(-5),
    },
    {
      seq: 2,
      name: "Checker Approval",
      required_permissions: ["document:approve"],
      min_confidence: 0.9,
      status: "Approved",
      sla_minutes: 480,
      due_at: daysFromNow(-3),
      actor_id: 2,
      acted_at: daysFromNow(-3),
    },
    {
      seq: 3,
      name: "Manager Sign-off",
      required_permissions: ["document:approve"],
      min_confidence: 0.95,
      status: "Pending",
      sla_minutes: 240,
      due_at: daysFromNow(0),
    },
  ]);

  // WF-SEED-09 — Active, Maker Review, High priority, due tomorrow
  const wf09Id = await upsertWorkflow(knex, {
    ref_code: "WF-SEED-09",
    title: "AML Review — Cross-border Remittance USD 45,000 (Ref: SWIFT-BT-2026-0419)",
    doc_id: "DOC-BT-2026-00302",
    template_id: tplAmlId,
    stage: "Checker Approval",
    priority: "High",
    status: "Active",
    sla_due_at: daysFromNow(1),
    assigned_to: "checker.sangay",
    created_by: "maker.sonam",
    created_at: daysFromNow(-1),
  });
  await addWorkflowStepsIfAbsent(knex, wf09Id, [
    {
      seq: 1,
      name: "Checker Approval",
      required_permissions: ["document:approve", "workflow:act"],
      min_confidence: 0.92,
      status: "Pending",
      sla_minutes: 180,
      due_at: daysFromNow(1),
    },
    {
      seq: 2,
      name: "Manager Sign-off",
      required_permissions: ["document:approve"],
      min_confidence: 0.95,
      status: "Pending",
      sla_minutes: 60,
    },
  ]);

  // WF-SEED-10 — Approved (Archived), Loan, completed 30 days ago
  const wf10Id = await upsertWorkflow(knex, {
    ref_code: "WF-SEED-10",
    title: "Loan Disbursement — Deki Yangzom (BTN 1,200,000 — Home Loan)",
    doc_id: "DOC-BT-2026-00204",
    template_id: tplLoanId,
    stage: "Completed",
    priority: "Normal",
    status: "Approved",
    sla_due_at: daysFromNow(-28),
    assigned_to: "manager.rinzin",
    created_by: "maker.dawa",
    created_at: daysFromNow(-32),
  });
  await addWorkflowStepsIfAbsent(knex, wf10Id, [
    {
      seq: 1,
      name: "Maker Review",
      required_permissions: ["workflow:act"],
      min_confidence: 0.88,
      status: "Approved",
      sla_minutes: 720,
      due_at: daysFromNow(-31),
      actor_id: 1,
      acted_at: daysFromNow(-31),
    },
    {
      seq: 2,
      name: "Checker Approval",
      required_permissions: ["document:approve"],
      min_confidence: 0.9,
      status: "Approved",
      sla_minutes: 480,
      due_at: daysFromNow(-30),
      actor_id: 2,
      acted_at: daysFromNow(-30),
    },
    {
      seq: 3,
      name: "Manager Sign-off",
      required_permissions: ["document:approve"],
      min_confidence: 0.95,
      status: "Approved",
      sla_minutes: 240,
      due_at: daysFromNow(-29),
      actor_id: 3,
      acted_at: daysFromNow(-29),
    },
  ]);

  // =========================================================================
  // 3. CASES (8) — KYC Onboarding / Loan / Account / AML types
  // =========================================================================

  // CASE-KYC-1 — Open, KYC, linked to WF-SEED-01
  await upsertCase(knex, {
    case_ref: "CASE-KYC-SEED-1",
    case_type: "KYC",
    title: "KYC Onboarding — Dorji Wangchuk — Initial Submission",
    status: "Open",
    assigned_to: "maker.sonam",
    due_at: daysFromNow(2),
    workflow_id: wf01Id,
    created_by: "maker.sonam",
    created_at: daysFromNow(-2),
  });

  // CASE-KYC-2 — InReview, KYC, linked to WF-SEED-02 (overdue)
  await upsertCase(knex, {
    case_ref: "CASE-KYC-SEED-2",
    case_type: "KYC",
    title: "KYC Onboarding — Pema Lhamo — Checker Review Pending",
    status: "InReview",
    assigned_to: "checker.kinley",
    due_at: daysFromNow(-1), // OVERDUE
    workflow_id: wf02Id,
    created_by: "maker.sonam",
    created_at: daysFromNow(-5),
  });

  // CASE-Loan-1 — InReview, Loan, linked to WF-SEED-03 (critical, overdue)
  await upsertCase(knex, {
    case_ref: "CASE-Loan-SEED-1",
    case_type: "Loan",
    title: "Loan Application — Tshering Choden — Manager Pending Sign-off",
    status: "InReview",
    assigned_to: "manager.rinzin",
    due_at: daysFromNow(-2), // OVERDUE
    workflow_id: wf03Id,
    created_by: "maker.dawa",
    created_at: daysFromNow(-7),
  });

  // CASE-KYC-3 — Resolved, KYC, linked to WF-SEED-04
  await upsertCase(knex, {
    case_ref: "CASE-KYC-SEED-3",
    case_type: "KYC",
    title: "KYC Onboarding — Karma Tshering — Completed & Archived",
    status: "Resolved",
    assigned_to: "manager.rinzin",
    due_at: daysFromNow(-10),
    workflow_id: wf04Id,
    resolution: "All documents verified. Account approved and activated.",
    created_by: "maker.sonam",
    created_at: daysFromNow(-15),
    resolved_at: daysFromNow(-12),
  });

  // CASE-Loan-2 — Rejected, Loan, linked to WF-SEED-05
  await upsertCase(knex, {
    case_ref: "CASE-Loan-SEED-2",
    case_type: "Loan",
    title: "Loan Application — Ugyen Dorji — Rejected (Missing Income Proof)",
    status: "Rejected",
    assigned_to: "checker.kinley",
    due_at: daysFromNow(-8),
    workflow_id: wf05Id,
    resolution: "Application rejected: Income proof documents not submitted within SLA window.",
    created_by: "maker.dawa",
    created_at: daysFromNow(-10),
    resolved_at: daysFromNow(-8),
  });

  // CASE-AML-1 — Open, AML, linked to WF-SEED-06 (OnHold, critical overdue)
  await upsertCase(knex, {
    case_ref: "CASE-AML-SEED-1",
    case_type: "AML",
    title: "AML Alert — Structured Cash Deposits BTN 8.2M — On Hold Pending FIU Guidance",
    status: "Open",
    assigned_to: "checker.sangay",
    due_at: daysFromNow(-3), // OVERDUE
    workflow_id: wf06Id,
    created_by: "maker.sonam",
    created_at: daysFromNow(-4),
  });

  // CASE-Account-1 — Open, Account type, linked to WF-SEED-07
  await upsertCase(knex, {
    case_ref: "CASE-Account-SEED-1",
    case_type: "Account",
    title: "Account Service — Fixed Deposit Upgrade — Namgay Wangdi",
    status: "Open",
    assigned_to: "maker.dawa",
    due_at: daysFromNow(3),
    workflow_id: wf07Id,
    created_by: "maker.dawa",
    created_at: daysFromNow(-1),
  });

  // CASE-AML-2 — InReview, AML, linked to WF-SEED-09
  await upsertCase(knex, {
    case_ref: "CASE-AML-SEED-2",
    case_type: "AML",
    title: "AML Review — SWIFT Cross-border Remittance USD 45,000 — Monitoring",
    status: "InReview",
    assigned_to: "checker.sangay",
    due_at: daysFromNow(1),
    workflow_id: wf09Id,
    created_by: "maker.sonam",
    created_at: daysFromNow(-1),
  });

  // =========================================================================
  // 4. AUDIT LOG entries for seeded workflows (bootstrap audit trail)
  // =========================================================================
  const auditExists = await knex("workflow_audit")
    .where({ action: "SEED_INIT" })
    .first();

  if (!auditExists) {
    await knex("workflow_audit").insert({
      actor_id: null,
      actor_username: "system",
      action: "SEED_INIT",
      entity: "workflow",
      entity_id: null,
      details: "Bootstrap seed: 3 templates, 10 workflows, 8 cases inserted",
      created_at: NOW.toISOString(),
    });

    // Representative audit trail for the two approved workflows
    await knex("workflow_audit").insert([
      {
        actor_username: "maker.sonam",
        action: "WORKFLOW_CREATE",
        entity: "workflow",
        entity_id: String(wf04Id),
        details: "WF-SEED-04",
        created_at: daysFromNow(-15),
      },
      {
        actor_username: "maker.sonam",
        action: "WORKFLOW_APPROVE",
        entity: "workflow",
        entity_id: String(wf04Id),
        details: "Maker Review approved",
        created_at: daysFromNow(-14),
      },
      {
        actor_username: "checker.kinley",
        action: "WORKFLOW_APPROVE",
        entity: "workflow",
        entity_id: String(wf04Id),
        details: "Checker Approval approved",
        created_at: daysFromNow(-13),
      },
      {
        actor_username: "manager.rinzin",
        action: "WORKFLOW_APPROVE",
        entity: "workflow",
        entity_id: String(wf04Id),
        details: "Manager Sign-off approved — account activated",
        created_at: daysFromNow(-12),
      },
      {
        actor_username: "checker.kinley",
        action: "WORKFLOW_REJECT",
        entity: "workflow",
        entity_id: String(wf05Id),
        details: "Missing income proof — loan rejected",
        created_at: daysFromNow(-8),
      },
    ]);
  }
}
