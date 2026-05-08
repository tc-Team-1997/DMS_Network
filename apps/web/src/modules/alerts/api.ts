import { z } from 'zod';
import { get, post } from '@/lib/http';
import { AlertSchema, OkSchema } from '@/lib/schemas';

export const fetchAlerts = () =>
  get('/spa/api/alerts', z.array(AlertSchema), { limit: 200 });

export const markAlertRead = (id: number) =>
  post(`/spa/api/alerts/${id}/read`, {}, OkSchema);
