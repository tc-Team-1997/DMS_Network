import { describe, it, expect, vi, beforeEach } from "vitest";
import { handleUnauthorized, notifySessionExpired, SESSION_EXPIRED_EVENT } from "./client.js";

describe("session-expiry signalling", () => {
  beforeEach(() => {
    localStorage.setItem("zordms_token", "stale");
  });

  it("broadcasts the session-expired event and clears the token on a 401 (non-auth path)", () => {
    const spy = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, spy);
    handleUnauthorized(401, "/svc/core/documents");
    expect(spy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("zordms_token")).toBeNull();
    window.removeEventListener(SESSION_EXPIRED_EVENT, spy);
  });

  it("does NOT fire on a 401 from the login endpoint (bad credentials, not expiry)", () => {
    const spy = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, spy);
    handleUnauthorized(401, "/svc/gateway/auth/login");
    expect(spy).not.toHaveBeenCalled();
    expect(localStorage.getItem("zordms_token")).toBe("stale");
    window.removeEventListener(SESSION_EXPIRED_EVENT, spy);
  });

  it("does NOT fire on non-401 statuses (e.g. 403/404/500)", () => {
    const spy = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, spy);
    handleUnauthorized(403, "/svc/core/documents/x");
    handleUnauthorized(404, "/svc/core/documents/x");
    handleUnauthorized(500, "/svc/core/documents/x");
    expect(spy).not.toHaveBeenCalled();
    window.removeEventListener(SESSION_EXPIRED_EVENT, spy);
  });

  it("notifySessionExpired clears the token and dispatches the event directly", () => {
    const spy = vi.fn();
    window.addEventListener(SESSION_EXPIRED_EVENT, spy);
    notifySessionExpired();
    expect(spy).toHaveBeenCalledTimes(1);
    expect(localStorage.getItem("zordms_token")).toBeNull();
    window.removeEventListener(SESSION_EXPIRED_EVENT, spy);
  });
});
