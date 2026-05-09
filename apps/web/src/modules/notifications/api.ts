import { get, post } from '@/lib/http';
import {
  NotificationFeedSchema,
  OkSchema,
  TestSendResponseSchema,
  type TestSendRequest,
} from './schemas';

export function fetchFeed(params: { limit?: number; offset?: number; unread?: boolean }) {
  return get('/spa/api/notifications', NotificationFeedSchema, {
    limit:  params.limit  ?? 50,
    offset: params.offset ?? 0,
    unread: params.unread ? 'true' : undefined,
  });
}

export function markRead(id: number) {
  return post(`/spa/api/notifications/${id}/mark-read`, {}, OkSchema);
}

export function markAllRead() {
  return post('/spa/api/notifications/mark-all-read', {}, OkSchema);
}

export function testSend(body: TestSendRequest) {
  return post('/spa/api/admin/notifications/test-send', body, TestSendResponseSchema);
}
