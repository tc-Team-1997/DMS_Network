# ZorDMS — Local SSO Test Harness

Test all three enterprise SSO providers (OIDC, LDAP/AD, SAML) on your laptop
against **real** identity providers, then promote to UAT/prod by changing
**only ENV** — the gateway code never changes.

| Component | What | URL / endpoint |
|-----------|------|----------------|
| Keycloak  | OIDC + SAML IdP, realm `zordms` | http://localhost:8080 (admin / admin) |
| OpenLDAP  | LDAP/AD directory `dc=zordms,dc=local` | ldap://localhost:389 |
| Gateway   | ZorDMS auth gateway (run separately) | http://localhost:4000 |
| Web (SPA) | ZorDMS UI (run separately) | http://localhost:5174 |

Seeded users (all share password **`Password123!`**):

| Username | Group | Mapped ZorDMS role (via *_GROUP_ROLE_MAP) |
|----------|-------|--------------------------------------------|
| `sonam.maker`    | dms-makers   | Maker      |
| `kinley.checker` | dms-checkers | Checker    |
| `admin.cdo`      | dms-admins   | Supervisor |

---

## (a) Start the harness

```bash
docker compose -f deploy/sso-local/docker-compose.yml up -d
```

Keycloak imports `realm-zordms.json` on first boot; OpenLDAP imports
`ldap-seed.ldif`.

## (b) Wait until both are healthy

```bash
docker compose -f deploy/sso-local/docker-compose.yml ps   # STATUS = healthy
# OIDC discovery should return JSON:
curl -s http://localhost:8080/realms/zordms/.well-known/openid-configuration | head -c 200
# LDAP should answer a search:
docker exec zordms-openldap ldapsearch -x -H ldap://localhost:1389 \
  -b dc=zordms,dc=local -D cn=admin,dc=zordms,dc=local -w adminpassword '(uid=sonam.maker)'
```

## (c) Point the gateway at the harness

Copy the block(s) you want from `env.sso-local.example` into the gateway env
(e.g. `services/gateway/.env`, or your root `.env`), then restart:

```bash
./restart.sh
```

`GET http://localhost:4000/auth/config` should now list the enabled providers.

## (d) Test OIDC (Keycloak, browser flow)

1. Open <http://localhost:5174>. The login page calls `/auth/config` and renders
   a button per enabled provider — you should see **"Keycloak (OIDC)"**.
2. Click it → `/auth/oidc/login` redirects to Keycloak → sign in as
   `admin.cdo` / `Password123!`.
3. Keycloak redirects to `/auth/oidc/callback`; the gateway verifies the signed
   `oidc_tx` cookie (see Part A), exchanges the code, JIT-provisions the user,
   and hands the minted JWT back to the SPA (`/login#token=...`).
4. You land on the dashboard. Because `admin.cdo` is in `dms-admins`,
   `OIDC_GROUP_ROLE_MAP` maps it to **Supervisor**. Try `sonam.maker` → **Maker**.

## (e) Test LDAP and SAML

**LDAP** (no browser; direct POST bind):

```bash
curl -s -X POST http://localhost:4000/auth/ldap/login \
  -H 'Content-Type: application/json' \
  -d '{"username":"sonam.maker","password":"Password123!"}'
# -> { "token": "...", "user": { ... roles include "Maker" ... } }
```

**SAML** (Keycloak POST binding). The realm imports a SAML client, but you must
supply the IdP **signing certificate** to the gateway:

1. Fetch the realm's SAML descriptor and copy the `<ds:X509Certificate>` value:
   ```bash
   curl -s http://localhost:8080/realms/zordms/protocol/saml/descriptor
   ```
2. Paste that base64 (single line, no PEM header/footer) into `SAML_IDP_CERT` in
   your gateway env, then `./restart.sh`.
3. Open <http://localhost:5174>, click **"Keycloak (SAML)"** →
   `/auth/saml/login` → Keycloak login → Keycloak POSTs the assertion to
   `/auth/saml/callback` → dashboard, with the group→role mapping applied.

> **SAML manual click-steps (only if the imported client misbehaves):** in the
> Keycloak admin console → realm `zordms` → Clients → the SAML client → set
> *Valid redirect URIs* and *Master SAML Processing URL* /
> *Assertion Consumer Service POST Binding URL* to
> `http://localhost:4000/auth/saml/callback`, *Name ID format* = `email`, *Sign
> Assertions* = ON, *Client signature required* = OFF.

---

## (f) Promotion table — dev → UAT → prod (CODE NEVER CHANGES)

Only the **values** of these env keys change per environment. Same gateway
binary, same realm shape.

| Env key | local (this harness) | UAT | prod |
|---------|----------------------|-----|------|
| `OIDC_ISSUER` | `http://localhost:8080/realms/zordms` | `https://idp-uat.bobl.bt/realms/zordms` | `https://idp.bobl.bt/realms/zordms` |
| `OIDC_REDIRECT_URI` | `http://localhost:4000/auth/oidc/callback` | `https://dms-uat.bobl.bt/auth/oidc/callback` | `https://dms.bobl.bt/auth/oidc/callback` |
| `OIDC_CLIENT_ID` | `zordms-web` | per-env client | per-env client |
| `OIDC_CLIENT_SECRET` | fixed demo secret | **from secret store** | **from secret store** |
| `SAML_ENTRY_POINT` | `http://localhost:8080/.../saml` | `https://idp-uat.bobl.bt/.../saml` | `https://idp.bobl.bt/.../saml` |
| `SAML_CALLBACK_URL` | `http://localhost:4000/auth/saml/callback` | `https://dms-uat.bobl.bt/auth/saml/callback` | `https://dms.bobl.bt/auth/saml/callback` |
| `SAML_IDP_CERT` | local realm cert | UAT IdP cert | prod IdP cert (rotate!) |
| `LDAP_URL` | `ldap://localhost:389` | `ldaps://dc-uat...:636` | `ldaps://dc...:636` |
| `LDAP_BIND_CREDENTIALS` | `adminpassword` | **from secret store** | **from secret store** |
| `WEB_APP_URL` | `http://localhost:5174` | `https://dms-uat.bobl.bt` | `https://dms.bobl.bt` |
| `NODE_ENV` / `TRUST_PROXY` | (unset) | `production` / `true` | `production` / `true` |

**Per env you must also:** register that env's exact redirect/ACS URI in the IdP,
and pull secrets from the env's secret store (never commit them).

> **Promotion principle:** the gateway code is identical everywhere — only ENV
> values change (issuer/redirect/callback → HTTPS host, secrets from the vault,
> and each env's redirect URI pre-registered in the IdP).

## (g) Gotchas

- **Redirect-URI exact match.** OIDC `redirect_uri` and the SAML ACS URL must be
  registered **per environment** in the IdP and match byte-for-byte (scheme,
  host, port, path, trailing slash). Mismatch → IdP error before any callback.
- **HTTPS in UAT/prod.** Set `NODE_ENV=production` (or `TRUST_PROXY=true` behind
  a TLS-terminating proxy) so the `oidc_tx` cookie is flagged `Secure`. Browsers
  drop `Secure` cookies over plain HTTP — local dev stays HTTP, so it's unset.
- **Clock skew.** OIDC/SAML token & assertion validation checks `iat`/`nbf`/
  `exp`. Keep gateway and IdP clocks in sync (NTP) or you'll see intermittent
  "expired"/"not yet valid" failures.
- **SAML cert rotation.** `SAML_IDP_CERT` is pinned. When the IdP rotates its
  signing key, update this value and restart, or signature validation fails.
- **Multi-replica OIDC.** The login→callback transient (`state`/`nonce`/PKCE) is
  now a **signed `oidc_tx` HttpOnly cookie** (Part A), not in-process memory, so
  any gateway replica behind the load balancer can complete the callback. No
  sticky sessions or Redis required.
