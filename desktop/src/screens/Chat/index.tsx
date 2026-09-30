import { Avatar } from '@/components/brand/Avatar';
import { PlaceholderScreen } from '@/components/layout/PlaceholderScreen';

export default function ChatScreen() {
  return (
    <div className="flex flex-col items-center">
      <Avatar size="lg" state="idle" className="mt-16" />
      <PlaceholderScreen id="chat" />
    </div>
  );
}
