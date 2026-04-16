import React, { useState, useRef, useEffect } from 'react';
import { View, Text, TouchableOpacity, StyleSheet, TextInput, ScrollView, Alert, ActivityIndicator } from 'react-native';
import { CameraView, useCameraPermissions } from 'expo-camera';
import * as ImageManipulator from 'expo-image-manipulator';
import { uploadDocument, enqueueOcr } from '../api';
import { parseMrz } from '../mrz';
import { enqueueLocal, flush, pendingCount, startAutoFlush } from '../queue';
import NetInfo from '@react-native-community/netinfo';

const DOC_TYPES = ['passport', 'national_id', 'utility_bill', 'loan_application'];

export default function CaptureScreen({ navigation }) {
  const [permission, requestPermission] = useCameraPermissions();
  const cam = useRef(null);
  const [docType, setDocType] = useState('passport');
  const [cid, setCid] = useState('');
  const [expiry, setExpiry] = useState('');
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState(null);
  const [mrz, setMrz] = useState(null);
  const [online, setOnline] = useState(true);
  const [queueLen, setQueueLen] = useState(0);

  useEffect(() => { if (!permission?.granted) requestPermission(); }, [permission]);
  useEffect(() => {
    const sub = NetInfo.addEventListener((s) => setOnline(!!s.isConnected));
    pendingCount().then(setQueueLen);
    const autoFlush = startAutoFlush(() => pendingCount().then(setQueueLen));
    return () => { sub(); autoFlush?.(); };
  }, []);

  const capture = async () => {
    if (!cam.current) return;
    const photo = await cam.current.takePictureAsync({ quality: 0.85, base64: false });
    const m = await ImageManipulator.manipulateAsync(photo.uri, [{ resize: { width: 1600 } }],
      { compress: 0.8, format: ImageManipulator.SaveFormat.JPEG });
    setPreview(m.uri);
  };

  const submit = async () => {
    if (!preview) return Alert.alert('Capture first');
    setBusy(true);
    const item = {
      uri: preview, name: `mobile-${Date.now()}.jpg`, mime: 'image/jpeg',
      docType, customerCid: cid, expiryDate: expiry,
    };
    try {
      if (!online) {
        const n = await enqueueLocal(item);
        setQueueLen(n);
        Alert.alert('Offline', `Saved locally (${n} pending). Will upload when online.`);
      } else {
        const doc = await uploadDocument(item);
        await enqueueOcr(doc.id);
        Alert.alert('Uploaded', `Doc #${doc.id} queued for OCR`);
      }
      setPreview(null); setCid(''); setExpiry(''); setMrz(null);
    } catch (e) {
      const n = await enqueueLocal(item);
      setQueueLen(n);
      Alert.alert('Queued offline', `${e.message}\nSaved locally (${n} pending).`);
    } finally {
      setBusy(false);
    }
  };

  const parseMrzFromText = (rawText) => {
    const m = parseMrz(rawText);
    if (!m) return;
    setMrz(m);
    if (m.passport_no || m.document_no) setCid((c) => c || (m.passport_no || m.document_no));
    if (m.expiry_date) setExpiry((e) => e || m.expiry_date);
    if (m.kind === 'TD3') setDocType('passport'); else if (m.kind === 'TD1') setDocType('national_id');
  };

  const flushQueue = async () => {
    const r = await flush();
    setQueueLen(r.remaining);
    Alert.alert('Sync', `Uploaded ${r.uploaded} / ${r.attempted}. Remaining: ${r.remaining}.`);
  };

  if (!permission) return <View style={styles.wrap} />;
  if (!permission.granted) {
    return (
      <View style={styles.wrap}>
        <Text style={styles.label}>Camera permission required</Text>
        <TouchableOpacity style={styles.btn} onPress={requestPermission}><Text style={styles.btnText}>Grant</Text></TouchableOpacity>
      </View>
    );
  }

  return (
    <ScrollView style={{ backgroundColor: '#0a1628' }} contentContainerStyle={{ padding: 16 }}>
      <View style={styles.cameraWrap}>
        {preview
          ? <View style={styles.previewBox}><Text style={styles.label}>Captured ✓ — tap Recapture to retake</Text></View>
          : <CameraView ref={cam} style={{ flex: 1 }} facing="back" />}
      </View>

      <View style={styles.row}>
        {preview
          ? <TouchableOpacity style={[styles.btn, styles.flex1]} onPress={() => setPreview(null)}><Text style={styles.btnText}>Recapture</Text></TouchableOpacity>
          : <TouchableOpacity style={[styles.btn, styles.flex1]} onPress={capture}><Text style={styles.btnText}>Capture</Text></TouchableOpacity>}
        <TouchableOpacity style={[styles.btnSec, styles.flex1]} onPress={() => navigation.navigate('Recent')}>
          <Text style={styles.btnSecText}>Recent</Text>
        </TouchableOpacity>
      </View>

      <View style={[styles.row, { marginTop: 8 }]}>
        <View style={[styles.badge, online ? styles.badgeOk : styles.badgeWarn]}>
          <Text style={styles.badgeText}>{online ? 'Online' : 'Offline'}</Text>
        </View>
        {queueLen > 0 && (
          <TouchableOpacity style={styles.btnSec} onPress={flushQueue}>
            <Text style={styles.btnSecText}>Sync {queueLen}</Text>
          </TouchableOpacity>
        )}
      </View>

      {mrz && (
        <View style={styles.mrzBox}>
          <Text style={styles.mrzTitle}>MRZ ({mrz.kind}) {mrz.valid ? '✓' : '⚠'}</Text>
          <Text style={styles.mrzText}>{mrz.surname ? `${mrz.surname} ${mrz.given || ''}` : mrz.name}</Text>
          <Text style={styles.mrzText}>{mrz.passport_no || mrz.document_no} · exp {mrz.expiry_date}</Text>
        </View>
      )}

      <Text style={styles.section}>Metadata</Text>
      <Text style={styles.label}>Document type</Text>
      <View style={styles.chips}>
        {DOC_TYPES.map(t => (
          <TouchableOpacity key={t} style={[styles.chip, docType === t && styles.chipActive]} onPress={() => setDocType(t)}>
            <Text style={[styles.chipText, docType === t && styles.chipTextActive]}>{t}</Text>
          </TouchableOpacity>
        ))}
      </View>

      <Text style={styles.label}>Customer CID</Text>
      <TextInput value={cid} onChangeText={setCid} placeholder="EGY-2024-…" placeholderTextColor="#8da0b8" style={styles.input} autoCapitalize="characters" />

      <Text style={styles.label}>Expiry (YYYY-MM-DD)</Text>
      <TextInput value={expiry} onChangeText={setExpiry} placeholder="2032-01-09" placeholderTextColor="#8da0b8" style={styles.input} />

      <TouchableOpacity style={[styles.btn, { marginTop: 16 }]} onPress={submit} disabled={busy || !preview}>
        {busy ? <ActivityIndicator color="#0a1628" /> : <Text style={styles.btnText}>Submit to DMS</Text>}
      </TouchableOpacity>
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, backgroundColor: '#0a1628', padding: 16 },
  cameraWrap: { height: 320, borderRadius: 12, overflow: 'hidden', backgroundColor: '#000', marginBottom: 12 },
  previewBox: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#0f2044' },
  row: { flexDirection: 'row', gap: 8 },
  flex1: { flex: 1 },
  btn: { backgroundColor: '#c9a84c', padding: 14, borderRadius: 10, alignItems: 'center' },
  btnText: { color: '#0a1628', fontWeight: '700' },
  btnSec: { backgroundColor: '#0f2044', padding: 14, borderRadius: 10, alignItems: 'center', borderWidth: 1, borderColor: '#162d5a' },
  btnSecText: { color: '#e8eef6', fontWeight: '600' },
  section: { color: '#e8c96b', fontSize: 16, fontWeight: '700', marginTop: 24, marginBottom: 8 },
  label: { color: '#8da0b8', fontSize: 12, marginBottom: 4, marginTop: 8, letterSpacing: 0.5 },
  input: { backgroundColor: '#0f2044', color: '#e8eef6', padding: 12, borderRadius: 8, borderWidth: 1, borderColor: '#162d5a' },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  chip: { paddingVertical: 6, paddingHorizontal: 12, borderRadius: 16, backgroundColor: '#0f2044', borderWidth: 1, borderColor: '#162d5a' },
  chipActive: { backgroundColor: 'rgba(201,168,76,0.15)', borderColor: '#c9a84c' },
  chipText: { color: '#8da0b8', fontSize: 12 },
  chipTextActive: { color: '#e8c96b', fontWeight: '600' },
  badge: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 14, alignSelf: 'center' },
  badgeOk: { backgroundColor: 'rgba(60,185,123,0.15)' },
  badgeWarn: { backgroundColor: 'rgba(240,164,64,0.15)' },
  badgeText: { color: '#e8eef6', fontSize: 11, fontWeight: '600' },
  mrzBox: { marginTop: 12, padding: 10, borderRadius: 8, backgroundColor: 'rgba(201,168,76,0.08)', borderWidth: 1, borderColor: 'rgba(201,168,76,0.3)' },
  mrzTitle: { color: '#e8c96b', fontWeight: '700', fontSize: 12, marginBottom: 4 },
  mrzText: { color: '#e8eef6', fontSize: 12 },
});
