import type { Knex } from "knex";
import { newId } from "@zordms/db";
import { buildTokensForDoc } from "../query/tokenize.js";
import type { SearchDoc } from "@zordms/types";

// ---------------------------------------------------------------------------
// Realistic Bhutan-bank seed data for @zordms/search
// Covers major doc types, all branches, all risk bands, various statuses,
// legal-hold cases, and different expiry states so every filter/facet shows
// real content rather than empty state.
// ---------------------------------------------------------------------------

const BOB_BRANCHES = [
  "Thimphu Main",
  "Paro",
  "Punakha",
  "Wangdue Phodrang",
  "Trongsa",
  "Bumthang",
  "Mongar",
  "Trashigang",
  "Phuentsholing",
  "Gelephu",
] as const;

// Pre-computed for 2026-06-24 "now" context
const NOW = "2026-06-24T00:00:00.000Z";
const TS = (daysAgo: number) => {
  const d = new Date("2026-06-24T00:00:00.000Z");
  d.setDate(d.getDate() - daysAgo);
  return d.toISOString();
};

interface SeedDoc {
  doc_id: string;
  ocr_text: string;
  metadata_text: string;
  doc_type: string;
  branch: string;
  status: string;
  risk_band: string;
  legal_hold: boolean;
  expiry_status: string;
  uploaded_by: string;
  indexed_at: string;
}

function buildRow(d: SeedDoc) {
  const pseudo: SearchDoc = {
    doc_id: d.doc_id,
    ocr_text: d.ocr_text,
    metadata_text: d.metadata_text,
    doc_type: d.doc_type,
    branch: d.branch,
    status: d.status,
    risk_band: d.risk_band,
    legal_hold: d.legal_hold,
    expiry_status: d.expiry_status,
    uploaded_by: d.uploaded_by,
    indexed_at: d.indexed_at,
  };
  return {
    ...d,
    tokens: buildTokensForDoc(pseudo),
  };
}

const SEARCH_DOCS: SeedDoc[] = [
  // ---- Loan Applications ------------------------------------------------
  {
    doc_id: "BOB-LA-2026-0001",
    ocr_text:
      "BANK OF BHUTAN LIMITED — LOAN APPLICATION\nCustomer Name: Karma Wangchuk Tshering\nCID: 11410003421\nBranch: Thimphu Main\nLoan Type: Home Loan\nAmount Requested: BTN 3,500,000\nPurpose: Residential property purchase at Chang Lam, Thimphu\nEmployment: Civil Servant, MoHCA, Grade P3\nMonthly Salary: BTN 62,000\nGuarantor: Sonam Pelden (CID 11410006512)\nDate of Application: 2026-05-12",
    metadata_text:
      "doc_no=BOB-LA-2026-0001 customer=Karma Wangchuk Tshering cid=11410003421 loan_type=Home product=Housing loan amount_btn=3500000 branch=Thimphu Main region=Western",
    doc_type: "BOB_LOAN_APPLICATION",
    branch: "Thimphu Main",
    status: "pending_review",
    risk_band: "medium",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "maker.tenzin",
    indexed_at: TS(12),
  },
  {
    doc_id: "BOB-LA-2026-0002",
    ocr_text:
      "BANK OF BHUTAN LIMITED — LOAN APPLICATION\nCustomer Name: Tshering Dema\nCID: 10314002876\nBranch: Paro\nLoan Type: Agriculture Loan\nAmount Requested: BTN 850,000\nPurpose: Purchase of farm machinery and apple orchard expansion, Dopshari Village, Paro\nOccupation: Farmer\nLand Certificate No: LC-PL-2019-04412\nDate of Application: 2026-04-28",
    metadata_text:
      "doc_no=BOB-LA-2026-0002 customer=Tshering Dema cid=10314002876 loan_type=Agriculture product=Farm equipment branch=Paro region=Western amount_btn=850000",
    doc_type: "BOB_LOAN_APPLICATION",
    branch: "Paro",
    status: "approved",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "maker.ugyen",
    indexed_at: TS(45),
  },
  {
    doc_id: "BOB-LA-2026-0003",
    ocr_text:
      "BANK OF BHUTAN LIMITED — LOAN APPLICATION\nCustomer Name: Rinchen Namgyel\nCID: 11715008933\nBranch: Gelephu\nLoan Type: Business Loan\nAmount Requested: BTN 7,200,000\nPurpose: Commercial building construction, Gelephu Industrial Zone\nBusiness Registration: MCI-2021-BU-9845\nDate of Application: 2026-03-15\nREJECTED — insufficient collateral (assessed 2026-04-02)",
    metadata_text:
      "doc_no=BOB-LA-2026-0003 customer=Rinchen Namgyel cid=11715008933 loan_type=Business branch=Gelephu region=Southern amount_btn=7200000 outcome=rejected",
    doc_type: "BOB_LOAN_APPLICATION",
    branch: "Gelephu",
    status: "rejected",
    risk_band: "high",
    legal_hold: false,
    expiry_status: "le90",
    uploaded_by: "checker.pema",
    indexed_at: TS(90),
  },
  // ---- KYC / CID Documents -----------------------------------------------
  {
    doc_id: "BT-CID-2026-0101",
    ocr_text:
      "CITIZENSHIP IDENTITY CARD — KINGDOM OF BHUTAN\nCID Number: 11301005678\nFull Name: Dechen Zangmo\nDate of Birth: 15-Mar-1988\nGewog: Kawang\nDzongkhag: Thimphu\nIssued: 10-Jan-2020\nExpiry: 09-Jan-2030\nIssuing Authority: DPRS, MoHCA",
    metadata_text:
      "doc_no=BT-CID-2026-0101 customer=Dechen Zangmo cid=11301005678 doc_class=Identity branch=Thimphu Main kyc_type=CID region=Western",
    doc_type: "BT_CID_4G",
    branch: "Thimphu Main",
    status: "indexed",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "indexer.namgay",
    indexed_at: TS(3),
  },
  {
    doc_id: "BT-CID-2026-0102",
    ocr_text:
      "CITIZENSHIP IDENTITY CARD — KINGDOM OF BHUTAN\nCID Number: 10201009912\nFull Name: Phurba Namgyel\nDate of Birth: 22-Jul-1975\nGewog: Dopshari\nDzongkhag: Paro\nIssued: 05-Jun-2019\nExpiry: 04-Jun-2024\nIssuing Authority: DPRS, MoHCA\n[WARNING: CID EXPIRED — renewal required]",
    metadata_text:
      "doc_no=BT-CID-2026-0102 customer=Phurba_Namgyel cid=10201009912 doc_class=Identity branch=Paro kyc_type=CID region=Western expired=true",
    doc_type: "BT_CID_4G",
    branch: "Paro",
    status: "flagged",
    risk_band: "medium",
    legal_hold: false,
    expiry_status: "expired",
    uploaded_by: "indexer.sonam",
    indexed_at: TS(60),
  },
  {
    doc_id: "BT-CID-2026-0103",
    ocr_text:
      "CITIZENSHIP IDENTITY CARD — KINGDOM OF BHUTAN\nCID Number: 11112007345\nFull Name: Kinley Wangmo\nDate of Birth: 08-Nov-1995\nGewog: Nahi\nDzongkhag: Wangdue Phodrang\nIssued: 22-Feb-2023\nExpiry: 21-Feb-2033\nIssuing Authority: DPRS, MoHCA",
    metadata_text:
      "doc_no=BT-CID-2026-0103 customer=Kinley Wangmo cid=11112007345 branch=Wangdue Phodrang kyc_type=CID region=Western",
    doc_type: "BT_CID_4G",
    branch: "Wangdue Phodrang",
    status: "indexed",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "indexer.tashi",
    indexed_at: TS(7),
  },
  // ---- Trade Licence -------------------------------------------------------
  {
    doc_id: "MCI-TL-2026-0201",
    ocr_text:
      "MINISTRY OF INDUSTRY, COMMERCE AND EMPLOYMENT\nTRADE LICENCE\nLicence No: TL-PHL-2024-03317\nBusiness Name: Bhutan Dragon Handicrafts Pvt Ltd\nProprietor: Ugyen Wangdi (CID 10501004221)\nActivity: Manufacturing and export of traditional handicrafts\nAddress: Lower Market, Phuentsholing\nValid From: 01-Jan-2024\nValid To: 31-Dec-2026\nIssuing Officer: Regional Director, MoICE",
    metadata_text:
      "doc_no=MCI-TL-2026-0201 business=Bhutan_Dragon_Handicrafts owner=Ugyen_Wangdi cid=10501004221 licence_no=TL-PHL-2024-03317 branch=Phuentsholing region=Southern expiry_date=2026-12-31",
    doc_type: "MCI_TRADE_LICENCE",
    branch: "Phuentsholing",
    status: "indexed",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "le90",
    uploaded_by: "maker.karma",
    indexed_at: TS(20),
  },
  {
    doc_id: "MCI-TL-2026-0202",
    ocr_text:
      "MINISTRY OF INDUSTRY, COMMERCE AND EMPLOYMENT\nTRADE LICENCE\nLicence No: TL-THM-2023-01105\nBusiness Name: Druk IT Solutions\nProprietor: Thinley Namgay (CID 11201005544)\nActivity: IT services, software development\nAddress: Norzin Lam, Thimphu\nValid From: 15-Mar-2023\nValid To: 14-Mar-2026\nStatus: EXPIRED — Renewal application pending\nIssuing Officer: Director General, MoICE",
    metadata_text:
      "doc_no=MCI-TL-2026-0202 business=Druk IT Solutions owner=Thinley Namgay cid=11201005544 branch=Thimphu Main region=Western expired=true licence_no=TL-THM-2023-01105",
    doc_type: "MCI_TRADE_LICENCE",
    branch: "Thimphu Main",
    status: "pending_review",
    risk_band: "medium",
    legal_hold: false,
    expiry_status: "expired",
    uploaded_by: "maker.choki",
    indexed_at: TS(15),
  },
  // ---- Account Opening Forms -----------------------------------------------
  {
    doc_id: "BOB-AOF-2026-0301",
    ocr_text:
      "BANK OF BHUTAN — SAVINGS ACCOUNT OPENING FORM\nAccount Holder: Sonam Lhamo\nCID: 11808006789\nDate of Birth: 14-Apr-2001\nOccupation: Student, Royal University of Bhutan\nNominated Branch: Punakha\nInitial Deposit: BTN 1,000\nNominee: Pema Lhamo (Mother, CID 11808003211)\nDate: 2026-06-01",
    metadata_text:
      "doc_no=BOB-AOF-2026-0301 customer=Sonam Lhamo cid=11808006789 account_type=Savings branch=Punakha region=Western initial_deposit_btn=1000",
    doc_type: "BOB_ACCOUNT_OPENING",
    branch: "Punakha",
    status: "indexed",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "indexer.karma",
    indexed_at: TS(23),
  },
  {
    doc_id: "BOB-AOF-2026-0302",
    ocr_text:
      "BANK OF BHUTAN — CURRENT ACCOUNT OPENING FORM\nBusiness Name: Tashi Gasel Trading Pvt Ltd\nBusiness CID: MCI-2020-BU-4410\nSignatory: Tashi Wangdi (CID 11502003300)\nAuthorised Signatory 2: Chimi Dema (CID 11502004401)\nBranch: Phuentsholing\nInitial Deposit: BTN 50,000\nDate: 2026-05-18",
    metadata_text:
      "doc_no=BOB-AOF-2026-0302 business=Tashi Gasel Trading signatory=Tashi Wangdi account_type=Current branch=Phuentsholing region=Southern initial_deposit_btn=50000",
    doc_type: "BOB_ACCOUNT_OPENING",
    branch: "Phuentsholing",
    status: "approved",
    risk_band: "medium",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "maker.rinchen",
    indexed_at: TS(36),
  },
  // ---- Property / Land Documents -------------------------------------------
  {
    doc_id: "NLCS-LC-2026-0401",
    ocr_text:
      "NATIONAL LAND COMMISSION SECRETARIAT — LAND OWNERSHIP CERTIFICATE\nPlot No: THM-WCD-2019-000834\nOwner: Jigme Norbu Wangchuk\nCID: 11302004512\nArea: 0.45 Acres\nLocation: Chubachu, Thimphu\nGewog: Kawang\nDzongkhag: Thimphu\nLand Use: Residential\nRegistration Date: 12-Sep-2019\nMortgage: Charged to Bank of Bhutan, Thimphu Main Branch\nLoan Reference: BOB-HL-2019-08872",
    metadata_text:
      "doc_no=NLCS-LC-2026-0401 owner=Jigme Norbu Wangchuk cid=11302004512 plot=THM-WCD-2019-000834 branch=Thimphu Main mortgage=BOB-HL-2019-08872 collateral=true region=Western",
    doc_type: "NLCS_LAND_CERT",
    branch: "Thimphu Main",
    status: "indexed",
    risk_band: "medium",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "indexer.namgay",
    indexed_at: TS(8),
  },
  {
    doc_id: "NLCS-LC-2026-0402",
    ocr_text:
      "NATIONAL LAND COMMISSION SECRETARIAT — LAND OWNERSHIP CERTIFICATE\nPlot No: BM-TGS-2015-001122\nOwner: Dawa Penjor\nCID: 11613005678\nArea: 1.20 Acres\nLocation: Ura Valley, Bumthang\nGewog: Ura\nDzongkhag: Bumthang\nLand Use: Agricultural\nRegistration Date: 08-Mar-2015\nDispute: ACTIVE — Boundary dispute filed 2025-11-14 (Case No: NLCS-D-2025-0228)",
    metadata_text:
      "doc_no=NLCS-LC-2026-0402 owner=Dawa Penjor cid=11613005678 plot=BM-TGS-2015-001122 branch=Bumthang dispute=active region=Central case_no=NLCS-D-2025-0228",
    doc_type: "NLCS_LAND_CERT",
    branch: "Bumthang",
    status: "flagged",
    risk_band: "high",
    legal_hold: true,
    expiry_status: "none",
    uploaded_by: "maker.pema",
    indexed_at: TS(200),
  },
  // ---- Insurance Policies --------------------------------------------------
  {
    doc_id: "RICBL-INS-2026-0501",
    ocr_text:
      "ROYAL INSURANCE CORPORATION OF BHUTAN LIMITED\nPOLICY CERTIFICATE — LIFE INSURANCE\nPolicy No: RICBL-LI-2025-044391\nPolicyholder: Namgay Tshering\nCID: 11404007811\nSum Assured: BTN 2,000,000\nPremium: BTN 38,400 per annum\nCommencement: 01-Jul-2025\nMaturity: 30-Jun-2045\nBeneficiary: Tshering Choden (Spouse, CID 11404007900)\nBranch: Mongar",
    metadata_text:
      "doc_no=RICBL-INS-2026-0501 policyholder=Namgay Tshering cid=11404007811 policy_no=RICBL-LI-2025-044391 insurance_type=Life branch=Mongar region=Eastern sum_assured_btn=2000000",
    doc_type: "RICBL_INSURANCE_POLICY",
    branch: "Mongar",
    status: "indexed",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "indexer.jigme",
    indexed_at: TS(10),
  },
  {
    doc_id: "RICBL-INS-2026-0502",
    ocr_text:
      "ROYAL INSURANCE CORPORATION OF BHUTAN LIMITED\nPOLICY CERTIFICATE — MOTOR INSURANCE\nPolicy No: RICBL-MI-2025-009887\nPolicyholder: Kinley Penjor\nCID: 11506008012\nVehicle: Tata Harrier, Bhutan Plate BP-1-PHL 2889\nChassis: MA1HN2G1XNA016724\nCoverage: Comprehensive\nPremium: BTN 22,500\nValid: 15-Feb-2025 to 14-Feb-2026\nSTATUS: EXPIRED — renewal pending\nBranch: Phuentsholing",
    metadata_text:
      "doc_no=RICBL-INS-2026-0502 policyholder=Kinley Penjor cid=11506008012 policy_no=RICBL-MI-2025-009887 insurance_type=Motor branch=Phuentsholing vehicle=BP-1-PHL-2889 expired=true",
    doc_type: "RICBL_INSURANCE_POLICY",
    branch: "Phuentsholing",
    status: "flagged",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "expired",
    uploaded_by: "indexer.sangay",
    indexed_at: TS(130),
  },
  // ---- Fixed Deposit Certificates ------------------------------------------
  {
    doc_id: "BOB-FD-2026-0601",
    ocr_text:
      "BANK OF BHUTAN LIMITED — FIXED DEPOSIT RECEIPT\nFDR No: BOB-FDR-2026-001234\nDepositor: Chencho Pelden\nCID: 11309006677\nBranch: Trongsa\nPrincipal: BTN 500,000\nInterest Rate: 8.75% per annum\nTenure: 24 months\nMaturity Date: 15-Apr-2028\nNomination: Pem Seldon (Daughter, CID 11309009801)\nDate: 15-Apr-2026",
    metadata_text:
      "doc_no=BOB-FD-2026-0601 depositor=Chencho_Pelden cid=11309006677 fdr_no=BOB-FDR-2026-001234 branch=Trongsa principal_btn=500000 maturity=2028-04-15 region=Central",
    doc_type: "BOB_FIXED_DEPOSIT",
    branch: "Trongsa",
    status: "indexed",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "indexer.wangdi",
    indexed_at: TS(70),
  },
  {
    doc_id: "BOB-FD-2026-0602",
    ocr_text:
      "BANK OF BHUTAN LIMITED — FIXED DEPOSIT RECEIPT\nFDR No: BOB-FDR-2024-007654\nDepositor: Tandin Wangchuk\nCID: 11107003344\nBranch: Trashigang\nPrincipal: BTN 1,200,000\nInterest Rate: 8.25% per annum\nTenure: 12 months\nMaturity Date: 22-Jun-2026\nSTATUS: Maturing within 30 days — renewal instruction pending\nDate: 22-Jun-2025",
    metadata_text:
      "doc_no=BOB-FD-2026-0602 depositor=Tandin_Wangchuk cid=11107003344 fdr_no=BOB-FDR-2024-007654 branch=Trashigang principal_btn=1200000 maturity=2026-06-22 region=Eastern",
    doc_type: "BOB_FIXED_DEPOSIT",
    branch: "Trashigang",
    status: "pending_review",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "le30",
    uploaded_by: "maker.karma",
    indexed_at: TS(365),
  },
  // ---- AML / SAR Reports ---------------------------------------------------
  {
    doc_id: "FIU-SAR-2026-0701",
    ocr_text:
      "FINANCIAL INTELLIGENCE UNIT — SUSPICIOUS ACTIVITY REPORT\nSAR Reference: FIU-SAR-2026-0042\nReporting Institution: Bank of Bhutan\nBranch: Thimphu Main\nDate of Report: 2026-04-10\nSubject: Tenzin Gyeltshen (CID: 11201009900)\nNature of Suspicion: Multiple high-value cash deposits below BTN 100,000 threshold (structuring pattern observed over 30-day period; total BTN 2,350,000)\nRelated Accounts: BOB-CURR-2024-009981, BOB-SAVE-2024-021004\nStatus: Under Investigation",
    metadata_text:
      "doc_no=FIU-SAR-2026-0701 sar_ref=FIU-SAR-2026-0042 subject=Tenzin Gyeltshen cid=11201009900 branch=Thimphu Main aml=true structuring=true region=Western",
    doc_type: "FIU_SAR_REPORT",
    branch: "Thimphu Main",
    status: "pending_review",
    risk_band: "high",
    legal_hold: true,
    expiry_status: "none",
    uploaded_by: "compliance.officer",
    indexed_at: TS(75),
  },
  {
    doc_id: "FIU-SAR-2026-0702",
    ocr_text:
      "FINANCIAL INTELLIGENCE UNIT — SUSPICIOUS ACTIVITY REPORT\nSAR Reference: FIU-SAR-2026-0091\nReporting Institution: Bank of Bhutan\nBranch: Phuentsholing\nDate of Report: 2026-05-22\nSubject: Yeshi Trading Company (BRN: MCI-2018-BU-6630)\nNature of Suspicion: Cross-border wire transfers to unverified counterparty in undisclosed jurisdiction; total USD 42,000 over Q1 2026\nStatus: Forwarded to RMA AML Division",
    metadata_text:
      "doc_no=FIU-SAR-2026-0702 sar_ref=FIU-SAR-2026-0091 subject=Yeshi Trading brn=MCI-2018-BU-6630 branch=Phuentsholing aml=true cross_border=true region=Southern",
    doc_type: "FIU_SAR_REPORT",
    branch: "Phuentsholing",
    status: "indexed",
    risk_band: "high",
    legal_hold: true,
    expiry_status: "none",
    uploaded_by: "compliance.officer",
    indexed_at: TS(32),
  },
  // ---- Mortgage / Collateral -----------------------------------------------
  {
    doc_id: "BOB-MTGE-2026-0801",
    ocr_text:
      "BANK OF BHUTAN — MORTGAGE DEED\nMortgage Ref: BOB-MTGE-2026-00771\nMortgagor: Tshewang Rinzin\nCID: 11508007234\nMortgagee: Bank of Bhutan, Paro Branch\nProperty: Plot No PAR-DPS-2018-000456, Dopshari, Paro, 0.65 Acres\nLoan Amount: BTN 4,800,000\nLoan Reference: BOB-LA-2026-0045\nRegistered By: Notary Public, Paro Dratshang\nDate: 2026-03-28",
    metadata_text:
      "doc_no=BOB-MTGE-2026-0801 mortgagor=Tshewang Rinzin cid=11508007234 plot=PAR-DPS-2018-000456 branch=Paro loan_ref=BOB-LA-2026-0045 region=Western amount_btn=4800000",
    doc_type: "BOB_MORTGAGE_DEED",
    branch: "Paro",
    status: "indexed",
    risk_band: "medium",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "maker.ugyen",
    indexed_at: TS(87),
  },
  // ---- Board Resolutions / Internal ----------------------------------------
  {
    doc_id: "BOB-BR-2026-0901",
    ocr_text:
      "BANK OF BHUTAN LIMITED — BOARD RESOLUTION\nResolution No: BOB-BR-2026-014\nDate: 15-Jan-2026\nPassed by Board of Directors at the 142nd Board Meeting\nSubject: Approval of Revised Credit Policy for FY2026\nResolution: The Board hereby approves the revised Credit Policy effective 01-Feb-2026, incorporating risk-based lending criteria, maximum LTV ratios per property class, and enhanced due diligence for borrowers exceeding BTN 10 million exposure.\nSigned: Chairperson, MD & CEO, CFO, CRO",
    metadata_text:
      "doc_no=BOB-BR-2026-0901 resolution=BOB-BR-2026-014 subject=Credit Policy branch=Thimphu Main classification=Internal_Confidential region=Western",
    doc_type: "BOB_BOARD_RESOLUTION",
    branch: "Thimphu Main",
    status: "approved",
    risk_band: "medium",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "admin",
    indexed_at: TS(160),
  },
  // ---- Cheque / Instruments ------------------------------------------------
  {
    doc_id: "BOB-CHQ-2026-1001",
    ocr_text:
      "BANK OF BHUTAN — DISHONOURED CHEQUE NOTICE\nCheque No: 004521\nAccount: BOB-CURR-2025-003312\nAccount Holder: Karma Galey Enterprises\nCID / BRN: MCI-2019-BU-2241\nAmount: BTN 350,000\nDrawn On: 2026-05-05\nReason: Insufficient Funds\nNotice Date: 2026-05-07\nBranch: Gelephu\nAction Required: Immediate regularisation; default interest applies",
    metadata_text:
      "doc_no=BOB-CHQ-2026-1001 cheque_no=004521 account=BOB-CURR-2025-003312 holder=Karma Galey Enterprises brn=MCI-2019-BU-2241 branch=Gelephu dishonoured=true region=Southern",
    doc_type: "BOB_CHEQUE_DISHONOUR",
    branch: "Gelephu",
    status: "indexed",
    risk_band: "high",
    legal_hold: false,
    expiry_status: "le30",
    uploaded_by: "maker.tenzin",
    indexed_at: TS(50),
  },
  // ---- Salary / Payroll Certificates ----------------------------------------
  {
    doc_id: "MoF-SC-2026-1101",
    ocr_text:
      "MINISTRY OF FINANCE — ROYAL CIVIL SERVICE COMMISSION\nSALARY CERTIFICATE\nEmployee Name: Namgay Wangchuk\nCID: 11203006512\nEmployee ID: RCSC-2015-0043212\nDesignation: Program Officer\nDepartment: Department of Revenue and Customs, Thimphu\nGross Monthly Salary: BTN 78,500\nNet Monthly Salary: BTN 65,200 (after GIS, PF deductions)\nCertified for: Bank of Bhutan Home Loan Application\nIssued: 2026-06-01",
    metadata_text:
      "doc_no=MoF-SC-2026-1101 employee=Namgay Wangchuk cid=11203006512 dept=DRC designation=Program Officer branch=Thimphu Main salary_btn=78500 region=Western",
    doc_type: "MOF_SALARY_CERTIFICATE",
    branch: "Thimphu Main",
    status: "indexed",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "maker.tenzin",
    indexed_at: TS(22),
  },
  {
    doc_id: "MoF-SC-2026-1102",
    ocr_text:
      "BHUTAN DEVELOPMENT BANK LIMITED — SALARY CERTIFICATE\nEmployee Name: Pema Yangchen\nCID: 11906007234\nDesignation: Branch Accountant\nBranch: Wangdue Phodrang\nGross Monthly Salary: BTN 54,000\nIssuance Purpose: Vehicle Loan Application\nIssued: 2026-05-15",
    metadata_text:
      "doc_no=MoF-SC-2026-1102 employee=Pema Yangchen cid=11906007234 designation=Branch Accountant branch=Wangdue Phodrang salary_btn=54000 region=Western",
    doc_type: "MOF_SALARY_CERTIFICATE",
    branch: "Wangdue Phodrang",
    status: "indexed",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "indexer.tashi",
    indexed_at: TS(40),
  },
  // ---- Regulatory / RMA Circulars ------------------------------------------
  {
    doc_id: "RMA-CIRC-2026-1201",
    ocr_text:
      "ROYAL MONETARY AUTHORITY OF BHUTAN\nCIRCULAR No. 6/2026\nTo: All Licensed Financial Institutions\nDate: 2026-03-01\nSubject: Revised Guidelines on Know-Your-Customer (KYC) and Customer Due Diligence (CDD)\n1. Background: In light of the FATF Mutual Evaluation recommendations, RMA hereby issues revised KYC/CDD guidelines effective 01-April-2026.\n2. Enhanced Due Diligence (EDD) is mandatory for all Politically Exposed Persons (PEPs), high-risk geographies, and transactions above BTN 500,000.\n3. All institutions shall update customer risk profiles by 30-June-2026.\nRef: RMA/FSD/2026/0012",
    metadata_text:
      "doc_no=RMA-CIRC-2026-1201 circular=6/2026 subject=KYC_CDD issuer=RMA branch=Thimphu Main classification=Regulatory ref=RMA/FSD/2026/0012 region=Western",
    doc_type: "RMA_CIRCULAR",
    branch: "Thimphu Main",
    status: "indexed",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "admin",
    indexed_at: TS(115),
  },
  {
    doc_id: "RMA-CIRC-2026-1202",
    ocr_text:
      "ROYAL MONETARY AUTHORITY OF BHUTAN\nCIRCULAR No. 11/2026\nTo: All Banks and Financial Institutions\nDate: 2026-05-14\nSubject: Temporary Suspension of Cross-Border Transfers to Flagged Jurisdictions\n1. With immediate effect, all outbound wire transfers exceeding USD 5,000 to jurisdictions listed in Schedule A require prior written approval from the FIU.\n2. Institutions must report any such attempted transfers within 24 hours.\nRef: RMA/FIU/2026/0031",
    metadata_text:
      "doc_no=RMA-CIRC-2026-1202 circular=11/2026 subject=Cross_Border_Transfer issuer=RMA branch=Thimphu Main classification=Regulatory_Confidential ref=RMA/FIU/2026/0031 region=Western",
    doc_type: "RMA_CIRCULAR",
    branch: "Thimphu Main",
    status: "indexed",
    risk_band: "high",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "admin",
    indexed_at: TS(41),
  },
  // ---- Vehicle Loan -------------------------------------------------------
  {
    doc_id: "BOB-VL-2026-1301",
    ocr_text:
      "BANK OF BHUTAN — VEHICLE LOAN APPLICATION\nApplicant: Sangay Norbu\nCID: 11606007812\nBranch: Bumthang\nVehicle: Toyota Land Cruiser 200, Model Year 2024\nInvoice Value: BTN 7,500,000\nLoan Amount: BTN 6,000,000 (80% LTV)\nTenure: 60 months\nMonthly EMI: BTN 124,000\nInsurance: RICBL Comprehensive (Ref: RICBL-MI-2026-003344)\nDate: 2026-04-22",
    metadata_text:
      "doc_no=BOB-VL-2026-1301 applicant=Sangay_Norbu cid=11606007812 vehicle=Toyota_LC200 branch=Bumthang loan_btn=6000000 region=Central",
    doc_type: "BOB_LOAN_APPLICATION",
    branch: "Bumthang",
    status: "approved",
    risk_band: "medium",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "maker.jigme",
    indexed_at: TS(63),
  },
  // ---- GNHC / Social Impact Documents ------------------------------------
  {
    doc_id: "GNHC-EIA-2026-1401",
    ocr_text:
      "GROSS NATIONAL HAPPINESS COMMISSION\nENVIRONMENTAL IMPACT ASSESSMENT — CLEARANCE CERTIFICATE\nProject: Punakha Hydropower Channel Extension\nProponent: Druk Green Power Corporation\nClearance No: GNHC-EIA-2026-00114\nEnvironmental Category: Category B\nDate of Clearance: 2026-02-10\nConditions: Riparian buffer zone of 25m mandatory; quarterly monitoring report to NEC\nValidity: 36 months from clearance date\nIssued By: GNHC Secretariat, Thimphu",
    metadata_text:
      "doc_no=GNHC-EIA-2026-1401 project=Punakha_Hydro proponent=DGPC clearance_no=GNHC-EIA-2026-00114 branch=Punakha region=Western category=B",
    doc_type: "GNHC_EIA_CLEARANCE",
    branch: "Punakha",
    status: "indexed",
    risk_band: "medium",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "indexer.karma",
    indexed_at: TS(135),
  },
  // ---- Provident Fund -------------------------------------------------------
  {
    doc_id: "NPPF-PF-2026-1501",
    ocr_text:
      "NATIONAL PENSION AND PROVIDENT FUND — BHUTAN\nPROVIDENT FUND STATEMENT\nMember No: NPPF-2012-0073412\nMember Name: Thinley Gyeltshen\nCID: 11407007654\nEmployer: Bhutan Telecom\nBalance as of 31-Dec-2025: BTN 1,845,600\nEmployee Contribution YTD: BTN 42,000\nEmployer Contribution YTD: BTN 42,000\nBranch for Correspondence: Paro\nStatement Period: 01-Jan-2025 to 31-Dec-2025",
    metadata_text:
      "doc_no=NPPF-PF-2026-1501 member=Thinley Gyeltshen cid=11407007654 employer=Bhutan_Telecom member_no=NPPF-2012-0073412 branch=Paro balance_btn=1845600 region=Western",
    doc_type: "NPPF_PF_STATEMENT",
    branch: "Paro",
    status: "indexed",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "indexer.sonam",
    indexed_at: TS(175),
  },
  // ---- Legal / Court Order ------------------------------------------------
  {
    doc_id: "COURT-ORD-2026-1601",
    ocr_text:
      "HIGH COURT OF BHUTAN\nCOURT ORDER — ATTACHMENT OF ASSETS\nCase No: HC-CIV-2025-0441\nPlaintiff: Bank of Bhutan (represented by Legal Counsel)\nDefendant: Pema Namgyel (CID: 11207008823)\nOrder Date: 2026-01-15\nOrder: The Court hereby orders attachment of all moveable and immoveable assets of the Defendant pending settlement of outstanding debt of BTN 8,450,000 (principal BTN 7,200,000 + interest).\nAssets Attached: Plot PAR-CHG-2016-00231; Toyota Hilux BP-1-PHL 3344; Bank Accounts BOB-CURR-2021-005542\nNext Hearing: 2026-08-20",
    metadata_text:
      "doc_no=COURT-ORD-2026-1601 case=HC-CIV-2025-0441 defendant=Pema Namgyel cid=11207008823 branch=Paro legal_order=attachment debt_btn=8450000 region=Western",
    doc_type: "LEGAL_COURT_ORDER",
    branch: "Paro",
    status: "indexed",
    risk_band: "high",
    legal_hold: true,
    expiry_status: "none",
    uploaded_by: "compliance.officer",
    indexed_at: TS(160),
  },
  // ---- Interbank Settlement -----------------------------------------------
  {
    doc_id: "BOB-IBS-2026-1701",
    ocr_text:
      "BANK OF BHUTAN — INTERBANK SETTLEMENT INSTRUCTION\nInstruction Ref: BOB-IBS-2026-00832\nValue Date: 2026-06-10\nDebit Account: BOB NOSTRO USD (Citibank NY)\nAmount: USD 185,000\nCorrespondent Bank: Citibank N.A.\nBeneficiary Bank: Bhutan National Bank\nPurpose: Government securities settlement — RMA REPO tranche\nAuthorised By: Treasury Manager, CFO\nStatus: Settled",
    metadata_text:
      "doc_no=BOB-IBS-2026-1701 instruction_ref=BOB-IBS-2026-00832 amount_usd=185000 branch=Thimphu Main treasury=true rma_repo=true region=Western",
    doc_type: "BOB_INTERBANK_SETTLEMENT",
    branch: "Thimphu Main",
    status: "indexed",
    risk_band: "medium",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "treasury.ops",
    indexed_at: TS(14),
  },
  // ---- Audit Reports -------------------------------------------------------
  {
    doc_id: "RAA-AUDIT-2026-1801",
    ocr_text:
      "ROYAL AUDIT AUTHORITY — BANK OF BHUTAN BRANCH AUDIT REPORT\nAudit Ref: RAA-BOB-PHL-2025\nAudited Entity: Bank of Bhutan, Phuentsholing Branch\nAudit Period: April 2024 — March 2025\nAudit Type: Compliance and Financial Audit\nFindings Summary:\n1. MAJOR: Excess cash holding above prescribed limit on 6 occasions (total excess BTN 12.4M)\n2. MINOR: Loan file documentation incomplete for 14 cases\n3. MINOR: Safe custody register not updated for 3 months\nRecommendation: Corrective Action Plan to be submitted within 45 days\nAudit Completion Date: 2025-12-20",
    metadata_text:
      "doc_no=RAA-AUDIT-2026-1801 audit_ref=RAA-BOB-PHL-2025 entity=BOB_Phuentsholing branch=Phuentsholing audit_type=compliance region=Southern findings=major",
    doc_type: "RAA_AUDIT_REPORT",
    branch: "Phuentsholing",
    status: "indexed",
    risk_band: "high",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "auditor.choki",
    indexed_at: TS(185),
  },
  // ---- Savings Account Passbook (maturing soon) ----------------------------
  {
    doc_id: "BOB-PASS-2026-1901",
    ocr_text:
      "BANK OF BHUTAN — ACCOUNT PASSBOOK\nAccount No: BOB-SAVE-2023-088812\nAccount Holder: Lhamo Gyelmo\nCID: 11710009234\nBranch: Mongar\nAccount Type: Savings\nBalance as of 2026-06-24: BTN 234,500\nLast Transaction: 2026-06-21 — Salary Credit BTN 48,000\nLinked Mobile: +975-17-334-XXX",
    metadata_text:
      "doc_no=BOB-PASS-2026-1901 account=BOB-SAVE-2023-088812 holder=Lhamo Gyelmo cid=11710009234 branch=Mongar region=Eastern balance_btn=234500",
    doc_type: "BOB_ACCOUNT_PASSBOOK",
    branch: "Mongar",
    status: "indexed",
    risk_band: "low",
    legal_hold: false,
    expiry_status: "le30",
    uploaded_by: "indexer.jigme",
    indexed_at: TS(5),
  },
  // ---- Guarantee Letter ----------------------------------------------------
  {
    doc_id: "BOB-GL-2026-2001",
    ocr_text:
      "BANK OF BHUTAN — BANK GUARANTEE\nGuarantee No: BOB-BG-2026-00433\nIssuing Branch: Thimphu Main\nApplicant: Druk Construction Ltd (BRN: MCI-2016-BU-8801)\nBeneficiary: Department of Roads, MoIC\nAmount: BTN 15,000,000\nPurpose: Performance Guarantee for Road Construction Contract, Gelephu-Sarpang Highway\nValidity: 24 months from 2026-02-01\nCounter Guarantee: Fixed Deposit BOB-FDR-2026-00221 (BTN 15,000,000)\nIssuing Officer: AGM Operations",
    metadata_text:
      "doc_no=BOB-GL-2026-2001 guarantee_no=BOB-BG-2026-00433 applicant=Druk_Construction beneficiary=MoIC_DOR branch=Thimphu Main amount_btn=15000000 region=Western",
    doc_type: "BOB_BANK_GUARANTEE",
    branch: "Thimphu Main",
    status: "approved",
    risk_band: "medium",
    legal_hold: false,
    expiry_status: "none",
    uploaded_by: "checker.norbu",
    indexed_at: TS(145),
  },
];

// ---------------------------------------------------------------------------
// Saved searches — cover the main UI filter modes
// ---------------------------------------------------------------------------
interface SavedSearchRow {
  name: string;
  query_json: string;
  visibility: string;
  // user_id resolved at seed time from admin user
}

const SAVED_SEARCH_TEMPLATES: SavedSearchRow[] = [
  {
    name: "High-Risk AML Documents",
    query_json: JSON.stringify({
      text: "suspicious activity SAR FIU aml structuring",
      mode: "fulltext",
      filters: { risk_band: "high", legal_hold: true },
      sort: "recent",
    }),
    visibility: "public",
  },
  {
    name: "Expiring Documents — Next 30 Days",
    query_json: JSON.stringify({
      text: "",
      mode: "fulltext",
      filters: { expiry_status: "le30" },
      sort: "recent",
    }),
    visibility: "public",
  },
  {
    name: "Phuentsholing Branch All Documents",
    query_json: JSON.stringify({
      text: "Phuentsholing",
      mode: "fulltext",
      filters: { branch: "Phuentsholing" },
      sort: "recent",
    }),
    visibility: "private",
  },
];

// ---------------------------------------------------------------------------
// Seed entry point
// ---------------------------------------------------------------------------
export async function seed(knex: Knex): Promise<void> {
  // Only seed search_index when the table is empty, so re-seeding is safe.
  const existingCount = Number(
    ((await knex("search_index").count<{ c: string }[]>("id as c"))[0] as any).c
  );

  if (existingCount === 0) {
    const rows = SEARCH_DOCS.map((d) => ({ id: newId(), ...buildRow(d) }));
    // Insert in batches of 10 (SQLite has row-count limits per statement)
    for (let i = 0; i < rows.length; i += 10) {
      await knex("search_index").insert(rows.slice(i, i + 10));
    }
  }

  // Saved searches: resolve admin user id, then guard on (user_id, name) pair.
  const admin = await knex("users").where({ username: "admin" }).first();
  if (!admin) return; // admin seeded by 0001; skip if missing in isolated test envs

  for (const tmpl of SAVED_SEARCH_TEMPLATES) {
    const exists = await knex("saved_searches")
      .where({ user_id: admin.id, name: tmpl.name })
      .first();
    if (!exists) {
      await knex("saved_searches").insert({
        id: newId(),
        user_id: admin.id,
        name: tmpl.name,
        query_json: tmpl.query_json,
        visibility: tmpl.visibility,
      });
    }
  }
}
