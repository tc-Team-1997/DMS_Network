/**
 * ConfigPanel — generic JSON Schema → form renderer (CC3).
 *
 * Fetches the current config values (useTenantConfig) and the JSON Schema
 * (useConfigSchema) for a given namespace, then renders a react-hook-form
 * form with per-field inputs driven by the schema's property descriptors.
 *
 * Field type mapping:
 *   string + pattern /^#[0-9a-fA-F]{6}$/ or format:"color" → color picker
 *   string + enum                                           → Combobox (single select)
 *   string + maxLength > 100                               → textarea
 *   string (default)                                       → text input
 *   integer | number                                       → number input
 *   boolean                                                → inline Toggle
 *   object (depth ≤ 2)                                     → fieldset, flattened to "parent.child" key
 *   (deeper nesting)                                       → JSON textarea fallback
 *
 * Each dirty field is saved independently via useUpdateConfig, so the user
 * gets per-field success/error toasts. A shared `reason` textarea (≥ 20 chars)
 * is required for all submissions.
 */

import { useEffect, useId } from 'react';
import { useForm, type SubmitHandler } from 'react-hook-form';
import { Settings } from 'lucide-react';
import { cn } from '@/lib/cn';
import { Combobox, EmptyState, Skeleton, useToast } from '@/components/ui';
import { useTenantConfig, useUpdateConfig, useConfigSchema } from '@/store/tenant-config';
import type { JsonSchemaProp } from '@/store/tenant-config';
import { useTenantStore } from '@/store/tenant';
import { HttpError } from '@/lib/http';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export type ConfigPanelProps = {
  namespace: string;
  title?: string;
  description?: string;
};

type FormValues = Record<string, string>;

// CC7: allowlist of branding fields that can update the tenant store
// (avoid corrupting the typed Tenant shape with arbitrary keys)
const BRANDING_STORE_FIELDS = new Set([
  'primary_color',
  'monogram',
  'logo_path',
  'favicon_path',
  'login_banner',
  'footer_text',
  // Wave D extended branding fields
  'product_name',
  'tagline',
  'welcome_message',
  'subtitle',
  'login_logo_url',
  'login_background_color',
  'login_background_image_url',
  'footer_copyright',
  'support_email',
  'support_phone',
  'favicon_url',
  'theme_mode',
]);

// ---------------------------------------------------------------------------
// Inline Toggle (CC4 doesn't ship one; defined locally, not exported)
// ---------------------------------------------------------------------------

function Toggle({
  checked,
  onChange,
  label,
  id,
}: {
  checked: boolean;
  onChange: (v: boolean) => void;
  label: string;
  id: string;
}) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-labelledby={`${id}-label`}
      onClick={() => onChange(!checked)}
      className={cn(
        'relative inline-flex h-5 w-9 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent',
        'transition-colors duration-200 ease-in-out',
        'focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1',
        checked ? 'bg-brand-blue' : 'bg-border',
      )}
    >
      <span
        className={cn(
          'pointer-events-none inline-block h-4 w-4 transform rounded-full bg-white shadow',
          'transition duration-200 ease-in-out',
          checked ? 'translate-x-4' : 'translate-x-0',
        )}
      />
      <span className="sr-only">{label}</span>
    </button>
  );
}

// ---------------------------------------------------------------------------
// Helpers — derive display info from a JSON Schema property
// ---------------------------------------------------------------------------

const COLOR_PATTERN = /^\#[0-9a-fA-F]{6}$/;

type FieldKind =
  | 'color'
  | 'enum'
  | 'textarea'
  | 'text'
  | 'number'
  | 'boolean'
  | 'object'
  | 'json';

function classifyField(prop: JsonSchemaProp): FieldKind {
  const t = prop.type ?? 'string';
  if (t === 'boolean') return 'boolean';
  if (t === 'integer' || t === 'number') return 'number';
  if (t === 'object') return 'object';
  if (t === 'string') {
    if (prop.format === 'color') return 'color';
    if (prop.pattern !== undefined && COLOR_PATTERN.test('#000000') && prop.pattern.includes('a-fA-F')) return 'color';
    if (prop.enum !== undefined && prop.enum.length > 0) return 'enum';
    if (prop.maxLength !== undefined && prop.maxLength > 100) return 'textarea';
    return 'text';
  }
  return 'json';
}

/** Convert a raw config value to a form-compatible string. */
function toFormString(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Convert a form string back to the typed value implied by the schema prop. */
function fromFormString(raw: string, prop: JsonSchemaProp): unknown {
  const t = prop.type ?? 'string';
  if (t === 'boolean') return raw === 'true';
  if (t === 'integer') return parseInt(raw, 10);
  if (t === 'number') return parseFloat(raw);
  return raw;
}

// ---------------------------------------------------------------------------
// Single field renderer
// ---------------------------------------------------------------------------

function FieldRenderer({
  fieldKey,
  prop,
  currentStr,
  register,
  watch,
  setValue,
  formId,
}: {
  fieldKey: string;
  prop: JsonSchemaProp;
  currentStr: string;
  register: ReturnType<typeof useForm<FormValues>>['register'];
  watch: ReturnType<typeof useForm<FormValues>>['watch'];
  setValue: ReturnType<typeof useForm<FormValues>>['setValue'];
  formId: string;
}) {
  const kind = classifyField(prop);
  const labelId = `${formId}-${fieldKey}-label`;
  const inputId = `${formId}-${fieldKey}`;
  const currentValue = watch(fieldKey);
  const isDifferentFromSaved = currentValue !== currentStr;

  const labelText = prop.description ?? fieldKey.replace(/\./g, ' › ');

  function resetToCurrent() {
    setValue(fieldKey, currentStr, { shouldDirty: true });
  }

  const sharedInputClass =
    'input mt-1 w-full';

  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-baseline justify-between gap-2">
        <label id={labelId} htmlFor={inputId} className="label text-ink text-sm font-medium">
          {labelText}
        </label>
        {isDifferentFromSaved && currentStr !== '' && (
          <button
            type="button"
            onClick={resetToCurrent}
            className="text-xs text-brand-blue hover:underline focus:outline-none"
          >
            Reset to saved
          </button>
        )}
      </div>

      {kind === 'color' && (
        <div className="flex items-center gap-2 mt-1">
          <input
            id={inputId}
            type="color"
            {...register(fieldKey)}
            className="h-9 w-14 cursor-pointer rounded-input border border-border p-0.5 focus:outline-none focus:ring-2 focus:ring-brand-blue"
          />
          <input
            type="text"
            value={currentValue}
            onChange={(e) => setValue(fieldKey, e.target.value, { shouldDirty: true })}
            placeholder="#000000"
            className={cn(sharedInputClass, 'flex-1')}
            aria-labelledby={labelId}
          />
        </div>
      )}

      {kind === 'enum' && prop.enum !== undefined && (
        <Combobox
          options={(prop.enum).map((v) => ({ value: v, label: v }))}
          value={currentValue}
          onChange={(v) => setValue(fieldKey, v, { shouldDirty: true })}
          placeholder={`Select ${labelText}`}
          className="mt-1"
        />
      )}

      {kind === 'textarea' && (
        <textarea
          id={inputId}
          {...register(fieldKey)}
          rows={3}
          className={cn(sharedInputClass, 'resize-y')}
          aria-labelledby={labelId}
        />
      )}

      {kind === 'text' && (
        <input
          id={inputId}
          type="text"
          {...register(fieldKey)}
          className={sharedInputClass}
          aria-labelledby={labelId}
        />
      )}

      {kind === 'number' && (
        <input
          id={inputId}
          type="number"
          min={prop.minimum}
          max={prop.maximum}
          {...register(fieldKey)}
          className={sharedInputClass}
          aria-labelledby={labelId}
        />
      )}

      {kind === 'boolean' && (
        <div className="mt-1 flex items-center gap-3">
          <Toggle
            id={inputId}
            checked={currentValue === 'true'}
            onChange={(v) => setValue(fieldKey, v ? 'true' : 'false', { shouldDirty: true })}
            label={labelText}
          />
          <span id={`${inputId}-label`} className="text-sm text-ink-sub">
            {currentValue === 'true' ? 'Enabled' : 'Disabled'}
          </span>
        </div>
      )}

      {kind === 'json' && (
        <textarea
          id={inputId}
          {...register(fieldKey)}
          rows={4}
          className={cn(sharedInputClass, 'resize-y font-mono text-xs')}
          aria-labelledby={labelId}
        />
      )}

      {/* Saved value hint */}
      {currentStr !== '' && kind !== 'color' && kind !== 'enum' && (
        <p className="mt-0.5 text-xs text-muted">
          Saved: <span className="font-mono">{currentStr.length > 60 ? `${currentStr.slice(0, 60)}…` : currentStr}</span>
        </p>
      )}
    </div>
  );
}

// ---------------------------------------------------------------------------
// ConfigPanel — main component
// ---------------------------------------------------------------------------

export function ConfigPanel({ namespace, title, description }: ConfigPanelProps) {
  const formId = useId();
  const { toast } = useToast();

  const configQuery = useTenantConfig(namespace);
  const schemaQuery = useConfigSchema(namespace);
  const updateConfig = useUpdateConfig(namespace);

  const schema = schemaQuery.data?.schema;
  const properties = schema?.properties ?? {};
  const configMap = configQuery.data ?? {};

  // Build a flat list of field entries: [key, propDescriptor, currentValue].
  // For object-type properties, we flatten one level deep (key.subkey).
  type FlatField = { key: string; prop: JsonSchemaProp; currentStr: string };
  const flatFields: FlatField[] = [];

  for (const [propKey, rawProp] of Object.entries(properties)) {
    const prop = rawProp as JsonSchemaProp;
    const kind = classifyField(prop);
    if (kind === 'object' && prop.properties) {
      // Flatten one level.
      for (const [subKey, rawSubProp] of Object.entries(prop.properties)) {
        const subProp = rawSubProp as JsonSchemaProp;
        const flatKey = `${propKey}.${subKey}`;
        flatFields.push({
          key: flatKey,
          prop: subProp,
          currentStr: toFormString(configMap[flatKey] ?? configMap[propKey]),
        });
      }
    } else {
      flatFields.push({
        key: propKey,
        prop,
        currentStr: toFormString(configMap[propKey]),
      });
    }
  }

  // Build default form values from current config.
  const defaultValues: FormValues = {};
  for (const f of flatFields) {
    defaultValues[f.key] = f.currentStr;
  }

  const {
    register,
    handleSubmit,
    watch,
    setValue,
    reset,
    formState: { isDirty, dirtyFields },
  } = useForm<FormValues>({ defaultValues });

  // Re-sync form when config data loads or changes.
  useEffect(() => {
    if (configQuery.data !== undefined) {
      const next: FormValues = {};
      for (const f of flatFields) {
        next[f.key] = f.currentStr;
      }
      reset(next);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [configQuery.dataUpdatedAt]);

  const reasonFieldId = `${formId}-reason`;
  const reasonValue = watch('__reason__' as keyof FormValues) ?? '';
  const reasonOk = reasonValue.length >= 20;

  const onSubmit: SubmitHandler<FormValues> = async (values) => {
    const reason = values['__reason__'] ?? '';
    if (reason.length < 20) return;

    // Submit only dirty fields (excluding __reason__).
    const toSave = Object.keys(dirtyFields).filter((k) => k !== '__reason__');
    if (toSave.length === 0) return;

    for (const key of toSave) {
      const fieldProp = flatFields.find((f) => f.key === key)?.prop ?? { type: 'string' };
      const typed = fromFormString(values[key] ?? '', fieldProp);
      try {
        const result = await updateConfig.mutateAsync({ key, value: typed, reason });
        toast({
          variant: 'success',
          title: `Saved · ${key}`,
          message: `History row written (hash …${result.hash.slice(-8)})`,
        });

        // CC7: if this is a branding field, update the tenant store immediately
        // for live CSS var refresh (TenantBrandingEffect will pick it up)
        if (namespace === 'branding' && BRANDING_STORE_FIELDS.has(key)) {
          const currentTenant = useTenantStore.getState().tenant;
          if (currentTenant) {
            useTenantStore.getState().setTenant({
              ...currentTenant,
              [key]: typed,
            });
          }
        }
      } catch (err) {
        const msg = err instanceof HttpError ? err.message : 'Unknown error';
        if (err instanceof HttpError && err.status === 403) {
          toast({
            variant: 'error',
            title: 'Permission denied',
            message: 'You do not have permission to edit this namespace.',
          });
        } else {
          toast({ variant: 'error', title: `Failed to save ${key}`, message: msg });
        }
      }
    }

    // Clear the reason field after a successful batch.
    setValue('__reason__' as keyof FormValues, '' as string, { shouldDirty: false });
  };

  // ---------------------------------------------------------------------------
  // Loading state
  // ---------------------------------------------------------------------------

  if (schemaQuery.isLoading || configQuery.isLoading) {
    return (
      <div className="space-y-4 py-4">
        <Skeleton className="h-6 w-48" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-full" />
        <Skeleton className="h-10 w-3/4" />
      </div>
    );
  }

  // ---------------------------------------------------------------------------
  // Schema not registered (404) — graceful empty state
  // ---------------------------------------------------------------------------

  if (schemaQuery.isError) {
    return (
      <EmptyState
        icon={<Settings size={20} />}
        title="No configuration schema registered"
        body="No configuration schema is registered for this namespace yet. Modules that own this namespace will publish their schema as they ship."
      />
    );
  }

  // ---------------------------------------------------------------------------
  // Happy path — render form
  // ---------------------------------------------------------------------------

  const panelTitle = title ?? namespace;

  return (
    <div>
      {/* Header */}
      <div className="mb-6">
        <h2 className="text-xl font-semibold text-ink">{panelTitle}</h2>
        {description !== undefined && (
          <p className="mt-1 text-sm text-muted">{description}</p>
        )}
      </div>

      {flatFields.length === 0 && (
        <EmptyState
          title="Empty schema"
          body="The schema for this namespace has no properties defined yet."
        />
      )}

      {flatFields.length > 0 && (
        <form id={formId} onSubmit={handleSubmit(onSubmit)} noValidate>
          {/* Config fields */}
          <div className="space-y-5">
            {flatFields.map((f) => (
              <FieldRenderer
                key={f.key}
                fieldKey={f.key}
                prop={f.prop}
                currentStr={f.currentStr}
                register={register}
                watch={watch}
                setValue={setValue}
                formId={formId}
              />
            ))}
          </div>

          {/* Reason + submit */}
          <div className="mt-8 border-t border-divider pt-6 space-y-3">
            <div>
              <label htmlFor={reasonFieldId} className="label text-sm font-medium text-ink">
                Reason for change <span className="text-danger">*</span>
              </label>
              <textarea
                id={reasonFieldId}
                {...register('__reason__' as keyof FormValues)}
                rows={3}
                placeholder="Describe why you are making this change (minimum 20 characters)…"
                className={cn(
                  'input mt-1 w-full resize-none',
                  reasonValue.length > 0 && !reasonOk && 'border-danger focus:border-danger focus:ring-danger/20',
                )}
              />
              <p className={cn(
                'mt-0.5 text-xs',
                reasonValue.length === 0 ? 'text-muted' :
                reasonOk ? 'text-success' : 'text-danger',
              )}>
                {reasonValue.length}/20 characters minimum
              </p>
            </div>

            <button
              type="submit"
              disabled={!isDirty || !reasonOk || updateConfig.isPending}
              className={cn(
                'inline-flex items-center justify-center gap-2 rounded-input px-5 py-2 text-sm font-medium text-white transition-colors',
                'bg-brand-blue hover:bg-brand-blueHover',
                'focus:outline-none focus:ring-2 focus:ring-brand-blue focus:ring-offset-1',
                'disabled:opacity-40 disabled:cursor-not-allowed',
              )}
            >
              {updateConfig.isPending ? 'Saving…' : 'Save changes'}
            </button>
          </div>
        </form>
      )}
    </div>
  );
}
