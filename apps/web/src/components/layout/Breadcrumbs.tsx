// Test IDs shipped by this component:
//   data-testid="breadcrumbs"
//
// Breadcrumbs renders the current route as a trail sourced from nav.ts entries
// plus an optional ?tab=… param segment.

import { Link, useLocation, useSearchParams } from 'react-router-dom';
import { ChevronRight, Home } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import { navItems } from './nav';

interface Crumb {
  label: string;
  to?: string;
}

export function Breadcrumbs() {
  const { pathname } = useLocation();
  const [params] = useSearchParams();
  const { t } = useTranslation();

  const crumbs: Crumb[] = [{ label: t('nav.home', 'Home'), to: '/' }];

  // Resolve the nav entry for this path — find the longest prefix match.
  const item = navItems
    .filter((n) =>
      n.path === '/' ? pathname === '/' : pathname === n.path || pathname.startsWith(n.path + '/'),
    )
    .sort((a, b) => b.path.length - a.path.length)[0];

  if (item) {
    crumbs.push({
      label: item.i18nKey ? t(item.i18nKey, item.label) : item.label,
      to: item.path,
    });
  }

  // For tab-based routes, append the active tab label.
  const tab = params.get('tab');
  if (tab) {
    const tabLabel = tab.charAt(0).toUpperCase() + tab.slice(1);
    crumbs.push({ label: tabLabel });
  }

  return (
    <nav data-testid="breadcrumbs" aria-label={t('a11y.breadcrumb', 'Breadcrumb')}>
      <ol className="flex items-center gap-1 text-2xs text-muted">
        {crumbs.map((crumb, i) => (
          <li key={i} className="flex items-center gap-1">
            {i > 0 && (
              <ChevronRight size={10} className="text-divider" aria-hidden="true" />
            )}
            {crumb.to !== undefined && i < crumbs.length - 1 ? (
              <Link
                to={crumb.to}
                className="hover:text-ink"
                aria-label={i === 0 ? crumb.label : undefined}
              >
                {i === 0 ? <Home size={11} aria-hidden="true" /> : crumb.label}
              </Link>
            ) : (
              <span
                className="text-ink font-medium"
                aria-current={i === crumbs.length - 1 ? 'page' : undefined}
              >
                {i === 0 ? (
                  <>
                    <Home size={11} aria-hidden="true" />
                    <span className="sr-only">{crumb.label}</span>
                  </>
                ) : (
                  crumb.label
                )}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
