import { PlaceholderScreen } from '@/components/layout/PlaceholderScreen';
import { ThemeToggle } from '@/screens/Settings/_dev/ThemeToggle';

export default function SettingsScreen() {
  return (
    <div className="mx-auto max-w-2xl">
      <PlaceholderScreen id="settings" />
      <ThemeToggle />
    </div>
  );
}
