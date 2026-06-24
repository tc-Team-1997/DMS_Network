export interface TabItem { key: string; label: string; }

export interface TabsProps {
  items:    TabItem[];
  active:   string;
  onChange: (key: string) => void;
}

export function Tabs({ items, active, onChange }: TabsProps) {
  return (
    <div className="tabs">
      {items.map(t => (
        <button
          key={t.key}
          className={`tab${active === t.key ? " on" : ""}`}
          onClick={() => onChange(t.key)}
          type="button"
        >
          {t.label}
        </button>
      ))}
    </div>
  );
}
