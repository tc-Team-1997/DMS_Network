/**
 * useUrlState — sync SearchFilters ↔ URL search params.
 *
 * Reading: parse current ?q=…&doc_type[]=…&page=… into a SearchFilters object.
 * Writing: push a new history entry with the serialised filters.
 *
 * Array params are stored as repeated keys without bracket notation to keep
 * URLs human-readable, e.g. ?branch=Thimphu&branch=Paro.
 * The backend accepts both `branch` and `branch[]`.
 */

import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router-dom';
import { DEFAULT_FILTERS, type SearchFilters } from '../schemas';

function getAll(params: URLSearchParams, key: string): string[] {
  return params.getAll(key).filter(Boolean);
}

function getString(params: URLSearchParams, key: string): string {
  return params.get(key) ?? '';
}

export function useUrlState(): [SearchFilters, (next: Partial<SearchFilters>) => void] {
  const { search } = useLocation();
  const navigate = useNavigate();

  const filters: SearchFilters = (() => {
    const params = new URLSearchParams(search);
    const page = parseInt(params.get('page') ?? '1', 10);
    const page_size = parseInt(params.get('page_size') ?? '20', 10);
    return {
      q:                   getString(params, 'q'),
      doc_type:            getAll(params, 'doc_type'),
      branch:              getAll(params, 'branch'),
      risk_band:           getAll(params, 'risk_band'),
      status:              getAll(params, 'status'),
      uploaded_after:      params.get('uploaded_after')     ?? undefined,
      uploaded_before:     params.get('uploaded_before')    ?? undefined,
      expiry_within_days:  params.get('expiry_within_days') ?? undefined,
      customer_cid:        params.get('customer_cid')       ?? undefined,
      page:                isNaN(page)      ? 1  : Math.max(1, page),
      page_size:           isNaN(page_size) ? 20 : Math.max(1, page_size),
    };
  })();

  const setFilters = useCallback(
    (next: Partial<SearchFilters>) => {
      const merged: SearchFilters = { ...filters, ...next };
      // Reset page to 1 whenever anything other than page changes.
      const keys = Object.keys(next) as Array<keyof SearchFilters>;
      const onlyPage = keys.length === 1 && keys[0] === 'page';
      if (!onlyPage) merged.page = 1;

      const params = new URLSearchParams();

      if (merged.q)         params.set('q', merged.q);
      if (merged.page > 1)  params.set('page', String(merged.page));
      if (merged.page_size !== DEFAULT_FILTERS.page_size)
        params.set('page_size', String(merged.page_size));

      for (const v of merged.doc_type)   params.append('doc_type', v);
      for (const v of merged.branch)     params.append('branch', v);
      for (const v of merged.risk_band)  params.append('risk_band', v);
      for (const v of merged.status)     params.append('status', v);

      if (merged.uploaded_after)     params.set('uploaded_after',     merged.uploaded_after);
      if (merged.uploaded_before)    params.set('uploaded_before',    merged.uploaded_before);
      if (merged.expiry_within_days) params.set('expiry_within_days', merged.expiry_within_days);
      if (merged.customer_cid)       params.set('customer_cid',       merged.customer_cid);

      navigate({ search: params.toString() }, { replace: false });
    },
    [filters, navigate],
  );

  return [filters, setFilters];
}
