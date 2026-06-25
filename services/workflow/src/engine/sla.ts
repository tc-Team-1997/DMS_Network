export interface SlaStep {
  id: string;
  workflow_id: string;
  status: string;
  due_at: string | null;
}

export function findOverdueSteps(steps: SlaStep[], now: Date): SlaStep[] {
  const t = now.getTime();
  return steps.filter(
    (s) => s.status === "Pending" && s.due_at !== null && new Date(s.due_at).getTime() < t,
  );
}
