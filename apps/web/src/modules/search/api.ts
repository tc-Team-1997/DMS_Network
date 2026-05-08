import { z } from 'zod';
import { get } from '@/lib/http';
import { DocumentSchema } from '@/lib/schemas';

export const fetchSearch = (q: string) =>
  get('/spa/api/search', z.array(DocumentSchema), { q });
