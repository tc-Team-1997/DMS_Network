import { useLocation } from 'react-router-dom';
import { Panel } from '@/components/ui';
import { Construction } from 'lucide-react';
import { navItems } from '@/components/layout/nav';

export function ComingSoonPage() {
  const loc = useLocation();
  const item = navItems.find((n) => n.path === loc.pathname);
  return (
    <Panel>
      <div className="py-16 flex flex-col items-center text-center">
        <Construction size={36} className="text-muted mb-3" />
        <h2 className="text-lg font-semibold text-ink mb-1">{item?.label ?? 'Coming soon'}</h2>
        <p className="text-md text-muted max-w-md">
          This module is part of the next milestone. The backend endpoints exist;
          the UI is scheduled after M1 ships.
        </p>
      </div>
    </Panel>
  );
}
