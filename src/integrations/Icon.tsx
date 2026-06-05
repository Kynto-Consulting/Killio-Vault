import {
  Calendar,
  CalendarDays,
  CircleDollarSign,
  Cloud,
  Contact,
  CreditCard,
  FileText,
  Github,
  HardDrive,
  ListChecks,
  ListTodo,
  Mail,
  MapPin,
  MessageCircle,
  Music,
  Puzzle,
  Slack,
  Trello,
  Workflow,
  type LucideIcon,
} from 'lucide-react-native';

/**
 * Renders a catalog integration icon using lucide-react-native — the same icon
 * set the web frontend uses (matched by kebab-case name).
 */
const MAP: Record<string, LucideIcon> = {
  calendar: Calendar,
  'calendar-days': CalendarDays,
  contact: Contact,
  'map-pin': MapPin,
  github: Github,
  'hard-drive': HardDrive,
  cloud: Cloud,
  'file-text': FileText,
  trello: Trello,
  slack: Slack,
  'message-circle': MessageCircle,
  'credit-card': CreditCard,
  'circle-dollar-sign': CircleDollarSign,
  mail: Mail,
  music: Music,
  'list-checks': ListChecks,
  'list-todo': ListTodo,
  workflow: Workflow,
};

export function IntegrationIcon({
  name,
  color,
  size = 20,
}: {
  name: string;
  color: string;
  size?: number;
}) {
  const Cmp = MAP[name] ?? Puzzle;
  return <Cmp color={color} size={size} />;
}
