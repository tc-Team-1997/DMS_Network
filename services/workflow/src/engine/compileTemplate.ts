export interface StepDef {
  name: string;
  required_permissions: string[];
  min_confidence: number;
  sla_minutes?: number;
}

const DEFAULT_CONFIDENCE = 0.9;

export function compileTemplate(stepsJson: string): StepDef[] {
  let raw: unknown;
  try {
    raw = JSON.parse(stepsJson);
  } catch {
    throw new Error("invalid_steps_json");
  }
  if (!Array.isArray(raw)) throw new Error("invalid_steps_json");
  if (raw.length === 0) throw new Error("empty_template");

  return raw.map((s, idx) => {
    const step = s as Partial<StepDef>;
    if (!step.name || typeof step.name !== "string") {
      throw new Error(`step_name_required:${idx}`);
    }
    const perms =
      Array.isArray(step.required_permissions) && step.required_permissions.length
        ? step.required_permissions
        : ["workflow:act"];
    const conf =
      typeof step.min_confidence === "number" ? step.min_confidence : DEFAULT_CONFIDENCE;
    return {
      name: step.name,
      required_permissions: perms,
      min_confidence: conf,
      sla_minutes: typeof step.sla_minutes === "number" ? step.sla_minutes : undefined,
    };
  });
}

export function passesConfidenceGate(
  stepConfidenceFloor: number,
  docConfidence: number,
): boolean {
  return docConfidence >= stepConfidenceFloor;
}
