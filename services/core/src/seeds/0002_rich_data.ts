/**
 * 0002_rich_data.ts
 * Rich, realistic seed data for ZorDMS core — Bhutan banking context.
 * Idempotent: each section guards on natural key or table-empty check.
 *
 * Folder paths follow the /BoB/ root convention used by createFolder() in repo/folders.ts.
 */
import type { Knex } from "knex";
import { newId } from "@zordms/db";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------
function sha256(n: number): string {
  // 64-char hex string — real SHA-256 length required by schema
  const base = `${n.toString().padStart(8, "0")}deadbeefcafe`;
  return (base + "0".repeat(64)).slice(0, 64);
}

function storageKey(docId: string, ver: number): string {
  return `docs/${docId}/v${ver}/file.pdf`;
}

function daysFrom(base: Date, delta: number): Date {
  const d = new Date(base);
  d.setDate(d.getDate() + delta);
  return d;
}

function dateStr(d: Date): string {
  return d.toISOString().substring(0, 10);
}

const TODAY = new Date("2026-06-24");

// ---------------------------------------------------------------------------
// Branch data
// ---------------------------------------------------------------------------
const BRANCHES = [
  { code: "THM-HQ", name: "Thimphu HQ",           region: "Western",       replication_mode: "sync",  status: "Active" },
  { code: "PHU-01", name: "Phuentsholing Branch",  region: "Southern",      replication_mode: "async", status: "Active" },
  { code: "PAR-01", name: "Paro Branch",            region: "Western",       replication_mode: "async", status: "Active" },
  { code: "GEL-01", name: "Gelephu Branch",         region: "Central-South", replication_mode: "async", status: "Active" },
  { code: "MON-01", name: "Mongar Branch",          region: "Eastern",       replication_mode: "async", status: "Active" },
  { code: "TRG-01", name: "Trashigang Branch",      region: "Eastern",       replication_mode: "async", status: "Maintenance" },
] as const;

const BRANCH_ACCESS = [
  { source_branch: "THM-HQ", target_branch: "PHU-01", policy: "read" },
  { source_branch: "THM-HQ", target_branch: "PAR-01", policy: "read" },
  { source_branch: "THM-HQ", target_branch: "GEL-01", policy: "read" },
  { source_branch: "THM-HQ", target_branch: "MON-01", policy: "read" },
  { source_branch: "THM-HQ", target_branch: "TRG-01", policy: "read" },
  { source_branch: "PHU-01", target_branch: "THM-HQ", policy: "write" },
];

// ---------------------------------------------------------------------------
// Additional users
// Extra columns for user table: username, full_name, email, branch, region, status
// We keep `role` separate — it is NOT a column in the users table.
// ---------------------------------------------------------------------------
interface UserSpec {
  username: string;
  full_name: string;
  email: string;
  branch: string;
  region: string;
  status: string;
  roleName: string;  // role to assign (not stored in users table)
}

const EXTRA_USERS: UserSpec[] = [
  { username: "dorji.wangchuk",  full_name: "Dorji Wangchuk",  email: "dorji.wangchuk@bobl.bt",  branch: "THM-HQ", region: "Western",       status: "Active", roleName: "Maker"   },
  { username: "pema.lhamo",      full_name: "Pema Lhamo",      email: "pema.lhamo@bobl.bt",      branch: "THM-HQ", region: "Western",       status: "Active", roleName: "Checker" },
  { username: "tshering.dema",   full_name: "Tshering Dema",   email: "tshering.dema@bobl.bt",   branch: "PHU-01", region: "Southern",      status: "Active", roleName: "Indexer" },
  { username: "karma.yangzom",   full_name: "Karma Yangzom",   email: "karma.yangzom@bobl.bt",   branch: "PAR-01", region: "Western",       status: "Active", roleName: "Viewer"  },
  { username: "sonam.tobgay",    full_name: "Sonam Tobgay",    email: "sonam.tobgay@bobl.bt",    branch: "GEL-01", region: "Central-South", status: "Active", roleName: "Maker"   },
  { username: "ugyen.tshomo",    full_name: "Ugyen Tshomo",    email: "ugyen.tshomo@bobl.bt",    branch: "MON-01", region: "Eastern",       status: "Active", roleName: "Auditor" },
];

// ---------------------------------------------------------------------------
// Folder tree — paths MUST start with /BoB/ to match ROOT_PATH convention
// ---------------------------------------------------------------------------
interface FolderSpec {
  name: string;
  path: string;
  domain?: string;
  children?: FolderSpec[];
}

const FOLDER_TREE: FolderSpec[] = [
  {
    name: "BNB-KYC",
    path: "/BoB/BNB-KYC",
    domain: "kyc",
    children: [
      { name: "BNB-Passports",    path: "/BoB/BNB-KYC/BNB-Passports",    domain: "kyc" },
      { name: "BNB-National IDs", path: "/BoB/BNB-KYC/BNB-National IDs", domain: "kyc" },
      { name: "BNB-Utility Bills",path: "/BoB/BNB-KYC/BNB-Utility Bills",domain: "kyc" },
    ],
  },
  {
    name: "BNB-Loans",
    path: "/BoB/BNB-Loans",
    domain: "loans",
    children: [
      { name: "BNB-Applications",  path: "/BoB/BNB-Loans/BNB-Applications",  domain: "loans" },
      { name: "BNB-Disbursements", path: "/BoB/BNB-Loans/BNB-Disbursements", domain: "loans" },
      { name: "BNB-Collateral",    path: "/BoB/BNB-Loans/BNB-Collateral",    domain: "loans" },
    ],
  },
  {
    name: "BNB-Contracts",
    path: "/BoB/BNB-Contracts",
    domain: "contracts",
    children: [
      { name: "BNB-Service Agreements", path: "/BoB/BNB-Contracts/BNB-Service Agreements", domain: "contracts" },
      { name: "BNB-Lease Agreements",   path: "/BoB/BNB-Contracts/BNB-Lease Agreements",   domain: "contracts" },
    ],
  },
  {
    name: "BNB-Compliance",
    path: "/BoB/BNB-Compliance",
    domain: "compliance",
    children: [
      { name: "BNB-AML Reports",            path: "/BoB/BNB-Compliance/BNB-AML Reports",            domain: "compliance" },
      { name: "BNB-Audit Findings",         path: "/BoB/BNB-Compliance/BNB-Audit Findings",         domain: "compliance" },
      { name: "BNB-Regulatory Submissions", path: "/BoB/BNB-Compliance/BNB-Regulatory Submissions", domain: "compliance" },
    ],
  },
  {
    name: "BNB-Archived",
    path: "/BoB/BNB-Archived",
    domain: "archive",
    children: [
      { name: "BNB-Pre-2020 KYC",  path: "/BoB/BNB-Archived/BNB-Pre-2020 KYC",  domain: "archive" },
      { name: "BNB-Closed Loans",  path: "/BoB/BNB-Archived/BNB-Closed Loans",  domain: "archive" },
    ],
  },
];

// ---------------------------------------------------------------------------
// Retention policies
// ---------------------------------------------------------------------------
const RETENTION_POLICIES = [
  { doc_class: "KYC_PASSPORT",       retention_years: 10, trigger: "expiry",  regulation: "FATF AML/CFT — RMA BNB KYC Policy 2021" },
  { doc_class: "KYC_NATIONAL_ID",    retention_years: 10, trigger: "expiry",  regulation: "FATF AML/CFT — RMA BNB KYC Policy 2021" },
  { doc_class: "KYC_UTILITY_BILL",   retention_years: 5,  trigger: "ingest",  regulation: "RMA Circular 02/2019 Address Proof" },
  { doc_class: "LOAN_APPLICATION",   retention_years: 7,  trigger: "closure", regulation: "Companies Act of Bhutan 2016 §48" },
  { doc_class: "LOAN_DISBURSEMENT",  retention_years: 7,  trigger: "closure", regulation: "Companies Act of Bhutan 2016 §48" },
  { doc_class: "CONTRACT_SERVICE",   retention_years: 7,  trigger: "expiry",  regulation: "Contract Act of Bhutan 2013" },
  { doc_class: "CONTRACT_LEASE",     retention_years: 7,  trigger: "expiry",  regulation: "Contract Act of Bhutan 2013" },
  { doc_class: "COMPLIANCE_AML",     retention_years: 5,  trigger: "ingest",  regulation: "Anti-Money Laundering Act of Bhutan 2018" },
  { doc_class: "COMPLIANCE_AUDIT",   retention_years: 10, trigger: "ingest",  regulation: "Audit Act of Bhutan 2018" },
];

// ---------------------------------------------------------------------------
// Legal holds
// ---------------------------------------------------------------------------
const LEGAL_HOLDS = [
  {
    ref: "LH-2026-001",
    scope: "All documents related to CID 11504000231 — ongoing RMA investigation",
    status: "Active",
    doc_count: 4,
    placed_by: "admin",
    placed_at: new Date("2026-03-15"),
  },
  {
    ref: "LH-2026-002",
    scope: "Loan account BOB-L-2024-0077 — fraud review",
    status: "Active",
    doc_count: 7,
    placed_by: "admin",
    placed_at: new Date("2026-04-01"),
  },
  {
    ref: "LH-2025-018",
    scope: "AML suspicious transaction cluster — Q4 2025",
    status: "Released",
    doc_count: 12,
    placed_by: "ugyen.tshomo",
    placed_at: new Date("2025-10-20"),
    released_at: new Date("2026-01-15"),
  },
];

// ---------------------------------------------------------------------------
// Documents (folder_id resolved at seed time)
// ---------------------------------------------------------------------------
interface DocSpec {
  folderPath: string;
  title: string;
  original_filename: string;
  mime_type: string;
  doc_type: string;
  cid: string;
  doc_no: string;
  branch: string;
  status: string;
  review_flag: boolean;
  confidence: number;
  ocr_engine: string;
  page_count: number;
  file_size_bytes: number;
  processing_ms: number;
  retention_years: number;
  destruction_date: string;
  catalog_category: string;
  ingest_user_id: string;
  source_channel: string;
  metadata: Record<string, unknown>;
}

const DOCUMENTS: DocSpec[] = [
  // ── Passports ──────────────────────────────────────────────────────────────
  {
    folderPath: "/BoB/BNB-KYC/BNB-Passports",
    title: "Passport — Dorji Wangchuk",
    original_filename: "DW_passport_BT4829301.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_PASSPORT",
    cid: "11504000231",
    doc_no: "BT4829301",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.97,
    ocr_engine: "tesseract-5",
    page_count: 2,
    file_size_bytes: 348210,
    processing_ms: 1230,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 8)),
    catalog_category: "KYC_PASSPORT",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      full_name: "Dorji Wangchuk",
      dob: "1985-03-12",
      sex: "M",
      nationality: "BTN",
      issue_date: "2022-01-10",
      expiry_date: dateStr(daysFrom(TODAY, 365 * 5 + 10)),
      place_of_issue: "Thimphu",
      cid: "11504000231",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-Passports",
    title: "Passport — Pema Lhamo",
    original_filename: "PL_passport_BT5103872.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_PASSPORT",
    cid: "11701000504",
    doc_no: "BT5103872",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.95,
    ocr_engine: "tesseract-5",
    page_count: 2,
    file_size_bytes: 321540,
    processing_ms: 1100,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 7)),
    catalog_category: "KYC_PASSPORT",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      full_name: "Pema Lhamo",
      dob: "1991-07-22",
      sex: "F",
      nationality: "BTN",
      issue_date: "2023-05-15",
      expiry_date: dateStr(daysFrom(TODAY, 365 * 7)),
      place_of_issue: "Thimphu",
      cid: "11701000504",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-Passports",
    title: "Passport — Karma Yangzom (Expiring Soon)",
    original_filename: "KY_passport_BT3901187.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_PASSPORT",
    cid: "10902000781",
    doc_no: "BT3901187",
    branch: "PAR-01",
    status: "Expiring",
    review_flag: true,
    confidence: 0.93,
    ocr_engine: "tesseract-5",
    page_count: 2,
    file_size_bytes: 305100,
    processing_ms: 980,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 2 + 25)),
    catalog_category: "KYC_PASSPORT",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      full_name: "Karma Yangzom",
      dob: "1979-11-03",
      sex: "F",
      nationality: "BTN",
      issue_date: "2016-02-28",
      expiry_date: dateStr(daysFrom(TODAY, 28)),
      place_of_issue: "Paro",
      cid: "10902000781",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-Passports",
    title: "Passport — Tshering Namgyal (Expiring 60 days)",
    original_filename: "TN_passport_BT4412093.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_PASSPORT",
    cid: "11303000329",
    doc_no: "BT4412093",
    branch: "PHU-01",
    status: "Expiring",
    review_flag: true,
    confidence: 0.91,
    ocr_engine: "tesseract-5",
    page_count: 2,
    file_size_bytes: 318490,
    processing_ms: 1050,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 3)),
    catalog_category: "KYC_PASSPORT",
    ingest_user_id: "tshering.dema",
    source_channel: "SCAN",
    metadata: {
      full_name: "Tshering Namgyal",
      dob: "1988-06-14",
      sex: "M",
      nationality: "BTN",
      issue_date: "2017-08-10",
      expiry_date: dateStr(daysFrom(TODAY, 58)),
      place_of_issue: "Phuentsholing",
      cid: "11303000329",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-Passports",
    title: "Passport — Sonam Tobgay (Expired)",
    original_filename: "ST_passport_BT2800443.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_PASSPORT",
    cid: "10801000156",
    doc_no: "BT2800443",
    branch: "GEL-01",
    status: "Expired",
    review_flag: true,
    confidence: 0.88,
    ocr_engine: "tesseract-5",
    page_count: 2,
    file_size_bytes: 289200,
    processing_ms: 1350,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 5)),
    catalog_category: "KYC_PASSPORT",
    ingest_user_id: "sonam.tobgay",
    source_channel: "SCAN",
    metadata: {
      full_name: "Sonam Tobgay",
      dob: "1975-04-30",
      sex: "M",
      nationality: "BTN",
      issue_date: "2013-09-22",
      expiry_date: dateStr(daysFrom(TODAY, -45)),
      place_of_issue: "Gelephu",
      cid: "10801000156",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-Passports",
    title: "Passport — Ugyen Tshomo (Expiring 90 days)",
    original_filename: "UT_passport_BT4711540.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_PASSPORT",
    cid: "11602000874",
    doc_no: "BT4711540",
    branch: "MON-01",
    status: "Expiring",
    review_flag: false,
    confidence: 0.96,
    ocr_engine: "tesseract-5",
    page_count: 2,
    file_size_bytes: 334180,
    processing_ms: 1120,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 6)),
    catalog_category: "KYC_PASSPORT",
    ingest_user_id: "admin",
    source_channel: "UPLOAD",
    metadata: {
      full_name: "Ugyen Tshomo",
      dob: "1993-12-08",
      sex: "F",
      nationality: "BTN",
      issue_date: "2021-03-17",
      expiry_date: dateStr(daysFrom(TODAY, 87)),
      place_of_issue: "Mongar",
      cid: "11602000874",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-Passports",
    title: "Passport — Jigme Namgyal (Expired)",
    original_filename: "JN_passport_BT3200771.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_PASSPORT",
    cid: "10705000339",
    doc_no: "BT3200771",
    branch: "TRG-01",
    status: "Expired",
    review_flag: true,
    confidence: 0.80,
    ocr_engine: "tesseract-4",
    page_count: 2,
    file_size_bytes: 276000,
    processing_ms: 1800,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 4)),
    catalog_category: "KYC_PASSPORT",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      full_name: "Jigme Namgyal",
      dob: "1965-08-17",
      sex: "M",
      nationality: "BTN",
      issue_date: "2010-11-01",
      expiry_date: dateStr(daysFrom(TODAY, -365 * 6)),
      place_of_issue: "Trashigang",
      cid: "10705000339",
    },
  },

  // ── National IDs (BT_CID_4G) ───────────────────────────────────────────────
  {
    folderPath: "/BoB/BNB-KYC/BNB-National IDs",
    title: "National ID — Dorji Wangchuk",
    original_filename: "DW_CID_11504000231.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_CID_4G",
    cid: "11504000231",
    doc_no: "CID-11504000231",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.98,
    ocr_engine: "tesseract-5",
    page_count: 1,
    file_size_bytes: 214300,
    processing_ms: 820,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 9)),
    catalog_category: "KYC_NATIONAL_ID",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      full_name: "Dorji Wangchuk",
      dob: "1985-03-12",
      sex: "M",
      cid: "11504000231",
      issue_date: "2021-04-01",
      expiry_date: dateStr(daysFrom(TODAY, 365 * 4 + 90)),
      dzongkhag: "Thimphu",
      gewog: "Kawang",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-National IDs",
    title: "National ID — Pema Lhamo",
    original_filename: "PL_CID_11701000504.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_CID_4G",
    cid: "11701000504",
    doc_no: "CID-11701000504",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.99,
    ocr_engine: "tesseract-5",
    page_count: 1,
    file_size_bytes: 198750,
    processing_ms: 780,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 8)),
    catalog_category: "KYC_NATIONAL_ID",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      full_name: "Pema Lhamo",
      dob: "1991-07-22",
      sex: "F",
      cid: "11701000504",
      issue_date: "2022-11-20",
      expiry_date: dateStr(daysFrom(TODAY, 365 * 6)),
      dzongkhag: "Thimphu",
      gewog: "Mewang",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-National IDs",
    title: "National ID — Karma Yangzom (Expiring)",
    original_filename: "KY_CID_10902000781.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_CID_4G",
    cid: "10902000781",
    doc_no: "CID-10902000781",
    branch: "PAR-01",
    status: "Expiring",
    review_flag: true,
    confidence: 0.94,
    ocr_engine: "tesseract-5",
    page_count: 1,
    file_size_bytes: 207600,
    processing_ms: 890,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 3)),
    catalog_category: "KYC_NATIONAL_ID",
    ingest_user_id: "karma.yangzom",
    source_channel: "SCAN",
    metadata: {
      full_name: "Karma Yangzom",
      dob: "1979-11-03",
      sex: "F",
      cid: "10902000781",
      issue_date: "2015-06-14",
      expiry_date: dateStr(daysFrom(TODAY, 25)),
      dzongkhag: "Paro",
      gewog: "Dopshari",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-National IDs",
    title: "National ID — Cheki Wangmo (Expired)",
    original_filename: "CW_CID_10605000418.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_CID_4G",
    cid: "10605000418",
    doc_no: "CID-10605000418",
    branch: "PHU-01",
    status: "Expired",
    review_flag: true,
    confidence: 0.85,
    ocr_engine: "tesseract-5",
    page_count: 1,
    file_size_bytes: 195400,
    processing_ms: 1050,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 4)),
    catalog_category: "KYC_NATIONAL_ID",
    ingest_user_id: "tshering.dema",
    source_channel: "SCAN",
    metadata: {
      full_name: "Cheki Wangmo",
      dob: "1972-09-18",
      sex: "F",
      cid: "10605000418",
      issue_date: "2011-03-30",
      expiry_date: dateStr(daysFrom(TODAY, -120)),
      dzongkhag: "Chhukha",
      gewog: "Phuentsholing",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-National IDs",
    title: "National ID — Rinchen Dorji",
    original_filename: "RD_CID_12001000095.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_CID_4G",
    cid: "12001000095",
    doc_no: "CID-12001000095",
    branch: "MON-01",
    status: "Valid",
    review_flag: false,
    confidence: 0.97,
    ocr_engine: "tesseract-5",
    page_count: 1,
    file_size_bytes: 221300,
    processing_ms: 810,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 8)),
    catalog_category: "KYC_NATIONAL_ID",
    ingest_user_id: "admin",
    source_channel: "UPLOAD",
    metadata: {
      full_name: "Rinchen Dorji",
      dob: "2001-02-14",
      sex: "M",
      cid: "12001000095",
      issue_date: "2024-05-10",
      expiry_date: dateStr(daysFrom(TODAY, 365 * 8)),
      dzongkhag: "Mongar",
      gewog: "Mongar",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-National IDs",
    title: "National ID — Sonam Tobgay",
    original_filename: "ST_CID_10801000156.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_CID_4G",
    cid: "10801000156",
    doc_no: "CID-10801000156",
    branch: "GEL-01",
    status: "Valid",
    review_flag: false,
    confidence: 0.95,
    ocr_engine: "tesseract-5",
    page_count: 1,
    file_size_bytes: 210400,
    processing_ms: 800,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 8)),
    catalog_category: "KYC_NATIONAL_ID",
    ingest_user_id: "sonam.tobgay",
    source_channel: "SCAN",
    metadata: {
      full_name: "Sonam Tobgay",
      dob: "1975-04-30",
      sex: "M",
      cid: "10801000156",
      issue_date: "2022-08-15",
      expiry_date: dateStr(daysFrom(TODAY, 365 * 8)),
      dzongkhag: "Sarpang",
      gewog: "Gelephu",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-National IDs",
    title: "National ID — Ugyen Tshomo",
    original_filename: "UT_CID_11602000874.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_CID_4G",
    cid: "11602000874",
    doc_no: "CID-11602000874",
    branch: "MON-01",
    status: "Valid",
    review_flag: false,
    confidence: 0.96,
    ocr_engine: "tesseract-5",
    page_count: 1,
    file_size_bytes: 205300,
    processing_ms: 820,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 7)),
    catalog_category: "KYC_NATIONAL_ID",
    ingest_user_id: "ugyen.tshomo",
    source_channel: "SCAN",
    metadata: {
      full_name: "Ugyen Tshomo",
      dob: "1993-12-08",
      sex: "F",
      cid: "11602000874",
      issue_date: "2023-01-10",
      expiry_date: dateStr(daysFrom(TODAY, 365 * 7)),
      dzongkhag: "Mongar",
      gewog: "Drametse",
    },
  },

  // ── Utility Bills ──────────────────────────────────────────────────────────
  {
    folderPath: "/BoB/BNB-KYC/BNB-Utility Bills",
    title: "BPC Electricity Bill — Dorji Wangchuk",
    original_filename: "DW_BPC_bill_2026-05.pdf",
    mime_type: "application/pdf",
    doc_type: "UTILITY_BILL",
    cid: "11504000231",
    doc_no: "BPC-2026-05-11504",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.92,
    ocr_engine: "tesseract-5",
    page_count: 1,
    file_size_bytes: 118500,
    processing_ms: 640,
    retention_years: 5,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 5)),
    catalog_category: "KYC_UTILITY_BILL",
    ingest_user_id: "dorji.wangchuk",
    source_channel: "UPLOAD",
    metadata: {
      full_name: "Dorji Wangchuk",
      cid: "11504000231",
      utility_provider: "Bhutan Power Corporation",
      account_no: "BPC-THM-0043211",
      bill_month: "2026-05",
      amount_btu: 2340.5,
      address: "Chang Lam, Thimphu 11001",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-Utility Bills",
    title: "BTCL Bill — Pema Lhamo",
    original_filename: "PL_BTCL_bill_2026-05.pdf",
    mime_type: "application/pdf",
    doc_type: "UTILITY_BILL",
    cid: "11701000504",
    doc_no: "BTCL-2026-05-11701",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.90,
    ocr_engine: "tesseract-5",
    page_count: 1,
    file_size_bytes: 101200,
    processing_ms: 590,
    retention_years: 5,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 5)),
    catalog_category: "KYC_UTILITY_BILL",
    ingest_user_id: "pema.lhamo",
    source_channel: "UPLOAD",
    metadata: {
      full_name: "Pema Lhamo",
      cid: "11701000504",
      utility_provider: "Bhutan Telecom",
      account_no: "BTCL-THM-0098122",
      bill_month: "2026-05",
      amount_btu: 1180.0,
      address: "Norzin Lam, Thimphu 11001",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-Utility Bills",
    title: "BPC Electricity Bill — Tshering Namgyal",
    original_filename: "TN_BPC_bill_2026-04.pdf",
    mime_type: "application/pdf",
    doc_type: "UTILITY_BILL",
    cid: "11303000329",
    doc_no: "BPC-2026-04-11303",
    branch: "PHU-01",
    status: "Valid",
    review_flag: false,
    confidence: 0.89,
    ocr_engine: "tesseract-5",
    page_count: 1,
    file_size_bytes: 109800,
    processing_ms: 612,
    retention_years: 5,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 5)),
    catalog_category: "KYC_UTILITY_BILL",
    ingest_user_id: "tshering.dema",
    source_channel: "SCAN",
    metadata: {
      full_name: "Tshering Namgyal",
      cid: "11303000329",
      utility_provider: "Bhutan Power Corporation",
      account_no: "BPC-PHU-0021344",
      bill_month: "2026-04",
      amount_btu: 3100.0,
      address: "Main Street, Phuentsholing 21001",
    },
  },
  {
    folderPath: "/BoB/BNB-KYC/BNB-Utility Bills",
    title: "Water Bill — Karma Yangzom",
    original_filename: "KY_water_bill_2026-04.pdf",
    mime_type: "application/pdf",
    doc_type: "UTILITY_BILL",
    cid: "10902000781",
    doc_no: "WATER-2026-04-10902",
    branch: "PAR-01",
    status: "Valid",
    review_flag: false,
    confidence: 0.88,
    ocr_engine: "tesseract-5",
    page_count: 1,
    file_size_bytes: 98400,
    processing_ms: 580,
    retention_years: 5,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 5)),
    catalog_category: "KYC_UTILITY_BILL",
    ingest_user_id: "karma.yangzom",
    source_channel: "UPLOAD",
    metadata: {
      full_name: "Karma Yangzom",
      cid: "10902000781",
      utility_provider: "UWSS Bhutan",
      account_no: "UWSS-PAR-0009871",
      bill_month: "2026-04",
      amount_btu: 450.0,
      address: "Near Kichu Road, Paro 21101",
    },
  },

  // ── Loan Applications ──────────────────────────────────────────────────────
  {
    folderPath: "/BoB/BNB-Loans/BNB-Applications",
    title: "Home Loan Application — Dorji Wangchuk",
    original_filename: "DW_home_loan_BOB-L-2025-0041.pdf",
    mime_type: "application/pdf",
    doc_type: "BOB_LOAN_APPLICATION",
    cid: "11504000231",
    doc_no: "BOB-L-2025-0041",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.96,
    ocr_engine: "tesseract-5",
    page_count: 8,
    file_size_bytes: 1245800,
    processing_ms: 4210,
    retention_years: 7,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 7)),
    catalog_category: "LOAN_APPLICATION",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      applicant_name: "Dorji Wangchuk",
      cid: "11504000231",
      loan_type: "Home Loan",
      loan_amount_btu: 2500000,
      purpose: "Construction of residential house",
      application_date: "2025-11-15",
      branch: "Thimphu HQ",
      status: "Approved",
      officer: "pema.lhamo",
    },
  },
  {
    folderPath: "/BoB/BNB-Loans/BNB-Applications",
    title: "Personal Loan Application — Karma Yangzom",
    original_filename: "KY_personal_loan_BOB-L-2026-0012.pdf",
    mime_type: "application/pdf",
    doc_type: "BOB_LOAN_APPLICATION",
    cid: "10902000781",
    doc_no: "BOB-L-2026-0012",
    branch: "PAR-01",
    status: "Valid",
    review_flag: false,
    confidence: 0.94,
    ocr_engine: "tesseract-5",
    page_count: 5,
    file_size_bytes: 780300,
    processing_ms: 2890,
    retention_years: 7,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 7)),
    catalog_category: "LOAN_APPLICATION",
    ingest_user_id: "karma.yangzom",
    source_channel: "UPLOAD",
    metadata: {
      applicant_name: "Karma Yangzom",
      cid: "10902000781",
      loan_type: "Personal Loan",
      loan_amount_btu: 500000,
      purpose: "Medical expenses",
      application_date: "2026-01-28",
      branch: "Paro",
      status: "Under Review",
      officer: "dorji.wangchuk",
    },
  },
  {
    folderPath: "/BoB/BNB-Loans/BNB-Applications",
    title: "Business Loan Application — Sonam Tobgay",
    original_filename: "ST_biz_loan_BOB-L-2025-0077.pdf",
    mime_type: "application/pdf",
    doc_type: "BOB_LOAN_APPLICATION",
    cid: "10801000156",
    doc_no: "BOB-L-2025-0077",
    branch: "GEL-01",
    status: "Valid",
    review_flag: true,
    confidence: 0.87,
    ocr_engine: "tesseract-5",
    page_count: 12,
    file_size_bytes: 2140000,
    processing_ms: 6800,
    retention_years: 7,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 7)),
    catalog_category: "LOAN_APPLICATION",
    ingest_user_id: "sonam.tobgay",
    source_channel: "SCAN",
    metadata: {
      applicant_name: "Sonam Tobgay",
      cid: "10801000156",
      loan_type: "Business Loan",
      loan_amount_btu: 1500000,
      purpose: "Agri-business expansion — chilli cultivation",
      application_date: "2025-09-10",
      branch: "Gelephu",
      status: "Flagged",
      officer: "admin",
      flag_reason: "Passport expired — KYC refresh required",
    },
  },
  {
    folderPath: "/BoB/BNB-Loans/BNB-Applications",
    title: "Vehicle Loan Application — Tshering Dema",
    original_filename: "TD_vehicle_loan_BOB-L-2026-0029.pdf",
    mime_type: "application/pdf",
    doc_type: "BOB_LOAN_APPLICATION",
    cid: "11303000329",
    doc_no: "BOB-L-2026-0029",
    branch: "PHU-01",
    status: "Valid",
    review_flag: false,
    confidence: 0.95,
    ocr_engine: "tesseract-5",
    page_count: 6,
    file_size_bytes: 920400,
    processing_ms: 3150,
    retention_years: 7,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 7)),
    catalog_category: "LOAN_APPLICATION",
    ingest_user_id: "tshering.dema",
    source_channel: "UPLOAD",
    metadata: {
      applicant_name: "Tshering Dema",
      cid: "11303000329",
      loan_type: "Vehicle Loan",
      loan_amount_btu: 750000,
      purpose: "Purchase of Hyundai Tucson",
      application_date: "2026-02-18",
      branch: "Phuentsholing",
      status: "Approved",
      officer: "pema.lhamo",
    },
  },
  {
    folderPath: "/BoB/BNB-Loans/BNB-Applications",
    title: "Education Loan Application — Rinchen Dorji",
    original_filename: "RD_edu_loan_BOB-L-2024-0103.pdf",
    mime_type: "application/pdf",
    doc_type: "BOB_LOAN_APPLICATION",
    cid: "12001000095",
    doc_no: "BOB-L-2024-0103",
    branch: "MON-01",
    status: "Valid",
    review_flag: false,
    confidence: 0.97,
    ocr_engine: "tesseract-5",
    page_count: 4,
    file_size_bytes: 610200,
    processing_ms: 1920,
    retention_years: 7,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 7)),
    catalog_category: "LOAN_APPLICATION",
    ingest_user_id: "ugyen.tshomo",
    source_channel: "SCAN",
    metadata: {
      applicant_name: "Rinchen Dorji",
      cid: "12001000095",
      loan_type: "Education Loan",
      loan_amount_btu: 300000,
      purpose: "Undergraduate studies — RUB Thimphu",
      application_date: "2024-07-05",
      branch: "Mongar",
      status: "Disbursed",
      officer: "admin",
    },
  },
  {
    folderPath: "/BoB/BNB-Loans/BNB-Applications",
    title: "Agricultural Loan — Jigme Namgyal",
    original_filename: "JN_agri_loan_BOB-L-2026-0051.pdf",
    mime_type: "application/pdf",
    doc_type: "BOB_LOAN_APPLICATION",
    cid: "10705000339",
    doc_no: "BOB-L-2026-0051",
    branch: "TRG-01",
    status: "Valid",
    review_flag: true,
    confidence: 0.84,
    ocr_engine: "tesseract-5",
    page_count: 7,
    file_size_bytes: 1050000,
    processing_ms: 3900,
    retention_years: 7,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 7)),
    catalog_category: "LOAN_APPLICATION",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      applicant_name: "Jigme Namgyal",
      cid: "10705000339",
      loan_type: "Agricultural Loan",
      loan_amount_btu: 400000,
      purpose: "Cardamom farming — Trashigang dzongkhag",
      application_date: "2026-03-22",
      branch: "Trashigang",
      status: "Under Review",
      flag_reason: "Expired passport — KYC documents need update",
      officer: "admin",
    },
  },

  // ── Loan Disbursements ─────────────────────────────────────────────────────
  {
    folderPath: "/BoB/BNB-Loans/BNB-Disbursements",
    title: "Disbursement Letter — Home Loan BOB-L-2025-0041",
    original_filename: "DW_home_loan_disbursement.pdf",
    mime_type: "application/pdf",
    doc_type: "LOAN_DISBURSEMENT",
    cid: "11504000231",
    doc_no: "DBR-2025-0041-01",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.98,
    ocr_engine: "tesseract-5",
    page_count: 2,
    file_size_bytes: 280500,
    processing_ms: 900,
    retention_years: 7,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 7)),
    catalog_category: "LOAN_DISBURSEMENT",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      borrower_name: "Dorji Wangchuk",
      cid: "11504000231",
      loan_ref: "BOB-L-2025-0041",
      disbursement_amount_btu: 2500000,
      disbursement_date: "2025-12-20",
      bank_branch: "Thimphu HQ",
      account_no: "BNB-THM-20230189",
    },
  },

  // ── Collateral ─────────────────────────────────────────────────────────────
  {
    folderPath: "/BoB/BNB-Loans/BNB-Collateral",
    title: "Land Deed Thimphu — Dorji Wangchuk",
    original_filename: "DW_land_deed_THP-LR-2019-04512.pdf",
    mime_type: "application/pdf",
    doc_type: "LAND_DEED",
    cid: "11504000231",
    doc_no: "THP-LR-2019-04512",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.93,
    ocr_engine: "tesseract-5",
    page_count: 4,
    file_size_bytes: 845000,
    processing_ms: 2100,
    retention_years: 7,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 7)),
    catalog_category: "LOAN_APPLICATION",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      owner_name: "Dorji Wangchuk",
      cid: "11504000231",
      plot_no: "THP-LR-2019-04512",
      area_sqft: 4200,
      location: "Dechenphu, Thimphu",
      registered_value_btu: 3200000,
      registration_date: "2019-06-15",
    },
  },

  // ── Contracts ─────────────────────────────────────────────────────────────
  {
    folderPath: "/BoB/BNB-Contracts/BNB-Service Agreements",
    title: "IT Services Agreement — TechDruk Pvt Ltd",
    original_filename: "SA-2024-BNB-TECHDRUK.pdf",
    mime_type: "application/pdf",
    doc_type: "SERVICE_CONTRACT",
    cid: "",
    doc_no: "SA-2024-BNB-TECHDRUK",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.96,
    ocr_engine: "tesseract-5",
    page_count: 14,
    file_size_bytes: 2580000,
    processing_ms: 7200,
    retention_years: 7,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 5)),
    catalog_category: "CONTRACT_SERVICE",
    ingest_user_id: "admin",
    source_channel: "UPLOAD",
    metadata: {
      vendor: "TechDruk Private Limited",
      contract_no: "SA-2024-BNB-TECHDRUK",
      scope: "Core banking system maintenance and support",
      start_date: "2024-04-01",
      end_date: dateStr(daysFrom(TODAY, 365 * 2)),
      value_btu: 4500000,
      signed_by: "CDO — BNB",
    },
  },
  {
    folderPath: "/BoB/BNB-Contracts/BNB-Service Agreements",
    title: "Security Services Contract — DrukGuard (Expiring)",
    original_filename: "SA-2025-BNB-DRUKGUARD.pdf",
    mime_type: "application/pdf",
    doc_type: "SERVICE_CONTRACT",
    cid: "",
    doc_no: "SA-2025-BNB-DRUKGUARD",
    branch: "THM-HQ",
    status: "Expiring",
    review_flag: true,
    confidence: 0.94,
    ocr_engine: "tesseract-5",
    page_count: 10,
    file_size_bytes: 1940000,
    processing_ms: 5500,
    retention_years: 7,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 6)),
    catalog_category: "CONTRACT_SERVICE",
    ingest_user_id: "admin",
    source_channel: "UPLOAD",
    metadata: {
      vendor: "DrukGuard Security Pvt Ltd",
      contract_no: "SA-2025-BNB-DRUKGUARD",
      scope: "Physical security — Thimphu HQ and Paro branch",
      start_date: "2025-01-01",
      end_date: dateStr(daysFrom(TODAY, 35)),
      value_btu: 1200000,
      signed_by: "Operations Manager — BNB",
    },
  },
  {
    folderPath: "/BoB/BNB-Contracts/BNB-Lease Agreements",
    title: "Office Lease — Phuentsholing Branch",
    original_filename: "LA-2023-PHU-BRANCH.pdf",
    mime_type: "application/pdf",
    doc_type: "LEASE_CONTRACT",
    cid: "",
    doc_no: "LA-2023-PHU-BRANCH",
    branch: "PHU-01",
    status: "Valid",
    review_flag: false,
    confidence: 0.95,
    ocr_engine: "tesseract-5",
    page_count: 8,
    file_size_bytes: 1320000,
    processing_ms: 3800,
    retention_years: 7,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 5)),
    catalog_category: "CONTRACT_LEASE",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      landlord: "Tshering Penjor",
      tenant: "Bank of Bhutan",
      premises: "Ground Floor, Phuentsholing Commercial Complex",
      monthly_rent_btu: 85000,
      start_date: "2023-07-01",
      end_date: dateStr(daysFrom(TODAY, 365 * 3)),
      deposit_btu: 255000,
    },
  },

  // ── Compliance ─────────────────────────────────────────────────────────────
  {
    folderPath: "/BoB/BNB-Compliance/BNB-AML Reports",
    title: "Suspicious Transaction Report — Q1 2026",
    original_filename: "AML-STR-Q1-2026.pdf",
    mime_type: "application/pdf",
    doc_type: "AML_REPORT",
    cid: "",
    doc_no: "AML-STR-Q1-2026",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.99,
    ocr_engine: "tesseract-5",
    page_count: 22,
    file_size_bytes: 4120000,
    processing_ms: 12400,
    retention_years: 5,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 5)),
    catalog_category: "COMPLIANCE_AML",
    ingest_user_id: "ugyen.tshomo",
    source_channel: "UPLOAD",
    metadata: {
      report_type: "STR",
      period: "2026-Q1",
      submitted_to: "Financial Intelligence Unit — RMA",
      submission_date: "2026-04-15",
      case_count: 7,
      total_flagged_btu: 9800000,
    },
  },
  {
    folderPath: "/BoB/BNB-Compliance/BNB-AML Reports",
    title: "AML Annual Report 2025",
    original_filename: "AML-ANNUAL-2025.pdf",
    mime_type: "application/pdf",
    doc_type: "AML_REPORT",
    cid: "",
    doc_no: "AML-ANNUAL-2025",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.99,
    ocr_engine: "tesseract-5",
    page_count: 48,
    file_size_bytes: 8900000,
    processing_ms: 22100,
    retention_years: 5,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 5)),
    catalog_category: "COMPLIANCE_AML",
    ingest_user_id: "ugyen.tshomo",
    source_channel: "UPLOAD",
    metadata: {
      report_type: "Annual AML",
      period: "2025",
      submitted_to: "Financial Intelligence Unit — RMA",
      submission_date: "2026-01-31",
      case_count: 24,
      total_flagged_btu: 38400000,
    },
  },
  {
    folderPath: "/BoB/BNB-Compliance/BNB-Audit Findings",
    title: "Internal Audit Report — IT Controls 2025",
    original_filename: "AUDIT-IT-2025-Q3.pdf",
    mime_type: "application/pdf",
    doc_type: "AUDIT_REPORT",
    cid: "",
    doc_no: "AUDIT-IT-2025-Q3",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.97,
    ocr_engine: "tesseract-5",
    page_count: 35,
    file_size_bytes: 6500000,
    processing_ms: 18900,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 10)),
    catalog_category: "COMPLIANCE_AUDIT",
    ingest_user_id: "admin",
    source_channel: "UPLOAD",
    metadata: {
      auditor: "Internal Audit Department",
      scope: "IT General Controls — Core Banking, DMS, Network",
      findings_count: 12,
      critical_findings: 2,
      period: "Q3 2025",
    },
  },
  {
    folderPath: "/BoB/BNB-Compliance/BNB-Audit Findings",
    title: "External Audit Report — FY 2024-25",
    original_filename: "EXT-AUDIT-FY2425.pdf",
    mime_type: "application/pdf",
    doc_type: "AUDIT_REPORT",
    cid: "",
    doc_no: "EXT-AUDIT-FY2425",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 0.98,
    ocr_engine: "tesseract-5",
    page_count: 62,
    file_size_bytes: 11400000,
    processing_ms: 31000,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 10)),
    catalog_category: "COMPLIANCE_AUDIT",
    ingest_user_id: "admin",
    source_channel: "UPLOAD",
    metadata: {
      auditor: "Ernst & Young — India (appointed by RMA)",
      scope: "Full financial audit — Bank of Bhutan FY 2024-25",
      findings_count: 8,
      critical_findings: 0,
      opinion: "Unqualified",
    },
  },
  {
    folderPath: "/BoB/BNB-Compliance/BNB-Regulatory Submissions",
    title: "RMA Quarterly Return — Q1 2026",
    original_filename: "RMA-RETURN-Q1-2026.xlsx",
    mime_type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    doc_type: "REGULATORY_RETURN",
    cid: "",
    doc_no: "RMA-RETURN-Q1-2026",
    branch: "THM-HQ",
    status: "Valid",
    review_flag: false,
    confidence: 1.0,
    ocr_engine: "",
    page_count: 1,
    file_size_bytes: 382100,
    processing_ms: 540,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 10)),
    catalog_category: "COMPLIANCE_AUDIT",
    ingest_user_id: "admin",
    source_channel: "UPLOAD",
    metadata: {
      regulator: "Royal Monetary Authority of Bhutan",
      return_type: "Prudential Quarterly Return",
      period: "Q1 2026",
      submission_date: "2026-04-30",
      submitted_by: "Chief Finance Officer",
    },
  },

  // ── Archived ───────────────────────────────────────────────────────────────
  {
    folderPath: "/BoB/BNB-Archived/BNB-Pre-2020 KYC",
    title: "Passport — Tshering Wangdi (Archived 2005)",
    original_filename: "TW_passport_BT1990011_archived.pdf",
    mime_type: "application/pdf",
    doc_type: "BT_PASSPORT",
    cid: "10105000007",
    doc_no: "BT1990011",
    branch: "THM-HQ",
    status: "Expired",
    review_flag: false,
    confidence: 0.82,
    ocr_engine: "tesseract-4",
    page_count: 2,
    file_size_bytes: 298700,
    processing_ms: 2400,
    retention_years: 10,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 1)),
    catalog_category: "KYC_PASSPORT",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      full_name: "Tshering Wangdi",
      dob: "1958-01-20",
      sex: "M",
      nationality: "BTN",
      issue_date: "2005-03-12",
      expiry_date: dateStr(daysFrom(TODAY, -365 * 5)),
      place_of_issue: "Thimphu",
      cid: "10105000007",
    },
  },
  {
    folderPath: "/BoB/BNB-Archived/BNB-Closed Loans",
    title: "Closed Loan — Consumer Loan BOB-L-2018-0034",
    original_filename: "CLOSED_BOB-L-2018-0034.pdf",
    mime_type: "application/pdf",
    doc_type: "BOB_LOAN_APPLICATION",
    cid: "10605000418",
    doc_no: "BOB-L-2018-0034",
    branch: "PHU-01",
    status: "Archived",
    review_flag: false,
    confidence: 0.89,
    ocr_engine: "tesseract-4",
    page_count: 5,
    file_size_bytes: 720000,
    processing_ms: 2200,
    retention_years: 7,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 2)),
    catalog_category: "LOAN_APPLICATION",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      applicant_name: "Cheki Wangmo",
      cid: "10605000418",
      loan_type: "Consumer Loan",
      loan_amount_btu: 200000,
      purpose: "Home furnishing",
      application_date: "2018-05-10",
      closure_date: "2022-05-10",
      branch: "Phuentsholing",
      status: "Closed",
    },
  },
  {
    folderPath: "/BoB/BNB-Archived/BNB-Closed Loans",
    title: "Closed Loan — Education Loan BOB-L-2019-0201",
    original_filename: "CLOSED_BOB-L-2019-0201.pdf",
    mime_type: "application/pdf",
    doc_type: "BOB_LOAN_APPLICATION",
    cid: "11303000329",
    doc_no: "BOB-L-2019-0201",
    branch: "PHU-01",
    status: "Archived",
    review_flag: false,
    confidence: 0.91,
    ocr_engine: "tesseract-4",
    page_count: 3,
    file_size_bytes: 450000,
    processing_ms: 1500,
    retention_years: 7,
    destruction_date: dateStr(daysFrom(TODAY, 365 * 3)),
    catalog_category: "LOAN_APPLICATION",
    ingest_user_id: "admin",
    source_channel: "SCAN",
    metadata: {
      applicant_name: "Tshering Namgyal",
      cid: "11303000329",
      loan_type: "Education Loan",
      loan_amount_btu: 150000,
      purpose: "Class XII repeater fees",
      application_date: "2019-09-01",
      closure_date: "2022-09-01",
      branch: "Phuentsholing",
      status: "Closed",
    },
  },
];

// ---------------------------------------------------------------------------
// Seed entry point
// ---------------------------------------------------------------------------
export async function seed(knex: Knex): Promise<void> {

  // ── 1. Branches ────────────────────────────────────────────────────────────
  for (const b of BRANCHES) {
    const ex = await knex("branches").where({ code: b.code }).first();
    if (!ex) await knex("branches").insert({ id: newId(), ...b });
  }

  // ── 2. Branch access ───────────────────────────────────────────────────────
  for (const ba of BRANCH_ACCESS) {
    const ex = await knex("branch_access")
      .where({ source_branch: ba.source_branch, target_branch: ba.target_branch })
      .first();
    if (!ex) await knex("branch_access").insert({ id: newId(), ...ba });
  }

  // ── 3. Extra users ─────────────────────────────────────────────────────────
  const { hashPassword } = await import("@zordms/auth");
  for (const u of EXTRA_USERS) {
    const ex = await knex("users").where({ username: u.username }).first();
    if (!ex) {
      const password_hash = await hashPassword("Bhutan@1234");
      const userId = newId();
      await knex("users").insert({
        id: userId,
        username: u.username,
        full_name: u.full_name,
        email: u.email,
        branch: u.branch,
        region: u.region,
        status: u.status,
        password_hash,
        created_by: "admin",
      });
      const user = await knex("users").where({ username: u.username }).first();
      const roleRow = await knex("roles").where({ name: u.roleName }).first();
      if (user && roleRow) {
        const link = await knex("user_roles")
          .where({ user_id: user.id, role_id: roleRow.id })
          .first();
        if (!link) await knex("user_roles").insert({ user_id: user.id, role_id: roleRow.id });
      }
    }
  }

  // ── 4. Folder tree ────────────────────────────────────────────────────────
  async function ensureFolder(spec: FolderSpec, parentId?: string): Promise<string> {
    const ex = await knex("folders").where({ path: spec.path }).first();
    if (ex) return ex.id as string;
    const id = newId();
    await knex("folders").insert({
      id,
      name: spec.name,
      path: spec.path,
      domain: spec.domain ?? null,
      parent_id: parentId ?? null,
      created_by: "admin",
    });
    if (spec.children) {
      for (const child of spec.children) {
        await ensureFolder(child, id);
      }
    }
    return id;
  }
  for (const root of FOLDER_TREE) {
    await ensureFolder(root);
  }

  // ── 5. Retention policies ─────────────────────────────────────────────────
  for (const rp of RETENTION_POLICIES) {
    const ex = await knex("retention_policies").where({ doc_class: rp.doc_class }).first();
    if (!ex) await knex("retention_policies").insert({ id: newId(), ...rp });
  }

  // ── 6. Legal holds ────────────────────────────────────────────────────────
  for (const lh of LEGAL_HOLDS) {
    const ex = await knex("legal_holds").where({ ref: lh.ref }).first();
    if (!ex) await knex("legal_holds").insert({ id: newId(), ...lh });
  }

  // ── 7. Documents ──────────────────────────────────────────────────────────
  let docIdx = 100;
  for (const d of DOCUMENTS) {
    docIdx++;
    const folder = await knex("folders").where({ path: d.folderPath }).first();
    const folder_id = folder?.id ?? null;

    // Guard on doc_no (natural key)
    const ex = await knex("documents").where({ doc_no: d.doc_no }).first();
    if (ex) continue;

    const docId = newId();
    await knex("documents").insert({
      id: docId,
      folder_id,
      title: d.title,
      original_filename: d.original_filename,
      mime_type: d.mime_type,
      current_version: 1,
      file_hash_sha256: sha256(docIdx),
      source_channel: d.source_channel,
      ingest_user_id: d.ingest_user_id,
      page_count: d.page_count,
      file_size_bytes: d.file_size_bytes,
      ocr_engine: d.ocr_engine,
      processing_ms: d.processing_ms,
      retention_years: d.retention_years,
      destruction_date: d.destruction_date,
      doc_type: d.doc_type,
      metadata: JSON.stringify(d.metadata),
      catalog_category: d.catalog_category,
      review_flag: d.review_flag,
      confidence: d.confidence,
      branch: d.branch,
      status: d.status,
      cid: d.cid,
      doc_no: d.doc_no,
      ingest_timestamp: new Date(),
    });

    // document_versions v1
    const vEx = await knex("document_versions")
      .where({ document_id: docId, version_no: 1 })
      .first();
    if (!vEx) {
      await knex("document_versions").insert({
        id: newId(),
        document_id: docId,
        version_no: 1,
        storage_key: storageKey(docId, 1),
        file_hash_sha256: sha256(docIdx),
        file_size_bytes: d.file_size_bytes,
        mime_type: d.mime_type,
        created_by: d.ingest_user_id,
        comment: "Initial upload",
      });
    }

    // versions (alias table)
    const vAliasEx = await knex("versions")
      .where({ document_id: docId, version_no: 1 })
      .first();
    if (!vAliasEx) {
      await knex("versions").insert({
        id: newId(),
        document_id: docId,
        version_no: 1,
        file_hash_sha256: sha256(docIdx),
        created_by: d.ingest_user_id,
      });
    }
  }

  // ── 8. Version 2 for a couple of documents ────────────────────────────────
  const passportDorji = await knex("documents").where({ doc_no: "BT4829301" }).first();
  if (passportDorji) {
    const v2Ex = await knex("document_versions")
      .where({ document_id: passportDorji.id, version_no: 2 })
      .first();
    if (!v2Ex) {
      await knex("document_versions").insert({
        id: newId(),
        document_id: passportDorji.id,
        version_no: 2,
        storage_key: storageKey(passportDorji.id, 2),
        file_hash_sha256: sha256(9001),
        file_size_bytes: 352100,
        mime_type: "application/pdf",
        created_by: "dorji.wangchuk",
        comment: "Re-scanned with higher resolution for clarity",
      });
      await knex("versions").insert({
        id: newId(),
        document_id: passportDorji.id,
        version_no: 2,
        file_hash_sha256: sha256(9001),
        created_by: "dorji.wangchuk",
      });
      await knex("documents")
        .where({ id: passportDorji.id })
        .update({ current_version: 2 });
    }
  }

  const loanDorji = await knex("documents").where({ doc_no: "BOB-L-2025-0041" }).first();
  if (loanDorji) {
    const v2Ex = await knex("document_versions")
      .where({ document_id: loanDorji.id, version_no: 2 })
      .first();
    if (!v2Ex) {
      await knex("document_versions").insert({
        id: newId(),
        document_id: loanDorji.id,
        version_no: 2,
        storage_key: storageKey(loanDorji.id, 2),
        file_hash_sha256: sha256(9002),
        file_size_bytes: 1260000,
        mime_type: "application/pdf",
        created_by: "pema.lhamo",
        comment: "Appended collateral valuation addendum",
      });
      await knex("versions").insert({
        id: newId(),
        document_id: loanDorji.id,
        version_no: 2,
        file_hash_sha256: sha256(9002),
        created_by: "pema.lhamo",
      });
      await knex("documents")
        .where({ id: loanDorji.id })
        .update({ current_version: 2 });
    }
  }

  // ── 9. Annotations ────────────────────────────────────────────────────────
  if (passportDorji) {
    const annEx = await knex("annotations")
      .where({ document_id: passportDorji.id, kind: "highlight" })
      .first();
    if (!annEx) {
      await knex("annotations").insert([
        {
          id: newId(),
          document_id: passportDorji.id,
          page: 1,
          kind: "highlight",
          x: 120, y: 210, width: 200, height: 20,
          content: "MRZ line 1 — verified against CID",
          color: "#FFD700",
          created_by: "pema.lhamo",
        },
        {
          id: newId(),
          document_id: passportDorji.id,
          page: 1,
          kind: "redact",
          x: 320, y: 310, width: 80, height: 18,
          content: "Personal signature redacted for public sharing",
          color: "#000000",
          created_by: "admin",
        },
        {
          id: newId(),
          document_id: passportDorji.id,
          page: 1,
          kind: "stamp",
          x: 60, y: 60, width: 120, height: 50,
          content: "VERIFIED — BNB KYC 2026-06-20",
          color: "#0047AB",
          created_by: "dorji.wangchuk",
        },
      ]);
    }
  }

  const loanSonam = await knex("documents").where({ doc_no: "BOB-L-2025-0077" }).first();
  if (loanSonam) {
    const annEx = await knex("annotations")
      .where({ document_id: loanSonam.id, kind: "comment" })
      .first();
    if (!annEx) {
      await knex("annotations").insert([
        {
          id: newId(),
          document_id: loanSonam.id,
          page: 1,
          kind: "comment",
          x: 50, y: 90, width: 300, height: 40,
          content: "KYC refresh required — passport expired 45 days ago. Hold disbursement pending new ID scan.",
          color: "#FF4500",
          created_by: "admin",
        },
      ]);
    }
  }

  // ── 10. Disposal queue ────────────────────────────────────────────────────
  const archivedPassport = await knex("documents").where({ doc_no: "BT1990011" }).first();
  if (archivedPassport) {
    const dispEx = await knex("disposal_queue")
      .where({ document_id: archivedPassport.id })
      .first();
    if (!dispEx) {
      await knex("disposal_queue").insert({
        id: newId(),
        document_id: archivedPassport.id,
        destruction_date: archivedPassport.destruction_date,
        disposed: false,
      });
    }
  }

  const closedLoan2018 = await knex("documents").where({ doc_no: "BOB-L-2018-0034" }).first();
  if (closedLoan2018) {
    const dispEx = await knex("disposal_queue")
      .where({ document_id: closedLoan2018.id })
      .first();
    if (!dispEx) {
      await knex("disposal_queue").insert({
        id: newId(),
        document_id: closedLoan2018.id,
        destruction_date: dateStr(daysFrom(TODAY, 365 * 2)),
        disposed: false,
        certificate: null,
      });
    }
  }

  // ── 11. Folder ACLs ───────────────────────────────────────────────────────
  const kycFolder = await knex("folders").where({ path: "/BoB/BNB-KYC" }).first();
  if (kycFolder) {
    for (const [role, access] of [
      ["CDO", "write"], ["Supervisor", "write"], ["Maker", "write"],
      ["Checker", "read"], ["Indexer", "read"], ["Viewer", "read"], ["Auditor", "read"],
    ] as const) {
      const aclEx = await knex("folder_acls")
        .where({ folder_id: kycFolder.id, role, access })
        .first();
      if (!aclEx) {
        await knex("folder_acls").insert({
          id: newId(),
          folder_id: kycFolder.id,
          role,
          access,
          inherited: false,
        });
      }
    }
  }

  const complianceFolder = await knex("folders").where({ path: "/BoB/BNB-Compliance" }).first();
  if (complianceFolder) {
    for (const [role, access] of [
      ["CDO", "write"], ["Auditor", "read"], ["Viewer", "read"],
    ] as const) {
      const aclEx = await knex("folder_acls")
        .where({ folder_id: complianceFolder.id, role, access })
        .first();
      if (!aclEx) {
        await knex("folder_acls").insert({
          id: newId(),
          folder_id: complianceFolder.id,
          role,
          access,
          inherited: false,
        });
      }
    }
  }
}
