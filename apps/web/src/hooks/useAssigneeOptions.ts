/**
 * useAssigneeOptions — loads roles + users and produces grouped options for the
 * SearchableSelect used in workflow escalation / assignment. The option value
 * encodes the kind so callers know whether a role or a person was chosen:
 *   role:<RoleName>   ·   user:<username>
 */
import { useEffect, useState } from "react";
import { securityApi } from "../api/securityScreen.js";
import type { SelectOption } from "../components/ui/SearchableSelect.js";

export interface AssigneeOptionsState {
  options: SelectOption[];
  loading: boolean;
}

/** Parse a SearchableSelect value back into { kind, value }. */
export function parseAssignee(value: string | null): { kind: "role" | "user"; value: string } | null {
  if (!value) return null;
  const [kind, ...rest] = value.split(":");
  const v = rest.join(":");
  if ((kind === "role" || kind === "user") && v) return { kind, value: v };
  return null;
}

/** Load roles + people for assignment pickers. Pass `enabled=false` to defer
 *  fetching until the picker is actually shown (e.g. a closed modal). */
export function useAssigneeOptions(enabled: boolean = true): AssigneeOptionsState {
  const [options, setOptions] = useState<SelectOption[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!enabled) return;
    let live = true;
    (async () => {
      try {
        const [rolesRes, usersRes] = await Promise.all([
          securityApi.listRoles().catch(() => ({ roles: [] })),
          securityApi.getUsers().catch(() => ({ users: [] })),
        ]);
        if (!live) return;
        const roleOpts: SelectOption[] = (rolesRes?.roles ?? []).map((r) => ({
          value: `role:${r.name}`,
          label: r.name,
          subLabel: r.description ?? "Role — all active members",
          group: "Roles",
        }));
        const userOpts: SelectOption[] = (usersRes?.users ?? [])
          .filter((u) => u.status === "Active")
          .map((u) => ({
            value: `user:${u.username}`,
            label: u.full_name?.trim() || u.username,
            subLabel: [u.username, u.email].filter(Boolean).join(" · "),
            group: "People",
          }));
        setOptions([...roleOpts, ...userOpts]);
      } finally {
        if (live) setLoading(false);
      }
    })();
    return () => { live = false; };
  }, [enabled]);

  return { options, loading };
}
