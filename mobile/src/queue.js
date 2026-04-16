// Offline queue: captures persist locally when offline, flush when network returns.
import AsyncStorage from '@react-native-async-storage/async-storage';
import NetInfo from '@react-native-community/netinfo';
import { uploadDocument, enqueueOcr } from './api';

const KEY = 'nbe.dms.offline_queue';

export async function enqueueLocal(item) {
  const raw = await AsyncStorage.getItem(KEY);
  const q = raw ? JSON.parse(raw) : [];
  q.push({ ...item, queued_at: Date.now() });
  await AsyncStorage.setItem(KEY, JSON.stringify(q));
  return q.length;
}

export async function pendingCount() {
  const raw = await AsyncStorage.getItem(KEY);
  return raw ? JSON.parse(raw).length : 0;
}

export async function flush() {
  const state = await NetInfo.fetch();
  if (!state.isConnected) return { attempted: 0, uploaded: 0, remaining: await pendingCount() };

  const raw = await AsyncStorage.getItem(KEY);
  const q = raw ? JSON.parse(raw) : [];
  const remaining = [];
  let uploaded = 0;
  for (const item of q) {
    try {
      const doc = await uploadDocument(item);
      await enqueueOcr(doc.id);
      uploaded++;
    } catch {
      remaining.push(item);
    }
  }
  await AsyncStorage.setItem(KEY, JSON.stringify(remaining));
  return { attempted: q.length, uploaded, remaining: remaining.length };
}

export function startAutoFlush(onResult) {
  return NetInfo.addEventListener(async (state) => {
    if (state.isConnected) {
      const r = await flush();
      onResult?.(r);
    }
  });
}
