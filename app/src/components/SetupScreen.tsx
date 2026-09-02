import { useState } from 'react';
import { KeyboardAvoidingView, Platform, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { api } from '../api/client';
import { saveConfig } from '../api/config';
import { Button } from './Button';
import { colors, radius, space, type as typo } from '../theme';

/**
 * Shown once, on a fresh install, because the token is not in the bundle.
 * Verifies the pair actually works before storing it — a typo'd token that
 * only fails later, mid-workout, would be worse than no setup screen at all.
 */
export function SetupScreen({ onDone }: { onDone: () => void }) {
  const insets = useSafeAreaInsets();
  const [url, setUrl] = useState('https://');
  const [token, setToken] = useState('');
  const [checking, setChecking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function connect() {
    setChecking(true);
    setError(null);
    try {
      await saveConfig(url, token);
      // Any authenticated route will do; /profile is the cheapest.
      await api('/profile', { timeoutMs: 15_000 });
      onDone();
    } catch (caught) {
      const status = (caught as { status?: number }).status;
      setError(
        status === 401
          ? 'That token was rejected. Check it matches APP_BEARER_TOKEN on the server.'
          : status === 0
            ? 'Could not reach that address. Check the URL and that the server is up.'
            : `Something went wrong (${status ?? '?'}).`,
      );
    } finally {
      setChecking(false);
    }
  }

  return (
    <KeyboardAvoidingView
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView contentContainerStyle={styles.content} keyboardShouldPersistTaps="handled">
        <Text style={styles.title}>Connect to your backend</Text>
        <Text style={styles.body}>
          One time only. The token is stored in the iOS keychain, not in the app, so it never
          travels inside the build.
        </Text>

        <View style={styles.field}>
          <Text style={styles.label}>SERVER URL</Text>
          <TextInput
            value={url}
            onChangeText={setUrl}
            placeholder="https://lockin-api.fly.dev"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            keyboardType="url"
            style={styles.input}
          />
        </View>

        <View style={styles.field}>
          <Text style={styles.label}>BEARER TOKEN</Text>
          <TextInput
            value={token}
            onChangeText={setToken}
            placeholder="APP_BEARER_TOKEN from the server"
            placeholderTextColor={colors.textFaint}
            autoCapitalize="none"
            autoCorrect={false}
            secureTextEntry
            style={styles.input}
          />
        </View>

        {error ? <Text style={styles.error}>{error}</Text> : null}

        <Button
          title={checking ? 'Checking…' : 'Connect'}
          onPress={connect}
          disabled={checking || !token.trim() || !url.startsWith('http')}
        />
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  content: { padding: space.lg, gap: space.lg, paddingTop: space.xxl },
  title: { fontSize: 26, fontWeight: '300', color: colors.text, letterSpacing: -0.5 },
  body: { fontSize: 15, color: colors.textDim, lineHeight: 22 },
  field: { gap: space.sm },
  label: { ...typo.label, color: colors.textFaint },
  input: {
    minHeight: 52,
    borderRadius: radius.md,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.bg,
    paddingHorizontal: space.lg,
    color: colors.text,
    fontSize: 16,
  },
  error: { color: colors.danger, fontSize: 14, lineHeight: 20 },
});
