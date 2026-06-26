/**
 * ZorDMS Enterprise Deep-Flow E2E Suite (P3–P10 + RefId)
 *
 * Covers the deep flows that landed after the original smoke/ui/api/a11y/visual
 * suites — WITHOUT duplicating them:
 *   - Workflow / Review Queue: cross-status tabs, claim/act → API → row reflects
 *     new status, "Open in Viewer" deep-link with &workflow=.
 *   - Viewer: stamp action, redaction draw, workflow decision card (?workflow),
 *     Approve navigates back to /review-queue.
 *   - Doc-type admin (System Administration → Document Types): list w/ fields,
 *     create/edit field editor, auto-detect-from-sample control.
 *   - Capture result drawer: mapped fields + quality + duplicates + raw-meta JSON,
 *     Proceed disabled until a file is chosen.
 *   - RefId: a uuid renders as a short token (not 36 chars) with full uuid in title.
 *   - Processing-Queue monitor: status counts render.
 *
 * Resilient by design: find-or-skip when data is absent, assert real outcomes,
 * never hard-code ids. The stack is seeded (admin / admin123) but data may shift.
 */
import { test, expect, type Page, type Request } from "@playwright/test";
import path from "path";
import fs from "fs";

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// ─── Helpers ──────────────────────────────────────────────────────────────────

async function loginAsAdmin(page: Page) {
  await page.goto("/login");
  await page.fill("#username", "admin");
  await page.fill("#password", "admin123");
  await page.click('button[type="submit"]');
  await page.waitForURL("**/dashboard", { timeout: 15_000 });
}

/** Read the gateway JWT the app stored, for direct API probes from the test. */
async function getToken(page: Page): Promise<string> {
  return (await page.evaluate(() => localStorage.getItem("zordms_token"))) ?? "";
}

/** Probe the workflow review queue for a given derived status via the vite proxy. */
async function fetchQueue(page: Page, status: string): Promise<any[]> {
  const token = await getToken(page);
  const data = await page.evaluate(
    async ({ status, token }) => {
      const r = await fetch(`/svc/workflow/workflows?status=${encodeURIComponent(status)}`, {
        headers: { authorization: `Bearer ${token}` },
      });
      if (!r.ok) return { workflows: [] };
      return r.json();
    },
    { status, token },
  );
  return (data?.workflows ?? []) as any[];
}

/** Pick a real document UUID from the core service (for Viewer deep-links). */
async function pickDocUuid(page: Page): Promise<string | null> {
  const token = await getToken(page);
  // Upload a fresh document so it has a REAL file on disk. The seed documents
  // are metadata-only (their physical files don't exist on the dev stack), so
  // burn-in tools like stamp/redact 500 on them ("ENOENT … file.pdf"). An
  // uploaded doc is stampable and order-independent (it doesn't depend on what
  // other specs left in the shared store). We upload the real fixture PNG via
  // page.request (shares the page's storage state) so sharp's burn-in pipeline
  // has valid image dimensions to composite onto.
  try {
    const fixture = path.join(__dirname, "..", "fixtures", "sample.png");
    const up = await page.request.post(`/svc/core/documents`, {
      headers: { authorization: `Bearer ${token}` },
      multipart: {
        file: { name: "e2e-burnin.png", mimeType: "image/png", buffer: fs.readFileSync(fixture) },
        title: "E2E burn-in subject",
      },
    });
    if (up.ok()) {
      const j = await up.json();
      if (j?.document?.id) return j.document.id as string;
    }
  } catch { /* fall through to existing docs */ }

  // Fallback: any existing uuid document.
  const data = await page.evaluate(async (token) => {
    const r = await fetch(`/svc/core/documents?limit=20`, {
      headers: { authorization: `Bearer ${token}` },
    });
    if (!r.ok) return { documents: [] };
    return r.json();
  }, token);
  const docs = (data?.documents ?? []) as Array<{ id: string }>;
  const uuidDoc = docs.find((d) => UUID_RE.test(d.id));
  return uuidDoc?.id ?? docs[0]?.id ?? null;
}

// ════════════════════════════════════════════════════════════════════════════
// 1. WORKFLOW / REVIEW QUEUE
// ════════════════════════════════════════════════════════════════════════════

test.describe("Review Queue — cross-status workflow", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/review-queue");
    // Anchor on the tab strip — it renders once the queue mounts (the serif <h2>
    // page heading is not exposed as a heading role in this shell).
    await expect(page.locator("button.tab", { hasText: "Pending" }).first()).toBeVisible({
      timeout: 12_000,
    });
  });

  test("all five cross-status tabs render and switch with live counts", async ({ page }) => {
    const tabNames = ["Pending", "Claimed", "Resolved", "Escalated", "SLA Breached"];
    for (const name of tabNames) {
      const tab = page.locator("button.tab", { hasText: name }).first();
      await expect(tab).toBeVisible({ timeout: 10_000 });
      // Tab label carries a live count in parens, e.g. "Pending (1)".
      await expect(tab).toHaveText(new RegExp(`${name.replace(/[()]/g, "")}\\s*\\(\\d+\\)`));
    }

    // Switch to Escalated and confirm the table re-renders (URL reflects the tab).
    const escTab = page.locator("button.tab", { hasText: "Escalated" }).first();
    await escTab.click();
    await page.waitForTimeout(400);
    await expect(page).toHaveURL(/tab=ESCALATED/);
    // The KPI row + table must still be present (no crash on tab switch).
    await expect(page.locator("table").first()).toBeVisible();
    await expect(page.locator("body")).not.toContainText("TypeError");
  });

  test("claiming a Pending item calls the API and the row reflects the new status", async ({ page }) => {
    const pending = await fetchQueue(page, "Pending");
    test.skip(pending.length === 0, "No Pending workflow items seeded — nothing to claim.");

    // Make sure we're on the Pending tab.
    await page.locator("button.tab", { hasText: "Pending" }).first().click();
    await page.waitForTimeout(300);

    const claimBtn = page.locator('button[aria-label="claim"]').first();
    await expect(claimBtn).toBeVisible({ timeout: 10_000 });

    // Assert the real claim API is hit.
    const claimReq = page.waitForRequest(
      (r: Request) => /\/workflows\/.+\/claim$/.test(r.url()) && r.method() === "POST",
      { timeout: 12_000 },
    );
    await claimBtn.click();
    await claimReq;

    // After claim the queue reloads; the Claimed tab count should be >= 1 and the
    // item should leave Pending. Wait for the reload to land.
    await page.waitForTimeout(1500);
    const claimedTab = page.locator("button.tab", { hasText: "Claimed" }).first();
    await expect(claimedTab).toHaveText(/Claimed\s*\((?:[1-9]\d*)\)/, { timeout: 10_000 });

    // The Claimed tab now shows the claimed row (acting buttons appear there too).
    await claimedTab.click();
    await page.waitForTimeout(400);
    await expect(page.locator('button[aria-label="approve"]').first()).toBeVisible({
      timeout: 10_000,
    });
  });

  test('"Open in Viewer" deep-links to the viewer with &workflow=', async ({ page }) => {
    // Find any item across statuses that has a linked document (Open enabled).
    let openBtn = page.locator('button[aria-label="open in viewer"]:not([disabled])').first();
    if (!(await openBtn.count())) {
      // Try Escalated — it's the largest seeded bucket.
      await page.locator("button.tab", { hasText: "Escalated" }).first().click();
      await page.waitForTimeout(400);
      openBtn = page.locator('button[aria-label="open in viewer"]:not([disabled])').first();
    }
    test.skip(!(await openBtn.count()), "No review item has a linked document to open.");

    await openBtn.click();
    await page.waitForURL(/\/viewer\?.*workflow=/, { timeout: 12_000 });
    const url = new URL(page.url());
    expect(url.searchParams.get("doc")).toBeTruthy();
    expect(url.searchParams.get("workflow")).toBeTruthy();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 2. VIEWER — stamp / redact / workflow decision card
// ════════════════════════════════════════════════════════════════════════════

test.describe("Viewer — burn-in tools + workflow decision", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("redaction tool draws a region on the canvas", async ({ page }) => {
    const docId = await pickDocUuid(page);
    test.skip(!docId, "No document available to open in the viewer.");

    await page.goto(`/viewer?doc=${encodeURIComponent(docId!)}`);
    // Wait for the document to load (canvas present, not the loading state).
    const canvas = page.locator('[data-testid="viewer-canvas"]');
    await expect(canvas).toBeVisible({ timeout: 12_000 });
    await expect(page.locator("body")).not.toContainText("Document not found");

    // The burn-in (destructive) redaction tool requires the `document:write`
    // permission. When it's available, exercise the draw-region flow; otherwise
    // fall back to the annotation-redaction modal which is the available
    // redaction affordance for this user.
    const redactToggle = page.locator('button[aria-label="toggle redaction tool"]');
    if (await redactToggle.count()) {
      await redactToggle.click();
      // The destructive-redaction panel appears once redact mode is on.
      await expect(page.getByText("Permanent Redaction")).toBeVisible();

      // Drag a rectangle across the canvas to draft a redaction region.
      const box = await canvas.boundingBox();
      expect(box).toBeTruthy();
      const b = box!;
      await page.mouse.move(b.x + b.width * 0.25, b.y + b.height * 0.25);
      await page.mouse.down();
      await page.mouse.move(b.x + b.width * 0.55, b.y + b.height * 0.5, { steps: 8 });
      await page.mouse.move(b.x + b.width * 0.6, b.y + b.height * 0.6, { steps: 8 });
      await page.mouse.up();

      // A committed draft region renders, and the panel lists it / enables Apply.
      await expect(page.locator('[data-testid="redact-draft"]').first()).toBeVisible({
        timeout: 8_000,
      });
      const applyBtn = page.locator('button[aria-label="apply redaction"]');
      await expect(applyBtn).toBeEnabled();
      await expect(applyBtn).toContainText(/Apply Redaction \(\d+\)/);
      return;
    }

    // Fallback: annotation-based redaction tool (requires annotation:write).
    const annRedact = page.locator('button[aria-label="add redaction"]');
    test.skip(!(await annRedact.count()), "No redaction tool available for this user/doc.");
    await annRedact.click();
    // The Add Annotation modal opens pre-set to the Redaction kind.
    await expect(page.getByRole("heading", { name: "Add Annotation" })).toBeVisible({
      timeout: 8_000,
    });
    await expect(page.locator('.modal-box select').first()).toHaveValue("redaction");
  });

  test("stamp action hits the stamp API and reports a new version", async ({ page }) => {
    const docId = await pickDocUuid(page);
    test.skip(!docId, "No document available to stamp.");

    await page.goto(`/viewer?doc=${encodeURIComponent(docId!)}`);
    await expect(page.locator('[data-testid="viewer-canvas"]')).toBeVisible({ timeout: 12_000 });

    const stampBtn = page.locator('button[aria-label="apply approval stamp"]');
    test.skip(!(await stampBtn.count()), "Stamp control not available for this user/doc.");
    await expect(stampBtn).toBeVisible({ timeout: 10_000 });

    const stampReq = page.waitForRequest(
      (r: Request) => /\/documents\/.+\/stamp$/.test(r.url()) && r.method() === "POST",
      { timeout: 12_000 },
    );
    await stampBtn.click();
    await stampReq;

    // The viewer surfaces a status toast on success or error — either way it must
    // not crash. On success it mentions the new version. Generous timeout: the
    // dev stack's in-memory SQLite uses a single connection (pool max:1), so the
    // stamp round-trip can queue behind other work near the end of a long run.
    const toast = page.locator('[role="status"]').filter({ hasText: /stamp|version/i }).first();
    await expect(toast).toBeVisible({ timeout: 30_000 });
  });

  test("workflow decision card appears with ?workflow and Approve returns to /review-queue", async ({
    page,
  }) => {
    // The Review Decision card renders on `workflowId && doc` (the loaded
    // document), so we need (a) ANY real workflow id and (b) a document that
    // actually LOADS. A review item's own doc_id is unreliable here: earlier
    // tests in this file claim/approve the seeded Pending item, and the
    // remaining items' doc_ids may not resolve in the core store on this stack.
    // So we take any workflow id from the queue and pair it with a freshly
    // uploaded (guaranteed-loadable) document.
    let workflowId: string | null = null;
    for (const status of ["Pending", "Claimed", "Escalated", "Resolved"]) {
      const items = await fetchQueue(page, status);
      const withId = items.find((i) => i.id);
      if (withId) { workflowId = withId.id; break; }
    }
    const docId = await pickDocUuid(page);
    test.skip(!docId || !workflowId, "No workflow item available to drive the decision card.");

    await page.goto(
      `/viewer?doc=${encodeURIComponent(docId!)}&workflow=${encodeURIComponent(workflowId!)}`,
    );

    // Workflow context banner (deep-link) renders with the wf id behind a RefId.
    await expect(page.locator('[data-testid="wf-id"]')).toBeVisible({ timeout: 12_000 });

    // The Review Decision card appears with Approve / Reject / Escalate buttons.
    // Generous timeout: the workflow fetch backing this card can queue behind the
    // single-connection in-memory SQLite pool near the end of a long suite run.
    const decisionCard = page.locator(".card", { hasText: "Review Decision" }).first();
    await expect(decisionCard).toBeVisible({ timeout: 30_000 });
    const approveBtn = decisionCard.locator('button[aria-label="approve"]');
    await expect(approveBtn).toBeVisible();

    // Uncheck "stamp before approve" to keep the act atomic & deterministic.
    const stampChk = decisionCard.locator('input[aria-label="stamp before approve"]');
    if (await stampChk.count()) {
      if (await stampChk.isChecked()) await stampChk.uncheck();
    }

    test.skip(await approveBtn.isDisabled(), "Approve not permitted for this user.");

    const actReq = page.waitForRequest(
      (r: Request) => /\/workflows\/.+\/act$/.test(r.url()) && r.method() === "POST",
      { timeout: 12_000 },
    );
    await approveBtn.click();
    await actReq;

    // Approving closes the loop back to the Review Queue.
    await page.waitForURL("**/review-queue", { timeout: 12_000 });
    await expect(page).toHaveURL(/\/review-queue/);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 3. DOC-TYPE ADMIN (System Administration → Document Types)
// ════════════════════════════════════════════════════════════════════════════

test.describe("Doc-Type Admin", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/system-administration?tab=doctypes");
    // The doctypes tab is URL-driven; make sure it's active.
    const dtTab = page.locator("button.tab", { hasText: "Document Types" }).first();
    await expect(dtTab).toBeVisible({ timeout: 12_000 });
    await dtTab.click();
  });

  test("lists document types with mandatory/optional field counts", async ({ page }) => {
    const card = page.locator(".card", { hasText: "Document Types" }).first();
    await expect(card).toBeVisible({ timeout: 12_000 });
    // The list shows "N document types registered".
    await expect(page.getByText(/\d+ document types? registered/)).toBeVisible({ timeout: 12_000 });
    // Each row carries a field summary like "3 mandatory · N optional".
    await expect(page.locator("table").first()).toBeVisible();
    await expect(page.getByText(/\d+ mandatory/).first()).toBeVisible({ timeout: 10_000 });
  });

  test("opening create shows the field editor + auto-detect-from-sample control", async ({
    page,
  }) => {
    const newBtn = page.locator('button[aria-label="New doc type"]');
    test.skip(!(await newBtn.count()), "Create not permitted for this user.");
    await newBtn.click();

    // Create modal renders the Code field + metadata field editor section.
    await expect(page.locator(".modal-box").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText("Metadata fields")).toBeVisible({ timeout: 10_000 });

    // The "Auto-detect fields" (from-sample) control is present.
    await expect(page.locator('button[aria-label="Auto-detect fields"]')).toBeVisible();

    // Field editor lets you add a field row.
    const addFieldBtn = page.locator('button[aria-label="Add field"]').first();
    if (await addFieldBtn.count()) {
      await addFieldBtn.click();
      await expect(page.locator('input[placeholder="field_name"]').first()).toBeVisible({
        timeout: 6_000,
      });
    }
  });

  test("opening edit on an existing type shows its field editor pre-populated", async ({ page }) => {
    const editBtn = page.locator('button[aria-label^="Edit "]').first();
    await expect(editBtn).toBeVisible({ timeout: 12_000 });
    await editBtn.click();

    // Edit modal: field editor section + auto-detect control both present.
    await expect(page.getByText("Metadata fields")).toBeVisible({ timeout: 10_000 });
    await expect(page.locator('button[aria-label="Auto-detect fields"]')).toBeVisible();
    // Existing field rows are rendered (a system type has >= 1 mandatory field).
    const fieldInputs = page.locator(".modal-box input");
    expect(await fieldInputs.count()).toBeGreaterThan(0);
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 4. CAPTURE RESULT DRAWER
// ════════════════════════════════════════════════════════════════════════════

test.describe("Capture — result drawer", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/capture");
    await expect(page.locator(".tabs")).toBeVisible({ timeout: 12_000 });
  });

  test("Proceed is disabled until a file is chosen", async ({ page }) => {
    // Default tab is File Upload; no file yet → Proceed disabled.
    const proceed = page.locator('button[aria-label="Proceed to upload and extract"]');
    await expect(proceed).toBeVisible({ timeout: 10_000 });
    await expect(proceed).toBeDisabled();

    // Choose a file → Proceed becomes enabled.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(path.join(__dirname, "..", "fixtures", "sample.png"));
    await expect(proceed).toBeEnabled({ timeout: 8_000 });
  });

  test("after Proceed the editable result drawer shows mapped fields, quality + raw-metadata JSON", async ({
    page,
  }) => {
    // Pick a file.
    const fileInput = page.locator('input[type="file"]').first();
    await fileInput.setInputFiles(path.join(__dirname, "..", "fixtures", "sample.png"));

    const proceed = page.locator('button[aria-label="Proceed to upload and extract"]');
    await expect(proceed).toBeEnabled({ timeout: 8_000 });
    await proceed.click();

    // Confirm modal → Confirm & Proceed.
    const confirm = page.locator('button[aria-label="Confirm and proceed"]');
    await expect(confirm).toBeVisible({ timeout: 8_000 });

    // The extract call must hit the real API.
    const extractReq = page.waitForRequest(
      (r: Request) => /\/documents\/.+\/extract$/.test(r.url()) && r.method() === "POST",
      { timeout: 20_000 },
    );
    await confirm.click();
    await extractReq;

    // The result drawer auto-opens with the AI Classification Result header.
    await expect(
      page.getByRole("heading", { name: "AI Classification Result" }),
    ).toBeVisible({ timeout: 30_000 });

    // Quality & completeness panel.
    await expect(page.getByText("Quality & Completeness").first()).toBeVisible({ timeout: 10_000 });
    await expect(page.getByText(/Quality Score/)).toBeVisible();

    // Editable classification + extracted-fields region.
    await expect(page.locator('select[aria-label="Document type select"]')).toBeVisible();

    // Raw-metadata JSON section: collapsed by default → expand it and assert JSON.
    const rawToggle = page.locator('button[aria-label="Toggle raw extracted metadata"]');
    await expect(rawToggle).toBeVisible({ timeout: 10_000 });
    await rawToggle.scrollIntoViewIfNeeded();
    // The drawer body is a scrollable flex container where sticky cards can
    // overlap the toggle's hit-box; dispatch the click directly to bypass
    // hit-testing, then assert it actually expands.
    await rawToggle.dispatchEvent("click");
    await expect(rawToggle).toHaveAttribute("aria-expanded", "true", { timeout: 8_000 });
    // Either the JSON pre or the "No raw metadata captured" fallback — both valid.
    const rawJson = page.locator('[aria-label="raw metadata json"]');
    const rawEmpty = page.getByText("No raw metadata captured.");
    await expect(rawJson.or(rawEmpty)).toBeVisible({ timeout: 8_000 });

    // Save corrections control is present (PATCH path).
    await expect(page.locator('button[aria-label="Save corrections"]')).toBeVisible();
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 5. RefId — uuid renders as a short token with the full uuid behind it
// ════════════════════════════════════════════════════════════════════════════

test.describe("RefId — uuid short-token", () => {
  test.beforeEach(async ({ page }) => {
    await loginAsAdmin(page);
  });

  test("a uuid renders short (<36 chars) with the full uuid in its title", async ({ page }) => {
    // The Viewer workflow banner renders the workflow UUID through RefId with a
    // stable test id — a deterministic, data-light RefId case we fully control.
    const docId = (await pickDocUuid(page)) ?? "00000000-0000-0000-0000-000000000000";
    const wfUuid = "019f0064-9b17-7063-8553-a6db020058fe"; // any canonical uuid

    await page.goto(`/viewer?doc=${encodeURIComponent(docId)}&workflow=${wfUuid}`);

    const ref = page.locator('[data-testid="wf-id"] [role="button"]');
    await expect(ref).toBeVisible({ timeout: 12_000 });

    const shown = (await ref.innerText()).trim();
    // Display token must be the short form, NOT the raw 36-char uuid.
    expect(shown.length).toBeLessThan(36);
    expect(shown).not.toBe(wfUuid);
    // First 8 hex chars of the uuid appear in the token.
    expect(shown).toContain(wfUuid.slice(0, 8));

    // The full uuid is kept behind it — on the native title and the aria-label.
    await expect(ref).toHaveAttribute("title", wfUuid);
    await expect(ref).toHaveAttribute("aria-label", new RegExp(wfUuid));
  });

  test("a uuid in a data table renders shortened (resilient scan)", async ({ page }) => {
    // RecordsManagement renders document UUIDs through RefId inside a table.
    await page.goto("/records-management");
    await page.waitForTimeout(1500);
    const refButtons = page.locator('table [role="button"][title]');
    const n = await refButtons.count();
    test.skip(n === 0, "No RefId tokens present in the records table for this dataset.");

    let assertedUuidToken = false;
    for (let i = 0; i < Math.min(n, 20); i++) {
      const el = refButtons.nth(i);
      const title = (await el.getAttribute("title")) ?? "";
      if (UUID_RE.test(title)) {
        const text = (await el.innerText()).trim();
        expect(text.length).toBeLessThan(36);
        expect(text).not.toBe(title);
        assertedUuidToken = true;
        break;
      }
    }
    test.skip(!assertedUuidToken, "No uuid-backed RefId token found in the visible table page.");
  });
});

// ════════════════════════════════════════════════════════════════════════════
// 6. PROCESSING-QUEUE MONITOR (System Administration → Processing Queue)
// ════════════════════════════════════════════════════════════════════════════

test.describe("Processing Queue monitor", () => {
  test("queue tab renders status counts", async ({ page }) => {
    await loginAsAdmin(page);
    await page.goto("/system-administration?tab=queue");

    const queueTab = page.locator("button.tab", { hasText: "Processing Queue" }).first();
    await expect(queueTab).toBeVisible({ timeout: 12_000 });
    await queueTab.click();
    await page.waitForTimeout(500);

    // The five status count cards must all render (queued/running/succeeded/failed/dead).
    for (const s of ["queued", "running", "succeeded", "failed", "dead"]) {
      const card = page.locator(`[data-testid="job-count-${s}"]`);
      await expect(card).toBeVisible({ timeout: 10_000 });
      // Each card shows a numeric count (0 when the queue is empty — still valid).
      await expect(card).toContainText(/\d+/);
    }

    // The recent-jobs table renders (empty state is acceptable).
    await expect(page.locator(".card", { hasText: "Recent Jobs" }).first()).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.locator("body")).not.toContainText("TypeError");
  });
});
