import { useRouter } from 'expo-router';
import { Text } from 'react-native';
import { Button } from '../src/components/Button';
import { Screen } from '../src/components/Screen';
import { colors, type as typo } from '../src/theme';

// Replaced by the real logger in the next slice.
export default function WorkoutScreen() {
  const router = useRouter();
  return (
    <Screen>
      <Text style={{ ...typo.title, color: colors.text }}>Workout logger</Text>
      <Button title="Back" variant="secondary" onPress={() => router.back()} />
    </Screen>
  );
}
