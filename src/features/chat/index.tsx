import { MessageSquare } from 'lucide-react';
import { Placeholder } from '@/features/_lib/Placeholder';

export function ChatRoute() {
  return (
    <Placeholder
      titleKey="nav.chat"
      emptyTitleKey="empty.chat.title"
      emptyDescKey="empty.chat.desc"
      icon={MessageSquare}
      phase={1}
    />
  );
}
