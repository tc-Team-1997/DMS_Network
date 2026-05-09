import { z } from 'zod';

export const NotificationSchema = z.object({
  id:          z.number().int(),
  channel:     z.string(),
  subject:     z.string(),
  body:        z.string(),
  status:      z.string(),
  sent_at:     z.string(),
  is_read:     z.number().int(),
  read_at:     z.string().nullable(),
  event_type:  z.string().nullable(),
  template_id: z.string().nullable(),
});
export type Notification = z.infer<typeof NotificationSchema>;

export const NotificationFeedSchema = z.object({
  items:        z.array(NotificationSchema),
  unread_count: z.number().int(),
  limit:        z.number().int(),
  offset:       z.number().int(),
});
export type NotificationFeed = z.infer<typeof NotificationFeedSchema>;

export const OkSchema = z.object({ ok: z.literal(true) });

export const TestSendRequestSchema = z.object({
  template_id: z.string(),
  channel:     z.string().optional(),
});
export type TestSendRequest = z.infer<typeof TestSendRequestSchema>;

export const TestSendResponseSchema = z.object({
  ok:          z.literal(true),
  template_id: z.string(),
  subject:     z.string(),
  body:        z.string(),
  results:     z.record(z.object({ ok: z.boolean(), error: z.string().optional() })),
  skipped:     z.array(z.string()),
});
export type TestSendResponse = z.infer<typeof TestSendResponseSchema>;
