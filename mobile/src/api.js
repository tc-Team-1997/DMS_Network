import * as SecureStore from 'expo-secure-store';
import Constants from 'expo-constants';

const BASE = Constants.expoConfig?.extra?.apiBaseUrl || 'https://dms.nbe.local';
const TOKEN_KEY = 'nbe.dms.token';

export async function getToken() {
  return SecureStore.getItemAsync(TOKEN_KEY);
}

export async function setToken(t) {
  return SecureStore.setItemAsync(TOKEN_KEY, t);
}

export async function clearToken() {
  return SecureStore.deleteItemAsync(TOKEN_KEY);
}

async function authHeaders() {
  const token = await getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

export async function login(username, password) {
  const r = await fetch(`${BASE}/api/v1/auth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ username, password }),
  });
  if (!r.ok) throw new Error(`Login failed (${r.status})`);
  const j = await r.json();
  await setToken(j.access_token);
  return j;
}

export async function uploadDocument({ uri, name, mime, docType, customerCid, branch, expiryDate }) {
  const fd = new FormData();
  fd.append('file', { uri, name: name || 'capture.jpg', type: mime || 'image/jpeg' });
  if (docType) fd.append('doc_type', docType);
  if (customerCid) fd.append('customer_cid', customerCid);
  if (branch) fd.append('branch', branch);
  if (expiryDate) fd.append('expiry_date', expiryDate);
  fd.append('uploaded_by', 'mobile');

  const r = await fetch(`${BASE}/api/v1/documents`, {
    method: 'POST',
    headers: { ...(await authHeaders()) },
    body: fd,
  });
  if (!r.ok) throw new Error(`Upload failed (${r.status}): ${await r.text()}`);
  return r.json();
}

export async function enqueueOcr(documentId) {
  const r = await fetch(`${BASE}/api/v1/tasks`, {
    method: 'POST',
    headers: { ...(await authHeaders()), 'Content-Type': 'application/json' },
    body: JSON.stringify({ name: 'ocr.process', payload: { document_id: documentId } }),
  });
  return r.json();
}

export async function listMyDocs() {
  const r = await fetch(`${BASE}/api/v1/documents?limit=20`, {
    headers: { ...(await authHeaders()) },
  });
  if (!r.ok) throw new Error(`List failed (${r.status})`);
  return r.json();
}
