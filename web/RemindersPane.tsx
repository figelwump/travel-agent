import React, { useCallback, useEffect, useMemo, useState } from 'react';

type Credentials = { password: string };

type ScheduledTask = {
  id: string;
  name: string;
  type: string;
  schedule: { runAt: string; timezone: string };
  enabled: boolean;
  createdAt: string;
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

type RemindersPaneProps = {
  credentials: Credentials | null;
  trips: Trip[];
  activeTripId: string | null;
  refreshToken?: number;
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

function authHeader(credentials: Credentials | null): string | null {
  if (!credentials?.password) return null;
  return `Basic ${btoa(`user:${credentials.password}`)}`;
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

export function RemindersPane({ credentials, trips, activeTripId, refreshToken, onCollapse }: RemindersPaneProps) {
  const [tasks, setTasks] = useState<ScheduledTask[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [scope, setScope] = useState<'all' | 'trip'>('all');

  useEffect(() => {
    if (!activeTripId) {
      setScope('all');
    }
  }, [activeTripId]);

  const refresh = useCallback(async () => {
    if (!credentials) return;
    setIsLoading(true);
    setError(null);
    const params = scope === 'trip' && activeTripId ? `?tripId=${encodeURIComponent(activeTripId)}` : '';
    const res = await apiFetch<ScheduledTask[]>(`/api/scheduler/tasks${params}`, { method: 'GET' }, credentials);
    if (!res.ok) {
      setError(res.error || 'Failed to load reminders.');
      setIsLoading(false);
      return;
    }
    setTasks(res.data);
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

  const groupedTasks = useMemo(() => {
    const groups: Record<string, ScheduledTask[]> = {};
    for (const task of tasks) {
      const tripKey = task.payload?.tripId || 'unassigned';
      if (!groups[tripKey]) groups[tripKey] = [];
      groups[tripKey].push(task);
    }
    for (const group of Object.values(groups)) {
      group.sort((a, b) => {
        const aTime = Date.parse(a.nextRun || a.schedule?.runAt || a.createdAt || '');
        const bTime = Date.parse(b.nextRun || b.schedule?.runAt || b.createdAt || '');
        if (Number.isNaN(aTime) && Number.isNaN(bTime)) return 0;
        if (Number.isNaN(aTime)) return 1;
        if (Number.isNaN(bTime)) return -1;
        return aTime - bTime;
      });
    }
    return Object.entries(groups).sort(([aId], [bId]) => {
      const aName = tripNameById.get(aId) || aId;
      const bName = tripNameById.get(bId) || bId;
      return aName.localeCompare(bName);
    });
  }, [tasks, tripNameById]);

  const handleToggle = async (task: ScheduledTask) => {
    if (!credentials) return;
    const res = await apiFetch<ScheduledTask>(`/api/scheduler/tasks/${task.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ enabled: !task.enabled }),
    }, credentials);
    if (!res.ok) {
      setError(res.error || 'Unable to update reminder.');
      return;
    }
    setTasks((prev) => prev.map((item) => (item.id === task.id ? res.data : item)));
  };

  const handleDelete = async (task: ScheduledTask) => {
    if (!credentials) return;
    const confirmed = window.confirm(`Delete reminder "${task.name}"?`);
    if (!confirmed) return;
    const res = await apiFetch(`/api/scheduler/tasks/${task.id}`, { method: 'DELETE' }, credentials);
    if (!res.ok) {
      setError(res.error || 'Unable to delete reminder.');
      return;
    }
    setTasks((prev) => prev.filter((item) => item.id !== task.id));
  };

  const hasTasks = tasks.length > 0;

  return (
    <div className="flex flex-col h-full">
      <div className="border-b px-4 py-3 flex items-center justify-between gap-3" style={{ borderColor: 'hsl(var(--border-subtle))' }}>
        <div className="flex items-center gap-3 min-w-0">
          {onCollapse && (
            <button
              type="button"
              className="itinerary-collapse-btn"
              onClick={onCollapse}
              title="Collapse reminders"
            >
              <CollapseIcon />
            </button>
          )}
          <div className="min-w-0">
            <div className="mono-label" style={{ color: 'hsl(var(--text-tertiary))' }}>Reminders</div>
            <div className="text-xs mt-1" style={{ color: 'hsl(var(--text-tertiary))' }}>
              One-time notifications tied to bookings and deadlines
            </div>
          </div>
        </div>
        <div className="flex items-center gap-2">
          {activeTripId && (
            <div className="reminders-scope">
              <button
                type="button"
                className={`reminders-scope-btn ${scope === 'all' ? 'active' : ''}`}
                onClick={() => setScope('all')}
              >
                All trips
              </button>
              <button
                type="button"
                className={`reminders-scope-btn ${scope === 'trip' ? 'active' : ''}`}
                onClick={() => setScope('trip')}
              >
                This trip
              </button>
            </div>
          )}
          <button type="button" className="icon-btn" onClick={refresh} disabled={isLoading} title="Refresh reminders">
            <RefreshIcon />
          </button>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto px-4 py-4">
        {error && (
          <div className="reminders-error">{error}</div>
        )}
        {!hasTasks && !isLoading && (
          <div className="reminders-empty">
            <div className="mono-label" style={{ color: 'hsl(var(--text-tertiary))' }}>No reminders yet</div>
            <p className="text-sm mt-2" style={{ color: 'hsl(var(--text-secondary))' }}>
              When you add booking details, reminders will appear here.
            </p>
          </div>
        )}
        {isLoading && (
          <div className="reminders-loading">Loading reminders…</div>
        )}
        {hasTasks && groupedTasks.map(([tripId, group]) => (
          <div key={tripId} className="reminders-group">
            {scope === 'all' && (
              <div className="reminders-group-title">
                {tripNameById.get(tripId) || (tripId === 'unassigned' ? 'Unassigned' : tripId)}
              </div>
            )}
            <div className="reminders-list">
              {group.map((task) => {
                const reminderTime = task.nextRun || task.schedule?.runAt;
                const reminderLabel = formatDateTime(reminderTime, task.schedule?.timezone);
                const deadlineLabel = formatDate(task.payload?.deadlineDate);
                return (
                  <div key={task.id} className={`reminder-card ${task.enabled ? '' : 'disabled'}`.trim()}>
                    <div className="reminder-main">
                      <div className="reminder-title">
                        {task.name || task.payload?.subject || 'Reminder'}
                      </div>
                      {task.payload?.subject && task.payload?.subject !== task.name && (
                        <div className="reminder-subtitle">{task.payload.subject}</div>
                      )}
                      <div className="reminder-meta">
                        <span>Reminder: {reminderLabel}</span>
                        {task.schedule?.timezone && <span className="reminder-meta-muted">({task.schedule.timezone})</span>}
                      </div>
                      {task.payload?.deadlineDate && (
                        <div className="reminder-meta">Deadline: {deadlineLabel}</div>
                      )}
                      {task.lastRun && (
                        <div className="reminder-meta">Last run: {formatDateTime(task.lastRun)}</div>
                      )}
                      {task.lastError && (
                        <div className="reminder-error">Last error: {task.lastError}</div>
                      )}
                      {task.payload?.body && (
                        <div className="reminder-body">{task.payload.body}</div>
                      )}
                    </div>
                    <div className="reminder-actions">
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => handleToggle(task)}
                        title={task.enabled ? 'Disable reminder' : 'Enable reminder'}
                      >
                        <BellIcon enabled={task.enabled} />
                      </button>
                      <button
                        type="button"
                        className="icon-btn"
                        onClick={() => handleDelete(task)}
                        title="Delete reminder"
                      >
                        <TrashIcon />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
