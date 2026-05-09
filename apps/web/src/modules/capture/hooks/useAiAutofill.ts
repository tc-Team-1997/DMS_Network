/**
 * useAiAutofill — manages AI-extracted field state with override and revert support.
 *
 * Tracks:
 *   form          — current field values (string map)
 *   aiFilled      — confidence (0–1) per field, only when AI-filled
 *   aiOriginalValues — original AI-extracted value, preserved for "Revert"
 *   manualEdits   — keys the user has manually changed
 *   lockedFields  — keys the user has locked (read-only)
 */

import { useCallback, useState } from 'react';
import type { PreviewResponse, Extraction } from '../api';
import type { FormState } from '../types';
import type { DocumentType } from '@/modules/document-types/api';
import { DEFAULT_AUTOFILL_FLOOR } from '../constants';

interface UseAiAutofillOptions {
  selectedType: DocumentType | null;
}

interface UseAiAutofillReturn {
  form: FormState;
  aiFilled: Record<string, number>;
  aiOriginalValues: Record<string, string>;
  manualEdits: Record<string, true>;
  lockedFields: Record<string, true>;
  setField: (key: string, value: string) => void;
  revertField: (key: string) => void;
  toggleLock: (key: string) => void;
  applyPreview: (preview: PreviewResponse) => void;
  resetAutofill: () => void;
}

export function useAiAutofill({ selectedType }: UseAiAutofillOptions): UseAiAutofillReturn {
  const [form, setFormState] = useState<FormState>({});
  const [aiFilled, setAiFilled] = useState<Record<string, number>>({});
  const [aiOriginalValues, setAiOriginalValues] = useState<Record<string, string>>({});
  const [manualEdits, setManualEdits] = useState<Record<string, true>>({});
  const [lockedFields, setLockedFields] = useState<Record<string, true>>({});

  /**
   * Update a field value from the user. Marks it as manually edited and
   * removes it from the AI-filled map (the badge disappears).
   */
  const setField = useCallback((key: string, value: string) => {
    if (lockedFields[key]) return; // silently ignore writes to locked fields
    setFormState((s) => ({ ...s, [key]: value }));
    setManualEdits((m) => ({ ...m, [key]: true }));
    // Keep aiFilled so "Revert" knows the original confidence; don't delete.
  }, [lockedFields]);

  /**
   * Revert a manually-edited field back to the original AI-extracted value.
   */
  const revertField = useCallback((key: string) => {
    setAiOriginalValues((orig) => {
      const original = orig[key];
      if (original == null) return orig;
      setFormState((s) => ({ ...s, [key]: original }));
      setManualEdits((m) => {
        const next = { ...m };
        delete next[key];
        return next;
      });
      return orig;
    });
  }, []);

  /**
   * Toggle the locked state for a field. Locked fields are read-only.
   */
  const toggleLock = useCallback((key: string) => {
    setLockedFields((l) => {
      if (l[key]) {
        const next = { ...l };
        delete next[key];
        return next;
      }
      return { ...l, [key]: true };
    });
  }, []);

  /**
   * Apply AI-extracted values from a preview response onto the form.
   * Respects: existing manual edits, locked fields, and the autofill floor.
   */
  const applyPreview = useCallback((preview: PreviewResponse) => {
    if (!selectedType) return;
    const autofillFloor = selectedType.autofill_floor ?? DEFAULT_AUTOFILL_FLOOR;
    const freetextFloor = Math.max(0, autofillFloor - 0.05);

    setFormState((currentForm) => {
      const nextForm: FormState = { ...currentForm };
      const nextConf: Record<string, number> = {};
      const nextOriginals: Record<string, string> = {};

      for (const fieldDef of selectedType.fields) {
        // Never overwrite locked or manually-edited fields.
        if (lockedFields[fieldDef.key] || manualEdits[fieldDef.key]) continue;
        // Skip fields that already have a value.
        if (currentForm[fieldDef.key]) continue;
        if (!fieldDef.ai_extract_from) continue;

        const ext = preview.extraction[fieldDef.ai_extract_from as keyof Extraction];
        if (!ext?.value) continue;

        const floor = fieldDef.ai_extract_from === 'address' ? freetextFloor : autofillFloor;
        if (ext.confidence < floor) continue;

        nextForm[fieldDef.key] = ext.value;
        nextConf[fieldDef.key] = ext.confidence;
        nextOriginals[fieldDef.key] = ext.value;
      }

      setAiFilled((prev) => ({ ...prev, ...nextConf }));
      setAiOriginalValues((prev) => ({ ...prev, ...nextOriginals }));
      return nextForm;
    });
  }, [selectedType, lockedFields, manualEdits]);

  const resetAutofill = useCallback(() => {
    setFormState({});
    setAiFilled({});
    setAiOriginalValues({});
    setManualEdits({});
    setLockedFields({});
  }, []);

  return {
    form,
    aiFilled,
    aiOriginalValues,
    manualEdits,
    lockedFields,
    setField,
    revertField,
    toggleLock,
    applyPreview,
    resetAutofill,
  };
}
