export interface AuthorityDecision {
  allowed: boolean;
  missing: string[];
}

export interface AuthorityClient {
  check(userId: string, permissions: string[]): Promise<AuthorityDecision>;
}

export interface AuthorityOptions {
  gatewayUrl: string;
  /** Must match the gateway's INTERNAL_SERVICE_TOKEN env var (timingSafeEqual check). */
  internalServiceToken?: string;
  fetchImpl?: typeof fetch;
}

export function createAuthorityClient(opts: AuthorityOptions): AuthorityClient {
  const doFetch = opts.fetchImpl ?? fetch;
  const url = `${opts.gatewayUrl.replace(/\/$/, "")}/authz/check`;
  return {
    async check(userId, permissions) {
      const res = await doFetch(url, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          ...(opts.internalServiceToken
            ? { "x-internal-token": opts.internalServiceToken }
            : {}),
        },
        body: JSON.stringify({ userId, permissions }),
      });
      if (!res.ok) {
        throw Object.assign(new Error("authz_check_failed"), { status: res.status });
      }
      const data = (await res.json()) as Partial<AuthorityDecision>;
      return { allowed: Boolean(data.allowed), missing: data.missing ?? [] };
    },
  };
}
