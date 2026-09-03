import { SymbolView, type SymbolViewProps } from 'expo-symbols';
import { Platform, StyleSheet, Text, View } from 'react-native';
import { colors } from '../theme';

/**
 * A tab icon, as a real SF Symbol.
 *
 * The bar used to be four words in spaced small caps, which is a poor target
 * and a poorer glance: at 10pt, HEUTE and GEWICHT are the same shape from
 * across a gym. Symbols are recognised before they are read, and iOS already
 * ships the vocabulary — weight, fill and optical size all match the platform
 * for free.
 *
 * Android falls back to the label alone rather than to a lookalike icon set.
 * There is no Android build, and a wrong icon is worse than none.
 */
export function TabIcon({
  name,
  focused,
  fallback,
}: {
  name: SymbolViewProps['name'];
  focused: boolean;
  /** One character, for platforms without SF Symbols. */
  fallback: string;
}) {
  const tint = focused ? colors.accent : colors.textFaint;

  if (Platform.OS !== 'ios') {
    return (
      <View style={styles.box}>
        <Text style={[styles.fallback, { color: tint }]}>{fallback}</Text>
      </View>
    );
  }

  return (
    <View style={styles.box}>
      <SymbolView
        name={name}
        tintColor={tint}
        // Filled when selected: the weight change reads at a glance where a
        // colour change alone does not, and it matches every other iOS bar.
        type="hierarchical"
        size={25}
        resizeMode="scaleAspectFit"
      />
    </View>
  );
}

const styles = StyleSheet.create({
  box: { width: 30, height: 28, alignItems: 'center', justifyContent: 'center' },
  fallback: { fontSize: 17, fontWeight: '600' },
});
