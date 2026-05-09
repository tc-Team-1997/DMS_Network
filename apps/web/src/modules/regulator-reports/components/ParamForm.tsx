/**
 * ParamForm — dynamic form rendered from a template's parameters_schema JSON Schema.
 * Mirrors CC3 ConfigPanel idiom: iterates JSON Schema properties, maps each
 * to an appropriate input control, and calls onSubmit with the collected values.
 *
 * Supports: string (text/textarea/date/email/date-time), integer/number, boolean, array.
 * Deep objects (depth > 1) fall back to a JSON textarea.
 */
import { useState, type FormEvent } from 'react';
import { Button, Input } from '@/components/ui';

// ---------------------------------------------------------------------------
// Minimal JSON Schema shape (draft-07, single level deep)
// ---------------------------------------------------------------------------

type SchemaProp = {
  type?: string | string[];
  description?: string;
  enum?: string[];
  format?: string;
  default?: unknown;
  minimum?: number;
  maximum?: number;
  minLength?: number;
  items?: { type?: string };
};

type JsonSchema = {
  $schema?: string;
  type?: string;
  required?: string[];
  properties?: Record<string, SchemaProp>;
};

interface Props {
  schemaJson: string;
  /** Called when the form is submitted with collected param values. */
  onSubmit: (values: Record<string, unknown>) => void;
  disabled?: boolean;
}

function parseSchema(json: string): JsonSchema {
  try {
    return JSON.parse(json) as JsonSchema;
  } catch {
    return {};
  }
}

function defaultValue(prop: SchemaProp): string {
  if (prop.default !== undefined) return String(prop.default);
  const t = Array.isArray(prop.type) ? prop.type[0] : prop.type;
  if (t === 'boolean') return 'false';
  if (t === 'array') return '[]';
  return '';
}

function coerce(value: string, prop: SchemaProp): unknown {
  const t = Array.isArray(prop.type) ? prop.type[0] : prop.type;
  if (t === 'integer') return value === '' ? null : parseInt(value, 10);
  if (t === 'number') return value === '' ? null : parseFloat(value);
  if (t === 'boolean') return value === 'true';
  if (t === 'array') {
    try { return JSON.parse(value); } catch { return []; }
  }
  return value;
}

export function ParamForm({ schemaJson, onSubmit, disabled = false }: Props) {
  const schema = parseSchema(schemaJson);
  const props = schema.properties ?? {};
  const required = new Set(schema.required ?? []);

  const [values, setValues] = useState<Record<string, string>>(() => {
    const init: Record<string, string> = {};
    for (const [key, prop] of Object.entries(props)) {
      init[key] = defaultValue(prop);
    }
    return init;
  });

  function handleChange(key: string, val: string) {
    setValues((prev) => ({ ...prev, [key]: val }));
  }

  function handleSubmit(e: FormEvent) {
    e.preventDefault();
    const coerced: Record<string, unknown> = {};
    for (const [key, prop] of Object.entries(props)) {
      const raw = values[key] ?? '';
      coerced[key] = coerce(raw, prop);
    }
    onSubmit(coerced);
  }

  const entries = Object.entries(props);
  if (entries.length === 0) {
    return (
      <p className="text-xs text-muted italic">This template has no configurable parameters.</p>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4">
      {entries.map(([key, prop]) => {
        const t = Array.isArray(prop.type) ? prop.type[0] : prop.type;
        const isRequired = required.has(key);
        const label = (
          <label
            key={`lbl-${key}`}
            htmlFor={`param-${key}`}
            className="block text-xs font-medium text-ink-sub mb-1"
          >
            {key.replace(/_/g, ' ')}{isRequired && <span className="text-danger ml-0.5">*</span>}
          </label>
        );
        const description = prop.description ? (
          <p className="mt-0.5 text-[10px] text-muted">{prop.description}</p>
        ) : null;

        // Boolean → checkbox
        if (t === 'boolean') {
          return (
            <div key={key}>
              {label}
              <div className="flex items-center gap-2">
                <input
                  type="checkbox"
                  id={`param-${key}`}
                  checked={values[key] === 'true'}
                  onChange={(e) => handleChange(key, e.target.checked ? 'true' : 'false')}
                  disabled={disabled}
                  className="h-4 w-4 rounded border-border text-brand-blue focus:ring-brand-blue"
                />
                <span className="text-sm text-ink">{key.replace(/_/g, ' ')}</span>
              </div>
              {description}
            </div>
          );
        }

        // Enum → select
        if (prop.enum && prop.enum.length > 0) {
          return (
            <div key={key}>
              {label}
              <select
                id={`param-${key}`}
                value={values[key] ?? ''}
                onChange={(e) => handleChange(key, e.target.value)}
                required={isRequired}
                disabled={disabled}
                className="block w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue disabled:opacity-50"
              >
                <option value="">— select —</option>
                {prop.enum.map((v) => (
                  <option key={v} value={v}>{v}</option>
                ))}
              </select>
              {description}
            </div>
          );
        }

        // Array → JSON textarea
        if (t === 'array') {
          return (
            <div key={key}>
              {label}
              <textarea
                id={`param-${key}`}
                value={values[key] ?? '[]'}
                onChange={(e) => handleChange(key, e.target.value)}
                rows={3}
                disabled={disabled}
                placeholder='["item1","item2"]'
                className="block w-full rounded-input border border-border bg-surface px-3 py-2 font-mono text-xs text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue disabled:opacity-50"
              />
              {description}
            </div>
          );
        }

        // Integer / number
        if (t === 'integer' || t === 'number') {
          return (
            <div key={key}>
              {label}
              <Input
                id={`param-${key}`}
                type="number"
                value={values[key] ?? ''}
                onChange={(e) => handleChange(key, e.target.value)}
                required={isRequired}
                disabled={disabled}
                min={prop.minimum}
                max={prop.maximum}
              />
              {description}
            </div>
          );
        }

        // Date / datetime-local
        if (prop.format === 'date') {
          return (
            <div key={key}>
              {label}
              <Input
                id={`param-${key}`}
                type="date"
                value={values[key] ?? ''}
                onChange={(e) => handleChange(key, e.target.value)}
                required={isRequired}
                disabled={disabled}
              />
              {description}
            </div>
          );
        }
        if (prop.format === 'date-time') {
          return (
            <div key={key}>
              {label}
              <Input
                id={`param-${key}`}
                type="datetime-local"
                value={values[key] ?? ''}
                onChange={(e) => handleChange(key, e.target.value)}
                required={isRequired}
                disabled={disabled}
              />
              {description}
            </div>
          );
        }

        // Long string → textarea
        if (prop.minLength !== undefined && prop.minLength >= 20) {
          return (
            <div key={key}>
              {label}
              <textarea
                id={`param-${key}`}
                value={values[key] ?? ''}
                onChange={(e) => handleChange(key, e.target.value)}
                required={isRequired}
                disabled={disabled}
                minLength={prop.minLength}
                rows={3}
                className="block w-full rounded-input border border-border bg-surface px-3 py-2 text-sm text-ink focus:outline-none focus:ring-2 focus:ring-brand-blue disabled:opacity-50"
              />
              {description}
            </div>
          );
        }

        // Default: text
        return (
          <div key={key}>
            {label}
            <Input
              id={`param-${key}`}
              type="text"
              value={values[key] ?? ''}
              onChange={(e) => handleChange(key, e.target.value)}
              required={isRequired}
              disabled={disabled}
            />
            {description}
          </div>
        );
      })}

      <Button type="submit" disabled={disabled}>
        Generate report
      </Button>
    </form>
  );
}
