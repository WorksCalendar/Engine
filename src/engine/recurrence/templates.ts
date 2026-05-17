export interface EventTemplateDefaults {
  readonly title?: string;
  readonly durationMinutes?: number;
  readonly allDay?: boolean;
  readonly category?: string;
  readonly resource?: string;
  readonly recurrencePreset?: 'none' | 'daily' | 'weekdays' | 'weekly' | 'monthlyDate' | 'custom';
  readonly rrule?: string;
  readonly color?: string;
  readonly notes?: string;
}

export interface EventTemplate {
  readonly id: string;
  readonly version: number;
  readonly label: string;
  readonly description?: string;
  readonly defaults: EventTemplateDefaults | null;
}

export const BUILT_IN_EVENT_TEMPLATES: readonly EventTemplate[] = [
  { id: 'none', version: 1, label: 'Blank event', defaults: null },
  {
    id: 'dailyStandup',
    version: 1,
    label: 'Daily standup',
    description: '15-minute weekday sync.',
    defaults: {
      title: 'Daily standup',
      durationMinutes: 15,
      recurrencePreset: 'weekdays',
      category: 'Meetings',
    },
  },
  {
    id: 'weekly1on1',
    version: 1,
    label: 'Weekly 1:1',
    defaults: {
      title: 'Weekly 1:1',
      durationMinutes: 30,
      recurrencePreset: 'weekly',
      category: 'Meetings',
    },
  },
  {
    id: 'onCallPrimary',
    version: 1,
    label: 'On-call (Primary)',
    defaults: {
      title: 'Primary on-call',
      durationMinutes: 60,
      recurrencePreset: 'daily',
      category: 'On-call',
      color: '#ef4444',
    },
  },
  {
    id: 'sprintPlanning',
    version: 1,
    label: 'Sprint planning',
    defaults: {
      title: 'Sprint planning',
      durationMinutes: 90,
      recurrencePreset: 'weekly',
      category: 'Planning',
      color: '#2563eb',
    },
  },
  {
    id: 'retrospective',
    version: 1,
    label: 'Team retrospective',
    defaults: {
      title: 'Retrospective',
      durationMinutes: 60,
      recurrencePreset: 'weekly',
      category: 'Planning',
      color: '#7c3aed',
    },
  },
  {
    id: 'monthlyReview',
    version: 1,
    label: 'Monthly review',
    defaults: {
      title: 'Monthly review',
      durationMinutes: 60,
      recurrencePreset: 'monthlyDate',
      category: 'Operations',
    },
  },
  {
    id: 'incidentDrill',
    version: 1,
    label: 'Incident drill',
    defaults: {
      title: 'Incident response drill',
      durationMinutes: 45,
      recurrencePreset: 'monthlyDate',
      category: 'Operations',
      color: '#dc2626',
    },
  },
  {
    id: 'officeHours',
    version: 1,
    label: 'Office hours',
    defaults: {
      title: 'Office hours',
      durationMinutes: 60,
      recurrencePreset: 'weekly',
      category: 'Support',
      color: '#059669',
    },
  },
  {
    id: 'demoDay',
    version: 1,
    label: 'Demo day',
    defaults: {
      title: 'Demo day',
      durationMinutes: 60,
      recurrencePreset: 'weekly',
      category: 'Engineering',
      color: '#0ea5e9',
    },
  },
  {
    id: 'customerFollowup',
    version: 1,
    label: 'Customer follow-up',
    defaults: {
      title: 'Customer follow-up',
      durationMinutes: 30,
      recurrencePreset: 'weekly',
      category: 'Customer Success',
      color: '#f59e0b',
    },
  },
  {
    id: 'releaseWindow',
    version: 1,
    label: 'Release window',
    defaults: {
      title: 'Release window',
      durationMinutes: 120,
      recurrencePreset: 'weekly',
      category: 'Engineering',
      color: '#111827',
    },
  },
];

export function getEventTemplateById(id: string): EventTemplate | null {
  return BUILT_IN_EVENT_TEMPLATES.find((template) => template.id === id) ?? null;
}
