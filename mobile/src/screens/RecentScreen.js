import React, { useEffect, useState, useCallback } from 'react';
import { View, Text, FlatList, StyleSheet, RefreshControl, ActivityIndicator } from 'react-native';
import { listMyDocs } from '../api';

export default function RecentScreen() {
  const [docs, setDocs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);

  const load = useCallback(async () => {
    try { setDocs(await listMyDocs()); } catch (e) {} finally { setLoading(false); setRefreshing(false); }
  }, []);

  useEffect(() => { load(); }, [load]);

  if (loading) return <View style={styles.center}><ActivityIndicator color="#c9a84c" /></View>;

  return (
    <FlatList
      style={{ backgroundColor: '#0a1628' }}
      contentContainerStyle={{ padding: 12 }}
      data={docs}
      keyExtractor={(d) => String(d.id)}
      refreshControl={<RefreshControl tintColor="#c9a84c" refreshing={refreshing} onRefresh={() => { setRefreshing(true); load(); }} />}
      ListEmptyComponent={<Text style={styles.empty}>No documents uploaded yet.</Text>}
      renderItem={({ item }) => (
        <View style={styles.card}>
          <Text style={styles.name}>#{item.id} {item.original_name}</Text>
          <Text style={styles.meta}>{item.doc_type || '—'} · {item.customer_cid || '—'}</Text>
          <View style={styles.row}>
            <Text style={[styles.tag, statusStyle(item.status)]}>{item.status}</Text>
            {item.expiry_date ? <Text style={styles.meta}>exp {item.expiry_date}</Text> : null}
          </View>
        </View>
      )}
    />
  );
}

function statusStyle(s) {
  if (s === 'archived' || s === 'indexed') return { color: '#3cb97b', borderColor: 'rgba(60,185,123,0.3)' };
  if (s === 'rejected') return { color: '#e05c5c', borderColor: 'rgba(224,92,92,0.3)' };
  if (s === 'review') return { color: '#f0a440', borderColor: 'rgba(240,164,64,0.3)' };
  return { color: '#4a9fd4', borderColor: 'rgba(74,159,212,0.3)' };
}

const styles = StyleSheet.create({
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0a1628' },
  empty: { color: '#8da0b8', textAlign: 'center', marginTop: 48 },
  card: { backgroundColor: '#0f2044', padding: 14, borderRadius: 10, marginBottom: 8, borderWidth: 1, borderColor: '#162d5a' },
  name: { color: '#e8eef6', fontWeight: '600', marginBottom: 4 },
  meta: { color: '#8da0b8', fontSize: 12 },
  row: { flexDirection: 'row', justifyContent: 'space-between', marginTop: 8, alignItems: 'center' },
  tag: { paddingVertical: 2, paddingHorizontal: 8, borderRadius: 12, fontSize: 11, fontWeight: '600', borderWidth: 1 },
});
