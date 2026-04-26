import { MessageSquare, Sparkles, User } from 'lucide-react';

import { Icon } from '@/components/ui/icon';

export function RoleIcon({ role }: { role: string }) {
  if (role === 'user') {
    return <Icon icon={User} size="md" className="mt-0.5 flex-none text-fg-subtle" />;
  }
  if (role === 'assistant') {
    return <Icon icon={Sparkles} size="md" className="mt-0.5 flex-none text-gold-500" />;
  }
  return <Icon icon={MessageSquare} size="md" className="mt-0.5 flex-none text-fg-subtle" />;
}
