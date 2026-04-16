# ABAC policy for NBE DMS. Layers on top of the RBAC matrix in app/services/auth.py.
# Returns a structured decision: {allow: bool, reason: string}.
package dms.authz

import rego.v1

default allow := {"allow": false, "reason": "default_deny"}

# ---------- Role / action base matrix ----------
permissions := {
    "view":        {"viewer", "maker", "checker", "doc_admin", "auditor"},
    "capture":     {"maker", "doc_admin"},
    "index":       {"maker", "doc_admin"},
    "approve":     {"checker", "doc_admin"},
    "sign":        {"checker", "doc_admin"},
    "admin":       {"doc_admin"},
    "audit_read":  {"auditor", "doc_admin"},
}

role_allows if {
    roles := permissions[input.action.name]
    some r in input.subject.roles
    roles[r]
}

# ---------- Tenant isolation ----------
tenant_ok if {
    not input.resource.tenant
}
tenant_ok if {
    input.resource.tenant == input.subject.tenant
}

# ---------- Branch scoping (non-admins/auditors only) ----------
branch_ok if {
    not input.resource.branch
}
branch_ok if {
    some r in input.subject.roles
    r == "doc_admin"
}
branch_ok if {
    some r in input.subject.roles
    r == "auditor"
}
branch_ok if {
    input.resource.branch == input.subject.branch
}

# ---------- Extra guard for critical-risk docs: require step-up context ----------
risk_ok if {
    not input.resource.risk_band
}
risk_ok if {
    input.resource.risk_band != "critical"
}
risk_ok if {
    input.resource.risk_band == "critical"
    input.context.stepup_valid == true
}

# ---------- After-hours guard for sensitive actions ----------
hour := time.clock([input.context.time_unix, "UTC"])[0]
after_hours_ok if {
    not {"admin", "approve", "sign"}[input.action.name]
}
after_hours_ok if {
    some r in input.subject.roles
    r == "doc_admin"
}
after_hours_ok if {
    hour >= 7
    hour < 22
}

# ---------- Final rule ----------
allow := {"allow": true, "reason": "role+scope+risk"} if {
    role_allows
    tenant_ok
    branch_ok
    risk_ok
    after_hours_ok
}

allow := {"allow": false, "reason": "role_denied"} if {
    not role_allows
}
allow := {"allow": false, "reason": "tenant_mismatch"} if {
    not tenant_ok
}
allow := {"allow": false, "reason": "branch_scope"} if {
    not branch_ok
    role_allows
    tenant_ok
}
allow := {"allow": false, "reason": "critical_risk_needs_stepup"} if {
    role_allows
    tenant_ok
    branch_ok
    not risk_ok
}
allow := {"allow": false, "reason": "after_hours_sensitive_action"} if {
    role_allows
    tenant_ok
    branch_ok
    risk_ok
    not after_hours_ok
}
