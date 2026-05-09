/**
 * DmnEditor — decision table editor.
 * Renders inputs (variable names) and rule rows (conditions + output).
 * Produces a DmnTable that the engine in dmn.ts can evaluate.
 */

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';
import type { DmnTable, DmnRule } from '../schemas';

interface DmnEditorProps {
  table:     DmnTable;
  onChange:  (table: DmnTable) => void;
  readonly?: boolean;
}

function blankRule(inputs: string[]): DmnRule {
  const conditions: Record<string, string> = {};
  for (const inp of inputs) {
    conditions[inp] = '';
  }
  return { conditions, output: '' };
}

export function DmnEditor({ table, onChange, readonly = false }: DmnEditorProps) {
  const [newInput, setNewInput] = useState('');

  const addInput = () => {
    const name = newInput.trim();
    if (!name || table.inputs.includes(name)) return;
    const nextInputs = [...table.inputs, name];
    // Add the new input column to every existing rule.
    const nextRules = table.rules.map((r) => ({
      ...r,
      conditions: { ...r.conditions, [name]: '' },
    }));
    onChange({ ...table, inputs: nextInputs, rules: nextRules });
    setNewInput('');
  };

  const removeInput = (inp: string) => {
    const nextInputs = table.inputs.filter((i) => i !== inp);
    const nextRules  = table.rules.map((r) => {
      const cond = { ...r.conditions };
      delete cond[inp];
      return { ...r, conditions: cond };
    });
    onChange({ ...table, inputs: nextInputs, rules: nextRules });
  };

  const addRule = () => {
    onChange({ ...table, rules: [...table.rules, blankRule(table.inputs)] });
  };

  const removeRule = (idx: number) => {
    onChange({ ...table, rules: table.rules.filter((_, i) => i !== idx) });
  };

  const updateCondition = (ruleIdx: number, inp: string, value: string) => {
    onChange({
      ...table,
      rules: table.rules.map((r, i) =>
        i === ruleIdx ? { ...r, conditions: { ...r.conditions, [inp]: value } } : r,
      ),
    });
  };

  const updateOutput = (ruleIdx: number, value: string) => {
    onChange({
      ...table,
      rules: table.rules.map((r, i) =>
        i === ruleIdx ? { ...r, output: value } : r,
      ),
    });
  };

  const updateAnnotation = (ruleIdx: number, value: string) => {
    onChange({
      ...table,
      rules: table.rules.map((r, i) =>
        i === ruleIdx ? { ...r, annotation: value } : r,
      ),
    });
  };

  return (
    <div className="space-y-3">
      {/* Table name */}
      <div className="flex items-center gap-2">
        <span className="text-xs text-muted w-12">Name</span>
        <input
          type="text"
          value={table.name}
          readOnly={readonly}
          onChange={(e) => onChange({ ...table, name: e.target.value })}
          className="input flex-1 h-8 text-sm"
          placeholder="Decision table name"
        />
      </div>

      {/* Inputs row */}
      <div className="rounded-card border border-divider overflow-x-auto">
        <table className="w-full text-xs">
          <thead>
            <tr className="bg-surface-alt border-b border-divider">
              <th className="px-2 py-1.5 text-left text-muted font-medium w-8">#</th>
              {table.inputs.map((inp) => (
                <th key={inp} className="px-2 py-1.5 text-left text-ink font-semibold min-w-[100px]">
                  <div className="flex items-center gap-1">
                    <span>{inp}</span>
                    {!readonly && (
                      <button
                        type="button"
                        aria-label={`Remove input ${inp}`}
                        onClick={() => removeInput(inp)}
                        className="text-muted hover:text-danger ml-auto"
                      >
                        ×
                      </button>
                    )}
                  </div>
                </th>
              ))}
              <th className="px-2 py-1.5 text-left text-success font-semibold min-w-[100px]">
                Output
              </th>
              <th className="px-2 py-1.5 text-left text-muted font-normal min-w-[120px]">
                Annotation
              </th>
              {!readonly && <th className="w-8" />}
            </tr>
          </thead>
          <tbody>
            {table.rules.map((rule, rIdx) => (
              <tr key={rIdx} className="border-b border-divider last:border-0 hover:bg-divider/40">
                <td className="px-2 py-1 text-muted font-mono">{rIdx + 1}</td>
                {table.inputs.map((inp) => (
                  <td key={inp} className="px-2 py-1">
                    <input
                      type="text"
                      value={String(rule.conditions[inp] ?? '')}
                      readOnly={readonly}
                      onChange={(e) => updateCondition(rIdx, inp, e.target.value)}
                      className="input w-full h-7 text-xs font-mono"
                      placeholder='e.g. "HIGH" or >50000'
                      aria-label={`Rule ${rIdx + 1} condition for ${inp}`}
                    />
                  </td>
                ))}
                <td className="px-2 py-1">
                  <input
                    type="text"
                    value={rule.output}
                    readOnly={readonly}
                    onChange={(e) => updateOutput(rIdx, e.target.value)}
                    className="input w-full h-7 text-xs"
                    placeholder="Next stage name"
                    aria-label={`Rule ${rIdx + 1} output`}
                  />
                </td>
                <td className="px-2 py-1">
                  <input
                    type="text"
                    value={rule.annotation ?? ''}
                    readOnly={readonly}
                    onChange={(e) => updateAnnotation(rIdx, e.target.value)}
                    className="input w-full h-7 text-xs text-muted"
                    placeholder="Notes…"
                    aria-label={`Rule ${rIdx + 1} annotation`}
                  />
                </td>
                {!readonly && (
                  <td className="px-1 py-1">
                    <button
                      type="button"
                      aria-label={`Remove rule ${rIdx + 1}`}
                      onClick={() => removeRule(rIdx)}
                      className="w-6 h-6 flex items-center justify-center text-muted hover:text-danger rounded"
                    >
                      <Trash2 size={11} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
            {table.rules.length === 0 && (
              <tr>
                <td
                  colSpan={table.inputs.length + (readonly ? 2 : 3)}
                  className="px-2 py-4 text-center text-muted"
                >
                  No rules yet. Add a rule below.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Add input + add rule */}
      {!readonly && (
        <div className="flex items-center gap-2 flex-wrap">
          <div className="flex items-center gap-1">
            <input
              type="text"
              value={newInput}
              onChange={(e) => setNewInput(e.target.value)}
              onKeyDown={(e) => { if (e.key === 'Enter') addInput(); }}
              className="input h-8 text-xs w-36"
              placeholder="New input variable"
            />
            <Button size="sm" variant="ghost" onClick={addInput}>
              <Plus size={12} /> Input
            </Button>
          </div>
          <Button size="sm" variant="secondary" onClick={addRule}>
            <Plus size={12} /> Rule
          </Button>
        </div>
      )}

      <p className="text-[10px] text-muted">
        Hit policy: FIRST — rules evaluated top to bottom; first match wins. Leave conditions blank for a catch-all.
      </p>
    </div>
  );
}
