import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { ApiError, api } from '../../src/api/client';
import type { ChatMessage, ChatReply } from '../../src/api/types';
import { plainText } from '../../src/lib/format';
import { t } from '../../src/lib/locale';
import { colors, radius, space, type as typo } from '../../src/theme';

/** What each tool call reads as when the trainer actually did something. */
const TOOL_LABELS: Record<string, () => string> = {
  set_context: () => t('toolSetContext'),
  log_weight: () => t('toolLogWeight'),
  log_set: () => t('toolLogSet'),
  log_session: () => t('toolLogSession'),
  log_meal: () => t('toolLogMeal'),
  log_cardio: () => t('toolLogCardio'),
  swap_exercise: () => t('toolSwapExercise'),
  adjust_calorie_target: () => t('toolAdjustTargets'),
  add_rule: () => t('toolAddRule'),
  deactivate_rule: () => t('toolDeactivateRule'),
  get_today: () => t('toolGetToday'),
  get_history: () => t('toolGetHistory'),
};

export default function ChatScreen() {
  const insets = useSafeAreaInsets();
  const scroller = useRef<ScrollView>(null);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api<{ messages: ChatMessage[] }>('/chat?limit=60');
      setMessages(result.messages);
      setError(null);
    } catch (caught) {
      setError(caught instanceof ApiError ? caught.message : 'Could not reach your trainer');
    } finally {
      setLoaded(true);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function send() {
    const text = draft.trim();
    if (!text || sending) return;

    setDraft('');
    setError(null);
    setSending(true);

    // Optimistic: his own message appears the instant he sends it.
    const pending: ChatMessage = {
      id: -Date.now(),
      role: 'user',
      createdAt: new Date().toISOString(),
      text,
    };
    setMessages((current) => [...current, pending]);

    try {
      const reply = await api<ChatReply>('/chat', {
        method: 'POST',
        body: { text },
        // The trainer may make several tool calls before answering.
        timeoutMs: 120_000,
      });
      setMessages((current) => [
        ...current,
        {
          id: Date.now(),
          role: 'model',
          createdAt: new Date().toISOString(),
          text: reply.text,
          toolCalls: reply.ranTools,
        },
      ]);
    } catch (caught) {
      setMessages((current) => current.filter((message) => message.id !== pending.id));
      setDraft(text);
      setError(
        caught instanceof ApiError && caught.status === 503
          ? 'Your trainer is unreachable right now. Try again in a moment.'
          : caught instanceof ApiError
            ? caught.message
            : 'Something went wrong',
      );
    } finally {
      setSending(false);
    }
  }

  return (
    <KeyboardAvoidingView
      // paddingTop on the container, not the scroll content: the thread should
      // clip below the status bar, not slide under the clock.
      style={[styles.root, { paddingTop: insets.top }]}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={insets.bottom + 49}
    >
      <ScrollView
        ref={scroller}
        contentContainerStyle={[styles.thread, { paddingTop: space.lg }]}
        onContentSizeChange={() => scroller.current?.scrollToEnd({ animated: true })}
        keyboardShouldPersistTaps="handled"
      >
        {!loaded ? (
          <ActivityIndicator color={colors.textFaint} style={{ marginTop: space.xxl }} />
        ) : null}

        {loaded && messages.length === 0 ? (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>Talk to your trainer</Text>
            <Text style={styles.emptyBody}>
              He knows your last two weeks, where you are, and what you have eaten today. Tell him
              how you feel, what you ate, or where you are — he'll change the plan, not just agree
              with you.
            </Text>
          </View>
        ) : null}

        {messages.map((message) => (
          <View
            key={message.id}
            style={[styles.bubble, message.role === 'user' ? styles.mine : styles.theirs]}
          >
            <Text style={message.role === 'user' ? styles.mineText : styles.theirsText}>
              {plainText(message.text)}
            </Text>
            {message.toolCalls?.length ? (
              <Text style={styles.tools}>
                {message.toolCalls
                  .map((call) => TOOL_LABELS[call.name]?.() ?? call.name)
                  .filter((label, index, all) => all.indexOf(label) === index)
                  .join(' · ')}
              </Text>
            ) : null}
          </View>
        ))}

        {sending ? (
          <View style={[styles.bubble, styles.theirs, styles.thinking]}>
            <ActivityIndicator size="small" color={colors.textFaint} />
            <Text style={styles.thinkingText}>{t('thinking')}</Text>
          </View>
        ) : null}
      </ScrollView>

      {error ? <Text style={styles.error}>{error}</Text> : null}

      <View style={[styles.composer, { paddingBottom: space.md }]}>
        <TextInput
          value={draft}
          onChangeText={setDraft}
          placeholder={t('chatPlaceholder')}
          placeholderTextColor={colors.textFaint}
          style={styles.input}
          multiline
          onSubmitEditing={send}
          editable={!sending}
        />
        <Pressable
          onPress={send}
          disabled={!draft.trim() || sending}
          style={({ pressed }) => [
            styles.send,
            (!draft.trim() || sending) && styles.sendDisabled,
            pressed && styles.pressed,
          ]}
        >
          <Text style={styles.sendText}>↑</Text>
        </Pressable>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: colors.bg },
  thread: { paddingHorizontal: space.lg, paddingBottom: space.lg, gap: space.md },

  empty: { gap: space.sm, marginTop: space.xxl },
  emptyTitle: { ...typo.title, color: colors.text },
  emptyBody: { fontSize: 15, color: colors.textDim, lineHeight: 22 },

  bubble: { maxWidth: '86%', borderRadius: radius.lg, paddingVertical: space.md, paddingHorizontal: space.lg },
  // A raised surface, not amber. Amber means "on target" everywhere else in
  // the app, and spending it on every message he sends leaves nothing for the
  // numbers that earned it — two solid amber slabs on one screen shout.
  // `surface` is documented as the colour for things you type into, which is
  // exactly what a sent message is.
  mine: {
    alignSelf: 'flex-end',
    backgroundColor: colors.surfaceHigh,
    borderBottomRightRadius: radius.sm,
  },
  // Filled, not outlined. An outline on the page is a box drawn around
  // nothing; a surface one step lighter is the same object with less ink.
  theirs: {
    alignSelf: 'flex-start',
    backgroundColor: colors.surface,
    borderBottomLeftRadius: radius.sm,
  },
  mineText: { fontSize: 16, color: colors.text, lineHeight: 22 },
  theirsText: { fontSize: 16, color: colors.text, lineHeight: 23 },
  tools: { fontSize: 12, color: colors.accent, marginTop: space.sm, fontWeight: '600' },

  thinking: { flexDirection: 'row', alignItems: 'center', gap: space.sm },
  thinkingText: { fontSize: 14, color: colors.textFaint },

  error: { color: colors.danger, fontSize: 14, paddingHorizontal: space.lg, paddingBottom: space.sm },

  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: space.sm,
    paddingHorizontal: space.lg,
    paddingTop: space.md,
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: colors.border,
    backgroundColor: colors.bg,
  },
  input: {
    flex: 1,
    minHeight: 48,
    maxHeight: 140,
    borderRadius: radius.lg,
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: colors.border,
    backgroundColor: colors.surfaceHigh,
    paddingHorizontal: space.lg,
    paddingTop: 13,
    paddingBottom: 13,
    color: colors.text,
    fontSize: 16,
  },
  send: {
    width: 48,
    height: 48,
    borderRadius: 24,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: colors.accent,
  },
  sendDisabled: { backgroundColor: colors.surfaceHigh },
  pressed: { opacity: 0.7 },
  sendText: { fontSize: 22, fontWeight: '400', color: '#08130C', marginTop: -2 },
});
