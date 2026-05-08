import { z } from 'zod';
import { get } from '@/lib/http';

export const DocbrainHealthSchema = z.object({
  ok: z.boolean().optional(),
  status: z.string().optional(),
  ollama: z.object({
    ok: z.boolean().optional(),
    base_url: z.string().optional(),
    chat_model: z.string().optional(),
    embed_model: z.string().optional(),
  }).passthrough().optional(),
  vectors: z.object({
    count: z.number().optional(),
  }).passthrough().optional(),
}).passthrough();
export type DocbrainHealth = z.infer<typeof DocbrainHealthSchema>;

export const fetchDocbrainHealth = () =>
  get('/spa/api/docbrain/health', DocbrainHealthSchema);
