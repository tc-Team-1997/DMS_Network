import { describe, it, expect, beforeEach } from "vitest";
import { renderTemplate, renderEmail, appBaseUrl, sampleContext, TAG_CATALOG } from "./render.js";

describe("email template rendering", () => {
  beforeEach(() => {
    process.env.APP_BASE_URL = "https://dms.example.com";
  });

  it("substitutes simple dotted tags", () => {
    const out = renderTemplate("Hi {{recipient.name}} ({{branch}})", { recipient: { name: "Pema" }, branch: "Thimphu" }, { escape: false });
    expect(out).toBe("Hi Pema (Thimphu)");
  });

  it("builds an absolute document deep-link for {{doc.link}}", () => {
    const out = renderTemplate("{{doc.link}}", { doc: { id: "abc-123" } }, { escape: false });
    expect(out).toBe("https://dms.example.com/viewer?doc=abc-123");
  });

  it("builds a workflow deep-link when both ids present", () => {
    const out = renderTemplate("{{workflow.link}}", { doc: { id: "d1" }, workflow: { id: "wf9" } }, { escape: false });
    expect(out).toBe("https://dms.example.com/viewer?doc=d1&workflow=wf9");
  });

  it("HTML-escapes substituted values in the HTML body", () => {
    const out = renderTemplate("{{x}}", { x: "<script>alert(1)</script>" }, { escape: true });
    expect(out).toBe("&lt;script&gt;alert(1)&lt;/script&gt;");
  });

  it("leaves unknown tags as empty string", () => {
    const out = renderTemplate("[{{nope.missing}}]", {}, { escape: false });
    expect(out).toBe("[]");
  });

  it("renders a full email (subject unescaped, html escaped, text fallback)", () => {
    const tpl = {
      subject_template: "Review {{doc.title}}",
      html_body_template: `<p>Open <a href="{{doc.link}}">{{doc.title}}</a></p>`,
      text_body_template: "Open {{doc.link}}",
    };
    const r = renderEmail(tpl, { doc: { id: "d1", title: "A & B" } });
    expect(r.subject).toBe("Review A & B");
    expect(r.html).toContain('href="https://dms.example.com/viewer?doc=d1"');
    expect(r.html).toContain("A &amp; B"); // escaped in html
    expect(r.text).toBe("Open https://dms.example.com/viewer?doc=d1");
  });

  it("derives a text fallback from HTML when no text template is given", () => {
    const tpl = {
      subject_template: "s",
      html_body_template: "<p>Hello {{recipient.name}}</p><br><p>Bye</p>",
    };
    const r = renderEmail(tpl, { recipient: { name: "Pema" } });
    expect(r.text).toContain("Hello Pema");
    expect(r.text).not.toContain("<p>");
  });

  it("appBaseUrl strips trailing slashes and defaults", () => {
    process.env.APP_BASE_URL = "https://x.test/";
    expect(appBaseUrl()).toBe("https://x.test");
    delete process.env.APP_BASE_URL;
    expect(appBaseUrl()).toBe("http://localhost:5174");
  });

  it("exposes a non-empty tag catalog and a usable sample context", () => {
    expect(TAG_CATALOG.length).toBeGreaterThan(5);
    const ctx = sampleContext();
    expect((ctx.doc as { id: string }).id).toBeTruthy();
  });
});
