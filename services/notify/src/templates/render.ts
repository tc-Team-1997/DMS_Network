/**
 * Email template rendering — safe {{merge-tag}} substitution.
 *
 * Tokens look like {{ path.to.value }} and resolve against a flat/nested context
 * object. Special, computed tags build absolute app deep-links so a recipient
 * reading the email clicks back into the system:
 *
 *   {{doc.link}}     → <APP_BASE_URL>/viewer?doc=<doc.id>
 *   {{doc.id}}       → the raw document uuid
 *   {{doc.title}}    → the document title
 *   {{alert.link}}   → <APP_BASE_URL>/alerts
 *   {{workflow.link}}→ <APP_BASE_URL>/viewer?doc=<doc.id>&workflow=<workflow.id>
 *
 * All substituted values are HTML-escaped for the HTML body so template data can
 * never inject markup. The plain-text body uses the raw (un-escaped) value.
 */

export interface RenderContext {
  [key: string]: unknown;
}

/** Base URL the app is served from — used to build absolute deep-links. */
export function appBaseUrl(): string {
  return (process.env.APP_BASE_URL ?? "http://localhost:5174").replace(/\/+$/, "");
}

/** The curated tag catalog surfaced in the admin UI palette. */
export interface TagSpec { tag: string; label: string; example: string; }
export const TAG_CATALOG: TagSpec[] = [
  { tag: "{{recipient.name}}",  label: "Recipient name",      example: "Pema Lhamo" },
  { tag: "{{recipient.email}}", label: "Recipient email",     example: "pema@zorfinotech.com" },
  { tag: "{{alert.title}}",     label: "Alert title",         example: "KYC document expiring" },
  { tag: "{{alert.level}}",     label: "Alert level",         example: "warning" },
  { tag: "{{alert.link}}",      label: "Link to Alerts",      example: ".../alerts" },
  { tag: "{{doc.title}}",       label: "Document title",      example: "Passport — A. Hassan" },
  { tag: "{{doc.id}}",          label: "Document id",         example: "019f02e2-…" },
  { tag: "{{doc.link}}",        label: "Open-document link",  example: ".../viewer?doc=…" },
  { tag: "{{workflow.id}}",     label: "Workflow id",         example: "WF-12" },
  { tag: "{{workflow.link}}",   label: "Open-workflow link",  example: ".../viewer?doc=…&workflow=…" },
  { tag: "{{branch}}",          label: "Branch",              example: "Thimphu HQ" },
  { tag: "{{date}}",            label: "Today's date",        example: "2026-06-26" },
];

function htmlEscape(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

/** Resolve a dotted path ("doc.title") against the context. */
function lookup(ctx: RenderContext, path: string): unknown {
  return path.split(".").reduce<unknown>((acc, part) => {
    if (acc != null && typeof acc === "object" && part in (acc as Record<string, unknown>)) {
      return (acc as Record<string, unknown>)[part];
    }
    return undefined;
  }, ctx);
}

/** Compute the value for a tag, including the special link/date tags. */
function resolveTag(ctx: RenderContext, path: string): string {
  const base = appBaseUrl();
  const doc = (ctx.doc ?? {}) as Record<string, unknown>;
  const wf = (ctx.workflow ?? {}) as Record<string, unknown>;

  switch (path) {
    case "doc.link":
      return doc.id ? `${base}/viewer?doc=${encodeURIComponent(String(doc.id))}` : "";
    case "workflow.link":
      return doc.id && wf.id
        ? `${base}/viewer?doc=${encodeURIComponent(String(doc.id))}&workflow=${encodeURIComponent(String(wf.id))}`
        : doc.id
          ? `${base}/viewer?doc=${encodeURIComponent(String(doc.id))}`
          : "";
    case "alert.link":
      return `${base}/alerts`;
    case "date":
      return ctx.date != null ? String(ctx.date) : new Date().toISOString().slice(0, 10);
    default: {
      const v = lookup(ctx, path);
      return v == null ? "" : String(v);
    }
  }
}

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

/** Render a template string. `escape` toggles HTML-escaping of substituted values. */
export function renderTemplate(template: string, ctx: RenderContext, opts: { escape: boolean }): string {
  return template.replace(TOKEN_RE, (_m, path: string) => {
    const value = resolveTag(ctx, path);
    return opts.escape ? htmlEscape(value) : value;
  });
}

export interface RenderedEmail { subject: string; html: string; text: string; }

/**
 * Render a full email from a stored template row + context. The HTML body is
 * escaped; the text body is derived from `text_body_template` (raw) or, if
 * absent, by stripping tags from the rendered HTML.
 */
export function renderEmail(
  tpl: { subject_template: string; html_body_template: string; text_body_template?: string | null },
  ctx: RenderContext,
): RenderedEmail {
  const subject = renderTemplate(tpl.subject_template, ctx, { escape: false }).trim();
  const html = renderTemplate(tpl.html_body_template, ctx, { escape: true });
  const text = tpl.text_body_template
    ? renderTemplate(tpl.text_body_template, ctx, { escape: false })
    : stripHtml(renderTemplate(tpl.html_body_template, ctx, { escape: false }));
  return { subject, html, text };
}

/** Cheap HTML→text fallback for the plain-text alternative part. */
function stripHtml(html: string): string {
  return html
    .replace(/<\s*br\s*\/?>/gi, "\n")
    .replace(/<\/\s*(p|div|h[1-6]|li|tr)\s*>/gi, "\n")
    .replace(/<[^>]+>/g, "")
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

/** Sample context used by the admin preview when no real data is supplied. */
export function sampleContext(): RenderContext {
  return {
    recipient: { name: "Pema Lhamo", email: "pema@zorfinotech.com" },
    alert: { title: "KYC document expiring in 30 days", level: "warning" },
    doc: { id: "019f02e2-7041-79d6-8ddf-d67501e23019", title: "Passport — Ahmed Hassan" },
    workflow: { id: "WF-12" },
    branch: "Thimphu HQ",
    date: new Date().toISOString().slice(0, 10),
  };
}
