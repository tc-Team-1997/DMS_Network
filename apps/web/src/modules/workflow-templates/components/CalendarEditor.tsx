/**
 * CalendarEditor — business hours + BoB national holiday list editor.
 *
 * Bank of Bhutan national holidays seeded as defaults.
 * Business hours default: Mon–Fri 09:00–17:00 Asia/Thimphu (BTN tz).
 */

import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { Button } from '@/components/ui';
import type { BusinessHours } from '../schemas';

// BoB national holidays — Bank of Bhutan (2026 approximations).
// Royal Government of Bhutan public holiday schedule.
export const BOB_DEFAULT_HOLIDAYS: string[] = [
  '2026-01-02', // Nyilo (Winter Solstice)
  '2026-02-21', // His Majesty the King's Birthday (5th Druk Gyalpo)
  '2026-02-25', // Losar (Bhutanese New Year — lunar; approximate)
  '2026-05-02', // Birth anniversary of the Third Druk Gyalpo
  '2026-06-02', // Birth anniversary of the Fourth Druk Gyalpo
  '2026-09-22', // Blessed Rainy Day (Thrue Bab — lunar; approximate)
  '2026-10-13', // Royal Wedding Anniversary
  '2026-10-15', // Dashain (first day)
  '2026-10-16', // Dashain (Dussehra)
  '2026-10-24', // Thimphu Drubchen begins (lunar; approximate)
  '2026-10-25', // Thimphu Tsechu begins
  '2026-10-26', // Thimphu Tsechu
  '2026-10-27', // Thimphu Tsechu last day
  '2026-12-17', // National Day (Unification of Bhutan)
];

export const BOB_DEFAULT_HOURS: BusinessHours = {
  days:  [1, 2, 3, 4, 5],
  start: '09:00',
  end:   '17:00',
  tz:    'Asia/Thimphu',
};

const DAY_LABELS: Record<number, string> = {
  1: 'Mon', 2: 'Tue', 3: 'Wed', 4: 'Thu', 5: 'Fri', 6: 'Sat', 7: 'Sun',
};

interface CalendarEditorProps {
  name:                string;
  holidays:            string[];
  businessHours:       BusinessHours;
  onChangeName:        (n: string) => void;
  onChangeHolidays:    (h: string[]) => void;
  onChangeHours:       (h: BusinessHours) => void;
  readonly?:           boolean;
}

export function CalendarEditor({
  name,
  holidays,
  businessHours,
  onChangeName,
  onChangeHolidays,
  onChangeHours,
  readonly = false,
}: CalendarEditorProps) {
  const [newHoliday, setNewHoliday] = useState('');

  const addHoliday = () => {
    const d = newHoliday.trim();
    if (!d || holidays.includes(d)) return;
    onChangeHolidays([...holidays, d].sort());
    setNewHoliday('');
  };

  const removeHoliday = (d: string) => {
    onChangeHolidays(holidays.filter((h) => h !== d));
  };

  const toggleDay = (day: number) => {
    if (readonly) return;
    const days = businessHours.days.includes(day)
      ? businessHours.days.filter((d) => d !== day)
      : [...businessHours.days, day].sort((a, b) => a - b);
    onChangeHours({ ...businessHours, days });
  };

  const seedBoB = () => {
    onChangeHolidays(BOB_DEFAULT_HOLIDAYS);
    onChangeHours(BOB_DEFAULT_HOURS);
  };

  return (
    <div className="space-y-4">
      {/* Name */}
      <div>
        <label className="label text-xs text-muted block mb-1">Calendar name</label>
        <input
          type="text"
          value={name}
          readOnly={readonly}
          onChange={(e) => onChangeName(e.target.value)}
          className="input w-full"
          placeholder="e.g. Bank of Bhutan — Standard"
        />
      </div>

      {!readonly && (
        <Button size="sm" variant="ghost" onClick={seedBoB} type="button">
          Seed BoB national holidays (2026)
        </Button>
      )}

      {/* Business hours */}
      <div className="rounded-card border border-divider p-4 space-y-3">
        <h4 className="text-xs font-semibold text-ink">Business hours</h4>

        {/* Day toggles */}
        <div className="flex gap-2 flex-wrap">
          {[1, 2, 3, 4, 5, 6, 7].map((day) => {
            const active = businessHours.days.includes(day);
            return (
              <button
                key={day}
                type="button"
                onClick={() => toggleDay(day)}
                disabled={readonly}
                aria-pressed={active}
                className={`h-8 w-10 rounded-input text-xs font-medium border transition-colors ${
                  active
                    ? 'bg-brand-blue text-white border-brand-blue'
                    : 'bg-surface text-ink-sub border-border hover:border-brand-blue'
                } disabled:opacity-60`}
              >
                {DAY_LABELS[day]}
              </button>
            );
          })}
        </div>

        {/* Start / End */}
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted w-12">Start</label>
          <input
            type="time"
            value={businessHours.start}
            readOnly={readonly}
            onChange={(e) => onChangeHours({ ...businessHours, start: e.target.value })}
            className="input h-8 text-xs"
          />
          <label className="text-xs text-muted w-8">End</label>
          <input
            type="time"
            value={businessHours.end}
            readOnly={readonly}
            onChange={(e) => onChangeHours({ ...businessHours, end: e.target.value })}
            className="input h-8 text-xs"
          />
        </div>

        {/* Timezone */}
        <div className="flex items-center gap-3">
          <label className="text-xs text-muted w-12">TZ</label>
          <input
            type="text"
            value={businessHours.tz}
            readOnly={readonly}
            onChange={(e) => onChangeHours({ ...businessHours, tz: e.target.value })}
            className="input flex-1 h-8 text-xs font-mono"
            placeholder="e.g. Asia/Thimphu"
          />
        </div>
      </div>

      {/* Holidays */}
      <div className="space-y-2">
        <h4 className="text-xs font-semibold text-ink">National holidays ({holidays.length})</h4>
        <div className="rounded-card border border-divider overflow-y-auto max-h-48">
          {holidays.length === 0 && (
            <p className="px-3 py-4 text-xs text-muted text-center">No holidays added.</p>
          )}
          <ul className="divide-y divide-divider">
            {holidays.map((h) => (
              <li key={h} className="flex items-center px-3 py-1.5 gap-2">
                <span className="text-xs font-mono text-ink flex-1">{h}</span>
                {!readonly && (
                  <button
                    type="button"
                    aria-label={`Remove holiday ${h}`}
                    onClick={() => removeHoliday(h)}
                    className="text-muted hover:text-danger"
                  >
                    <Trash2 size={11} />
                  </button>
                )}
              </li>
            ))}
          </ul>
        </div>

        {!readonly && (
          <div className="flex items-center gap-2">
            <input
              type="date"
              value={newHoliday}
              onChange={(e) => setNewHoliday(e.target.value)}
              className="input h-8 text-xs"
              aria-label="New holiday date"
            />
            <Button size="sm" variant="secondary" onClick={addHoliday} type="button">
              <Plus size={12} /> Add
            </Button>
          </div>
        )}
      </div>
    </div>
  );
}
