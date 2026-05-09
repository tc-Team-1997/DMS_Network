import { ConfigPanel } from '../ConfigPanel';

/**
 * DocBrain admin settings panel (Wave C).
 *
 * Renders the tenant_config namespace 'docbrain' via the generic ConfigPanel.
 * The Python service registers the JSON Schema for this namespace on startup;
 * until then ConfigPanel shows the "No schema registered yet" empty state.
 *
 * Schema keys (for reference — Python publishes the authoritative version):
 *   personas                        array  — [{id, label, system_prompt, starter_prompts, model}]
 *   citation_requirement            enum   — "mandatory" | "optional" | "off"
 *   evidence_threshold_for_amber_halt number — 0.0–1.0
 *   conversation_retention_days     integer
 *   max_tokens_per_response         integer — 256–32000
 *   default_persona_id              string
 *   pin_max_per_user                integer — 0–100
 */
export function DocbrainPanel() {
  return (
    <ConfigPanel
      namespace="docbrain"
      title="DocBrain AI Chat"
      description="Configure personas, citation requirements, evidence threshold, conversation retention, and token limits for the DocBrain Chat v2 experience."
    />
  );
}
