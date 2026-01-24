import React, { useCallback, useEffect, useMemo, useState } from 'react';

type Credentials = { password: string };

type ScheduledTask = {
  id: string;
  name: string;
  type: string;
  schedule: { runAt: string; timezone: string };
  enabled: boolean;
  createdAt: string;
  status?: 'open' | 'done';
  completedAt?: string | null;
  lastRun?: string;
  nextRun?: string | null;
  runAttempts?: number;
  lastError?: string;
  payload?: {
    tripId?: string;
    subject?: string;
    body?: string;
    deadlineDate?: string;
  };
};

type Trip = { id: string; name: string };

type TaskStatus = 'open' | 'done';

type TaskItem = {
  id: string;
  source: 'reminder' | 'itinerary';
  tripId: string | null;
  title: string;
  subtitle?: string;
  status: TaskStatus;
  createdAt?: string;
  completedAt?: string | null;
  line?: number;
  reminder?: {
    enabled: boolean;
    runAt?: string | null;
    timezone?: string;
    lastRun?: string;
    deadlineDate?: string;
    body?: string;
    lastError?: string;
  };
};

type TasksPaneProps = {
  credentials: Credentials | null;
  trips: Trip[];
  activeTripId: string | null;
  itineraryMarkdown: string;
  refreshToken?: number;
  onRefreshItinerary: () => void;
  onCollapse?: () => void;
};

const CollapseIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M13 5l7 7-7 7M6 5l7 7-7 7" />
  </svg>
);

const RefreshIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M23 4v6h-6M1 20v-6h6M3.51 9a9 9 0 0 1 14.85-3.36L23 10M1 14l4.64 4.36A9 9 0 0 0 20.49 15" />
  </svg>
);

const TrashIcon = () => (
  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M3 6h18M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2m3 0v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6h14z" />
  </svg>
);

const BellIcon = ({ enabled }: { enabled: boolean }) => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill={enabled ? "currentColor" : "none"} stroke="currentColor" strokeWidth="2">
    <path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9" />
    <path d="M13.73 21a2 2 0 0 1-3.46 0" />
  </svg>
);

const CheckIcon = () => (
  <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
    <path d="M20 6L9 17l-5-5" />
  </svg>
);

function authHeader(credentials: Credentials | null): string | null {
  if (!credentials?.password) return null;
  return `Basic ${btoa(`user:${credentials.password}`)}`;
}

function withAuthToken(url: string, credentials: Credentials | null): string {
  if (credentials?.password) return url;
  if (typeof window === 'undefined') return url;
  try {
    const current = new URL(window.location.href);
    const token = current.searchParams.get('token');
    if (!token) return url;
    const resolved = new URL(url, window.location.origin);
    if (!resolved.searchParams.has('token')) {
      resolved.searchParams.set('token', token);
    }
    return resolved.pathname + resolved.search;
  } catch {
    return url;
  }
}

async function apiFetch<T>(
  url: string,
  opts: RequestInit,
  credentials: Credentials | null
): Promise<{ ok: true; data: T } | { ok: false; status: number; error: string }> {
  const headers = new Headers(opts.headers || {});
  const auth = authHeader(credentials);
  if (auth) headers.set('Authorization', auth);
  if (!headers.has('Content-Type') && opts.body && !(opts.body instanceof FormData)) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(url, { ...opts, headers });
  const contentType = res.headers.get('content-type') || '';
  const isJson = contentType.includes('application/json');
  if (!res.ok) {
    const text = isJson ? JSON.stringify(await res.json().catch(() => ({}))) : await res.text().catch(() => '');
    return { ok: false, status: res.status, error: text || res.statusText };
  }
  if (isJson) return { ok: true, data: await res.json() as T };
  return { ok: true, data: await res.text() as T };
}

function formatDateTime(value: string | null | undefined, timezone?: string): string {
  if (!value) return 'TBD';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  try {
    if (timezone) {
      return new Intl.DateTimeFormat('en-US', {
        dateStyle: 'medium',
        timeStyle: 'short',
        timeZone: timezone,
      }).format(date);
    }
  } catch {
    // Ignore timezone failures
  }
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeStyle: 'short' }).format(date);
}

function parseDateValue(value: string): Date | null {
  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    const [year, month, day] = value.split('-').map((part) => Number(part));
    if (!year || !month || !day) return null;
    return new Date(year, month - 1, day);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed;
}

function formatDate(value: string | null | undefined): string {
  if (!value) return 'TBD';
  const date = parseDateValue(value);
  if (!date) return value;
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium' }).format(date);
}

function normalizeTodoText(text: string): string {
  return text
    .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1')
    .replace(/[*_`]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function parseItineraryTodos(markdown: string): { line: number; text: string; checked: boolean }[] {
  if (!markdown) return [];
  const lines = markdown.split('\n');
  const todos: { line: number; text: string; checked: boolean }[] = [];
  const todoRegex = /^\s*(?:[-*+]|\d+\.)\s+\[([ xX])\]\s+(.+)$/;
  for (let i = 0; i < lines.length; i += 1) {
    const match = lines[i].match(todoRegex);
    if (!match) continue;
    const checked = match[1].toLowerCase() === 'x';
    todos.push({ line: i + 1, text: match[2].trim(), checked });
  }
  return todos;
}

function parseDateTime(value?: string | null): number | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : time;
}

function compareTasksWithStatus(a: TaskItem, b: TaskItem, statusA: TaskStatus, statusB: TaskStatus): number {
  if (statusA !== statusB) return statusA === 'open' ? -1 : 1;

  if (statusA === 'open') {
    const aDue = parseDateTime(a.reminder?.runAt ?? null);
    const bDue = parseDateTime(b.reminder?.runAt ?? null);
    if (aDue !== null && bDue !== null && aDue !== bDue) return aDue - bDue;
    if (aDue !== null && bDue === null) return -1;
    if (aDue === null && bDue !== null) return 1;

    const aCreated = parseDateTime(a.createdAt ?? null);
    const bCreated = parseDateTime(b.createdAt ?? null);
    if (aCreated !== null && bCreated !== null && aCreated !== bCreated) return bCreated - aCreated;
    if (aCreated !== null && bCreated === null) return -1;
    if (aCreated === null && bCreated !== null) return 1;

    if (a.line && b.line && a.line !== b.line) return a.line - b.line;
  }

  const aDone = parseDateTime(a.completedAt ?? a.reminder?.lastRun ?? null);
  const bDone = parseDateTime(b.completedAt ?? b.reminder?.lastRun ?? null);
  if (aDone !== null && bDone !== null && aDone !== bDone) return bDone - aDone;

  return a.title.localeCompare(b.title);
}

export const TasksPane = React.memo(function TasksPane({
  credentials,
  trips,
  activeTripId,
  itineraryMarkdown,
  refreshToken,
  onRefreshItinerary,
  onCollapse,
}: TasksPaneProps) {
  const [scheduledTasks, setScheduledTasks] = useState<ScheduledTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<'all' | 'trip'>('all');
  const [statusFilter, setStatusFilter] = useState<'open' | 'done' | 'all'>('open');
  const [deferredDoneIds, setDeferredDoneIds] = useState<Set<string>>(new Set());
  const [justCompletedIds, setJustCompletedIds] = useState<Set<string>>(new Set());

  useEffect(() => {
    if (!activeTripId) {
      setScope('all');
    }
  }, [activeTripId]);

  const refresh = useCallback(async () => {
    if (!credentials && typeof window === 'undefined') return;
    setIsLoading(true);
    setError(null);
    const params = scope === 'trip' && activeTripId ? `?tripId=${encodeURIComponent(activeTripId)}` : '';
    const url = withAuthToken(`/api/scheduler/tasks${params}`, credentials);
    const res = await apiFetch<ScheduledTask[]>(url, { method: 'GET' }, credentials);
    if (!res.ok) {
      setError(res.error || 'Failed to load tasks.');
      setIsLoading(false);
      return;
    }
    setScheduledTasks(res.data);
    setDeferredDoneIds(new Set());
    setJustCompletedIds(new Set());
    setIsLoading(false);
  }, [credentials, scope, activeTripId]);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  useEffect(() => {
    if (!refreshToken) return;
    void refresh();
  }, [refreshToken, refresh]);

  const tripNameById = useMemo(() => {
    return new Map(trips.map((trip) => [trip.id, trip.name]));
  }, [trips]);

  const itineraryTasks = useMemo<TaskItem[]>(() => {
    if (!activeTripId || !itineraryMarkdown) return [];
    return parseItineraryTodos(itineraryMarkdown).map((todo) => ({
      id: `itinerary:${activeTripId}:${todo.line}`,
      source: 'itinerary',
      tripId: activeTripId,
      title: normalizeTodoText(todo.text),
      status: todo.checked ? 'done' : 'open',
      line: todo.line,
    }));
  }, [activeTripId, itineraryMarkdown]);

  const scheduledItems = useMemo<TaskItem[]>(() => {
    return scheduledTasks.map((task) => {
      const status: TaskStatus = task.status === 'done' || task.completedAt ? 'done' : 'open';
      return {
        id: task.id,
        source: 'reminder',
        tripId: task.payload?.tripId ?? 'unassigned',
        title: task.name || task.payload?.subject || 'Task',
        subtitle: task.payload?.subject && task.payload.subject !== task.name ? task.payload.subject : undefined,
        status,
        createdAt: task.createdAt,
        completedAt: task.completedAt ?? null,
        reminder: {
          enabled: task.enabled,
          runAt: task.nextRun || task.schedule?.runAt,
          timezone: task.schedule?.timezone,
          lastRun: task.lastRun,
          deadlineDate: task.payload?.deadlineDate,
          body: task.payload?.body,
          lastError: task.lastError,
        },
      };
    });
  }, [scheduledTasks]);

  const scopedTasks = useMemo(() => {
    const allTasks = [...scheduledItems, ...itineraryTasks];
    if (scope === 'trip' && activeTripId) {
      return allTasks.filter((task) => task.tripId === activeTripId);
    }
    return allTasks;
  }, [activeTripId, itineraryTasks, scheduledItems, scope]);

  const taskCounts = useMemo(() => {
    let open = 0;
    let done = 0;
    for (const task of scopedTasks) {
      const listStatus = deferredDoneIds.has(task.id) ? 'open' : task.status;
      if (listStatus === 'done') done += 1;
      else open += 1;
    }
    return { open, done, total: scopedTasks.length };
  }, [scopedTasks, deferredDoneIds]);

  const filteredTasks = useMemo(() => {
    if (statusFilter === 'all') return scopedTasks;
    return scopedTasks.filter((task) => {
      const listStatus = deferredDoneIds.has(task.id) ? 'open' : task.status;
      return listStatus === statusFilter;
    });
  }, [scopedTasks, statusFilter, deferredDoneIds]);

  const groupedTasks = useMemo(() => {
    const groups: Record<string, TaskItem[]> = {};
    for (const task of filteredTasks) {
      const tripKey = task.tripId || 'unassigned';
      if (!groups[tripKey]) groups[tripKey] = [];
      groups[tripKey].push(task);
    }
    for (const group of Object.values(groups)) {
      group.sort((a, b) => {
        const statusA = deferredDoneIds.has(a.id) ? 'open' : a.status;
        const statusB = deferredDoneIds.has(b.id) ? 'open' : b.status;
        return compareTasksWithStatus(a, b, statusA, statusB);
      });
    }
    return Object.entries(groups).sort(([aId], [bId]) => {
      const aName = tripNameById.get(aId) || aId;
      const bName = tripNameById.get(bId) || bId;
      return aName.localeCompare(bName);
    });
  }, [filteredTasks, tripNameById, deferredDoneIds]);

  const handleToggleReminder = async (task: TaskItem) => {
    if (!credentials) return;
    if (task.source !== 'reminder') return;
    const res = await apiFetch<ScheduledTask>(
      withAuthToken(`/api/scheduler/tasks/${task.id}`, credentials),
      { method: 'PATCH', body: JSON.stringify({ enabled: !task.reminder?.enabled }) },
      credentials
    );
    if (!res.ok) {
      setError(res.error || 'Unable to update reminder.');
      return;
    }
    setScheduledTasks((prev) => prev.map((item) => (item.id === task.id ? res.data : item)));
  };

  const handleDelete = async (task: TaskItem) => {
    if (!credentials) return;
    if (task.source !== 'reminder') return;
    const confirmed = window.confirm(`Delete task "${task.title}"?`);
    if (!confirmed) return;
    const res = await apiFetch(
      withAuthToken(`/api/scheduler/tasks/${task.id}`, credentials),
      { method: 'DELETE' },
      credentials
    );
    if (!res.ok) {
      setError(res.error || 'Unable to delete task.');
      return;
    }
    setScheduledTasks((prev) => prev.filter((item) => item.id !== task.id));
  };

  const handleToggleDone = async (task: TaskItem, displayStatus: TaskStatus) => {
    const wasDeferred = deferredDoneIds.has(task.id);
    if (task.source === 'itinerary') {
      if (!activeTripId || !credentials || !task.line) return;
      const wasDone = displayStatus === 'done';
      const nextStatus: TaskStatus = wasDone ? 'open' : 'done';
      setDeferredDoneIds((prev) => {
        const next = new Set(prev);
        if (nextStatus === 'done') next.add(task.id);
        else next.delete(task.id);
        return next;
      });
      if (nextStatus === 'done') {
        setJustCompletedIds((prev) => {
          const next = new Set(prev);
          next.add(task.id);
          return next;
        });
        if (typeof window !== 'undefined') {
          window.setTimeout(() => {
            setJustCompletedIds((prev) => {
              const next = new Set(prev);
              next.delete(task.id);
              return next;
            });
          }, 550);
        }
      }
      const url = withAuthToken(`/api/trips/${activeTripId}/itinerary/toggle-todo`, credentials);
      const res = await apiFetch(url, { method: 'POST', body: JSON.stringify({ line: task.line }) }, credentials);
      if (!res.ok) {
        setDeferredDoneIds((prev) => {
          const next = new Set(prev);
          if (wasDeferred) next.add(task.id);
          else next.delete(task.id);
          return next;
        });
        setJustCompletedIds((prev) => {
          const next = new Set(prev);
          next.delete(task.id);
          return next;
        });
        setError(res.error || 'Unable to update itinerary task.');
        return;
      }
      onRefreshItinerary();
      return;
    }

    if (!credentials) return;
    const nextStatus: TaskStatus = displayStatus === 'done' ? 'open' : 'done';
    setDeferredDoneIds((prev) => {
      const next = new Set(prev);
      if (nextStatus === 'done') next.add(task.id);
      else next.delete(task.id);
      return next;
    });
    if (nextStatus === 'done') {
      setJustCompletedIds((prev) => {
        const next = new Set(prev);
        next.add(task.id);
        return next;
      });
      if (typeof window !== 'undefined') {
        window.setTimeout(() => {
          setJustCompletedIds((prev) => {
            const next = new Set(prev);
            next.delete(task.id);
            return next;
          });
        }, 550);
      }
    }
    const patch: Record<string, any> = { status: nextStatus };
    if (nextStatus === 'done') {
      patch.completedAt = new Date().toISOString();
      patch.enabled = false;
    } else {
      patch.completedAt = null;
    }
    const res = await apiFetch<ScheduledTask>(
      withAuthToken(`/api/scheduler/tasks/${task.id}`, credentials),
      { method: 'PATCH', body: JSON.stringify(patch) },
      credentials
    );
    if (!res.ok) {
      setDeferredDoneIds((prev) => {
        const next = new Set(prev);
        if (wasDeferred) next.add(task.id);
        else next.delete(task.id);
        return next;
      });
      setJustCompletedIds((prev) => {
        const next = new Set(prev);
        next.delete(task.id);
        return next;
      });
      setError(res.error || 'Unable to update task.');
      return;
    }
    setScheduledTasks((prev) => prev.map((item) => (item.id === task.id ? res.data : item)));
  };

  const hasTasks = filteredTasks.length > 0;
  const hasAnyTasks = taskCounts.total > 0;
  const emptyTitle = statusFilter === 'open'
    ? 'No open tasks'
    : statusFilter === 'done'
      ? 'No completed tasks'
      : 'No tasks yet';
  const emptyHint = !hasAnyTasks
    ? 'Add reminders or TODOs in the itinerary to see them here.'
    : statusFilter === 'open'
      ? 'Switch to Done to review completed items.'
      : 'Open tasks will appear here once completed.';

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 py-3 flex items-center justify-between gap-3" style={{ borderColor: 'hsl(var(--border-subtle))' }}>
        <div className="flex items-center gap-3 min-w-0">
          {onCollapse && (
            <button
              type="button"
              className="itinerary-collapse-btn"
              onClick={onCollapse}
              title="Collapse tasks"
            >
              <CollapseIcon />
            </button>
          )}
          <div className="min-w-0">
            <div className="mono-label" style={{ color: 'hsl(var(--text-tertiary))' }}>Tasks</div>
            <div className="text-xs mt-1" style={{ color: 'hsl(var(--text-tertiary))' }}>
              Reminders + itinerary to-dos, kept until you mark them done
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2 flex-wrap justify-end">
          {activeTripId && (
            <div className="tasks-scope">
              <button
                type="button"
                className={`tasks-scope-btn ${scope === 'all' ? 'active' : ''}`}
                onClick={() => setScope('all')}
              >
                All trips
              </button>
              <button
                type="button"
                className={`tasks-scope-btn ${scope === 'trip' ? 'active' : ''}`}
                onClick={() => setScope('trip')}
              >
                This trip
              </button>
            </div>
          )}
          <div className="tasks-status">
            <button
              type="button"
              className={`tasks-scope-btn ${statusFilter === 'open' ? 'active' : ''}`}
              onClick={() => setStatusFilter('open')}
            >
              Open ({taskCounts.open})
            </button>
            <button
              type="button"
              className={`tasks-scope-btn ${statusFilter === 'done' ? 'active' : ''}`}
              onClick={() => setStatusFilter('done')}
            >
              Done ({taskCounts.done})
            </button>
            <button
              type="button"
              className={`tasks-scope-btn ${statusFilter === 'all' ? 'active' : ''}`}
              onClick={() => setStatusFilter('all')}
            >
              All ({taskCounts.total})
            </button>
          </div>
          <button type="button" className="icon-btn" onClick={refresh} disabled={isLoading} title="Refresh tasks">
            <RefreshIcon />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {error && (
          <div className="tasks-error">{error}</div>
        )}
        {!hasTasks && !isLoading && (
          <div className="tasks-empty">
            <div className="mono-label" style={{ color: 'hsl(var(--text-tertiary))' }}>{emptyTitle}</div>
            <p className="text-sm mt-2" style={{ color: 'hsl(var(--text-secondary))' }}>
              {emptyHint}
            </p>
          </div>
        )}
        {isLoading && (
          <div className="tasks-loading">Loading tasks…</div>
        )}
        {hasTasks && groupedTasks.map(([tripId, group]) => (
          <div key={tripId} className="tasks-group">
            {scope === 'all' && (
              <div className="tasks-group-title">
                {tripNameById.get(tripId) || (tripId === 'unassigned' ? 'Unassigned' : tripId)}
              </div>
            )}
            <div className="tasks-list">
              {group.map((task) => {
                const reminderLabel = task.reminder?.runAt
                  ? formatDateTime(task.reminder.runAt, task.reminder.timezone)
                  : null;
                const deadlineLabel = task.reminder?.deadlineDate
                  ? formatDate(task.reminder.deadlineDate)
                  : null;
                const completedValue = task.completedAt ?? task.reminder?.lastRun ?? null;
                const completedLabel = task.status === 'done' && completedValue
                  ? formatDateTime(completedValue)
                  : null;
                const isReminder = task.source === 'reminder';
                const reminderEnabled = task.reminder?.enabled ?? false;
                const isDeferredDone = deferredDoneIds.has(task.id);
                const displayStatus: TaskStatus = isDeferredDone ? 'done' : task.status;
                const showDoneAnimation = justCompletedIds.has(task.id);
                const reminderSent = Boolean(task.reminder?.lastRun);
                return (
                  <div
                    key={task.id}
                    className={`task-card ${displayStatus === 'done' ? 'done' : ''} ${showDoneAnimation ? 'just-done' : ''}`.trim()}
                  >
                    <div className="task-check">
                      <button
                        type="button"
                        className={`icon-btn task-check-btn ${displayStatus === 'done' ? 'is-done' : ''}`}
                        onClick={() => handleToggleDone(task, displayStatus)}
                        title={displayStatus === 'done' ? 'Mark as open' : 'Mark as done'}
                      >
                        <CheckIcon />
                      </button>
                    </div>
                    <div className="task-main">
                      <div className="task-title">
                        {task.title}
                      </div>
                      {task.subtitle && (
                        <div className="task-subtitle">{task.subtitle}</div>
                      )}
                      <div className="task-meta">
                        <span className="task-meta-tag">
                          {task.source === 'itinerary' ? 'Itinerary' : 'Reminder'}
                        </span>
                        {reminderSent && (
                          <span className="task-meta-tag task-meta-tag-muted">Reminder sent</span>
                        )}
                        {isReminder && !reminderEnabled && <span className="task-meta-muted">Reminder off</span>}
                        {displayStatus === 'done' && <span>Completed{completedLabel ? `: ${completedLabel}` : ''}</span>}
                        {displayStatus === 'open' && reminderLabel && <span>Reminder: {reminderLabel}</span>}
                        {task.reminder?.timezone && <span className="task-meta-muted">({task.reminder.timezone})</span>}
                      </div>
                      {deadlineLabel && (
                        <div className="task-meta">Deadline: {deadlineLabel}</div>
                      )}
                      {task.reminder?.lastRun && displayStatus === 'open' && (
                        <div className="task-meta">Last sent: {formatDateTime(task.reminder.lastRun)}</div>
                      )}
                      {task.reminder?.lastError && (
                        <div className="task-error">Last error: {task.reminder.lastError}</div>
                      )}
                      {task.reminder?.body && (
                        <div className="task-body">{task.reminder.body}</div>
                      )}
                    </div>
                    {isReminder && (
                      <div className="task-actions">
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => handleToggleReminder(task)}
                          title={reminderEnabled ? 'Disable reminder' : 'Enable reminder'}
                        >
                          <BellIcon enabled={reminderEnabled} />
                        </button>
                        <button
                          type="button"
                          className="icon-btn"
                          onClick={() => handleDelete(task)}
                          title="Delete task"
                        >
                          <TrashIcon />
                        </button>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
});
