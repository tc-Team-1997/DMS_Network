import React, { useState } from 'react';
import { View, Text, TextInput, TouchableOpacity, StyleSheet, Alert, ActivityIndicator } from 'react-native';
import { login } from '../api';

export default function LoginScreen({ navigation }) {
  const [u, setU] = useState('sara.k');
  const [p, setP] = useState('demo');
  const [busy, setBusy] = useState(false);

  const onLogin = async () => {
    setBusy(true);
    try {
      const r = await login(u, p);
      navigation.replace('Capture', { user: r });
    } catch (e) {
      Alert.alert('Login failed', e.message);
    } finally {
      setBusy(false);
    }
  };

  return (
    <View style={styles.wrap}>
      <Text style={styles.title}>National Bank of Egypt</Text>
      <Text style={styles.sub}>Document Management — Mobile Capture</Text>
      <TextInput value={u} onChangeText={setU} placeholder="Username" placeholderTextColor="#8da0b8" style={styles.input} autoCapitalize="none" />
      <TextInput value={p} onChangeText={setP} placeholder="Password" placeholderTextColor="#8da0b8" style={styles.input} secureTextEntry />
      <TouchableOpacity style={styles.btn} onPress={onLogin} disabled={busy}>
        {busy ? <ActivityIndicator color="#0a1628" /> : <Text style={styles.btnText}>Sign in</Text>}
      </TouchableOpacity>
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1, padding: 24, justifyContent: 'center', backgroundColor: '#0a1628' },
  title: { fontSize: 26, color: '#e8c96b', fontWeight: '700', textAlign: 'center' },
  sub: { color: '#8da0b8', textAlign: 'center', marginBottom: 32, marginTop: 4, fontSize: 12, letterSpacing: 1 },
  input: { backgroundColor: '#0f2044', color: '#e8eef6', padding: 14, borderRadius: 10, marginBottom: 12, borderWidth: 1, borderColor: '#162d5a' },
  btn: { backgroundColor: '#c9a84c', padding: 14, borderRadius: 10, alignItems: 'center', marginTop: 8 },
  btnText: { color: '#0a1628', fontWeight: '700', letterSpacing: 0.5 },
});
