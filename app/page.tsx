"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";

type Event = {
  id: string;
  name: string;
  days: string[];
  createdAt: string;
  _count?: { sessions: number };
};

function formatDay(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatDayFull(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// Simple month calendar for picking dates
function DatePicker({ selected, onChange }: { selected: string[]; onChange: (days: string[]) => void }) {
  const today = new Date();
  const [year,  setYear]  = useState(today.getFullYear());
  const [month, setMonth] = useState(today.getMonth());

  const firstDay  = new Date(year, month, 1).getDay(); // 0=Sun
  const daysInMonth = new Date(year, month + 1, 0).getDate();
  const startOffset = (firstDay + 6) % 7; // Mon=0

  const monthLabel = new Date(year, month).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

  const prevMonth = () => { if (month === 0) { setMonth(11); setYear(y => y - 1); } else setMonth(m => m - 1); };
  const nextMonth = () => { if (month === 11) { setMonth(0); setYear(y => y + 1); } else setMonth(m => m + 1); };

  const toggle = (dateStr: string) => {
    onChange(selected.includes(dateStr) ? selected.filter(d => d !== dateStr) : [...selected, dateStr].sort());
  };

  const cells = Array.from({ length: startOffset + daysInMonth }, (_, i) => {
    if (i < startOffset) return null;
    const day = i - startOffset + 1;
    const dateStr = `${year}-${String(month + 1).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    return dateStr;
  });

  return (
    <div className="select-none">
      <div className="flex items-center justify-between mb-3">
        <button onClick={prevMonth} className="text-slate-500 hover:text-slate-800 px-2 py-1 rounded hover:bg-slate-100 transition-colors">←</button>
        <span className="text-sm font-semibold text-slate-700">{monthLabel}</span>
        <button onClick={nextMonth} className="text-slate-500 hover:text-slate-800 px-2 py-1 rounded hover:bg-slate-100 transition-colors">→</button>
      </div>
      <div className="grid grid-cols-7 gap-1 text-center mb-1">
        {["M","T","W","T","F","S","S"].map((d, i) => (
          <span key={i} className="text-[10px] font-semibold text-slate-400">{d}</span>
        ))}
      </div>
      <div className="grid grid-cols-7 gap-1">
        {cells.map((dateStr, i) => {
          if (!dateStr) return <div key={i} />;
          const isSelected = selected.includes(dateStr);
          const isPast = new Date(dateStr + "T00:00:00") < new Date(new Date().toDateString());
          return (
            <button
              key={dateStr}
              onClick={() => !isPast && toggle(dateStr)}
              disabled={isPast}
              className={`text-xs rounded py-1.5 font-medium transition-colors ${
                isSelected
                  ? "bg-indigo-600 text-white"
                  : isPast
                  ? "text-slate-300 cursor-default"
                  : "text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
              }`}
            >
              {new Date(dateStr + "T00:00:00").getDate()}
            </button>
          );
        })}
      </div>
    </div>
  );
}

export default function HomePage() {
  const router = useRouter();
  const [events,   setEvents]   = useState<Event[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [creating, setCreating] = useState(false);
  const [newName,  setNewName]  = useState("");
  const [newDays,  setNewDays]  = useState<string[]>([]);
  const [saving,   setSaving]   = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  useEffect(() => {
    const init = async () => {
      // Run migration first to ensure legacy data is assigned to IP MAY 2026
      await fetch("/api/migrate", { method: "POST" });
      const res = await fetch("/api/events");
      if (res.ok) setEvents(await res.json());
      setLoading(false);
    };
    init();
  }, []);

  const createEvent = async () => {
    if (!newName.trim() || newDays.length === 0) return;
    setSaving(true);
    const res = await fetch("/api/events", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name: newName.trim(), days: newDays }),
    });
    if (res.ok) {
      const event = await res.json();
      setEvents(prev => [...prev, { ...event, _count: { sessions: 0 } }]);
      setCreating(false);
      setNewName("");
      setNewDays([]);
      router.push(`/events/${event.id}`);
    }
    setSaving(false);
  };

  const deleteEvent = async (id: string) => {
    setDeleting(id);
    await fetch(`/api/events/${id}`, { method: "DELETE" });
    setEvents(prev => prev.filter(e => e.id !== id));
    setDeleting(null);
  };

  return (
    <div className="min-h-screen bg-slate-100">
      <header className="bg-white border-b border-slate-200 shadow-sm">
        <div className="max-w-4xl mx-auto px-6 py-4 flex items-center justify-between">
          <div>
            <h1 className="text-lg font-bold text-slate-900">Increment Planner</h1>
            <p className="text-xs text-slate-400">Manage your planning events</p>
          </div>
          <button
            onClick={() => setCreating(true)}
            className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-4 py-2 rounded-lg transition-colors"
          >
            + New Event
          </button>
        </div>
      </header>

      <main className="max-w-4xl mx-auto px-6 py-8">
        {loading ? (
          <div className="flex items-center justify-center py-24">
            <p className="text-slate-400 text-sm">Loading events...</p>
          </div>
        ) : events.length === 0 ? (
          <div className="flex flex-col items-center justify-center py-24 text-center">
            <div className="text-4xl mb-4">📅</div>
            <h2 className="text-lg font-semibold text-slate-700 mb-2">No events yet</h2>
            <p className="text-slate-400 text-sm mb-6">Create your first planning event to get started</p>
            <button
              onClick={() => setCreating(true)}
              className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-semibold px-5 py-2.5 rounded-lg transition-colors"
            >
              + New Event
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
            {events.map(event => (
              <div
                key={event.id}
                className="bg-white rounded-xl border border-slate-200 shadow-sm hover:shadow-md hover:border-indigo-200 transition-all group cursor-pointer"
                onClick={() => router.push(`/events/${event.id}`)}
              >
                <div className="p-5">
                  <div className="flex items-start justify-between mb-3">
                    <h2 className="font-bold text-slate-900 text-base group-hover:text-indigo-600 transition-colors">
                      {event.name}
                    </h2>
                    <button
                      onClick={e => { e.stopPropagation(); if (confirm(`Delete "${event.name}"?`)) deleteEvent(event.id); }}
                      className="text-slate-300 hover:text-red-500 text-xs transition-colors opacity-0 group-hover:opacity-100 ml-2"
                    >
                      {deleting === event.id ? "..." : "✕"}
                    </button>
                  </div>

                  <div className="space-y-1 mb-4">
                    {event.days.slice(0, 4).map(d => (
                      <div key={d} className="flex items-center gap-2">
                        <span className="w-1.5 h-1.5 rounded-full bg-indigo-400 shrink-0" />
                        <span className="text-xs text-slate-500">{formatDayFull(d)}</span>
                      </div>
                    ))}
                    {event.days.length > 4 && (
                      <p className="text-xs text-slate-400 pl-3.5">+{event.days.length - 4} more days</p>
                    )}
                  </div>

                  <div className="flex items-center justify-between pt-3 border-t border-slate-100">
                    <span className="text-xs text-slate-400">
                      {event._count?.sessions ?? 0} session{(event._count?.sessions ?? 0) !== 1 ? "s" : ""}
                    </span>
                    <span className="text-xs font-semibold text-indigo-600 group-hover:underline">
                      Open →
                    </span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </main>

      {/* Create event modal */}
      {creating && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md flex flex-col max-h-[90vh]">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900">New Planning Event</h2>
              <button onClick={() => { setCreating(false); setNewName(""); setNewDays([]); }} className="text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button>
            </div>
            <div className="p-6 space-y-5 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Event name</label>
                <input
                  value={newName}
                  onChange={e => setNewName(e.target.value)}
                  placeholder="e.g. IP August 2026"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">
                  Select days <span className="text-slate-400">({newDays.length} selected)</span>
                </label>
                <DatePicker selected={newDays} onChange={setNewDays} />
                {newDays.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {newDays.map(d => (
                      <span key={d} className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full font-medium">
                        {formatDay(d)}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => { setCreating(false); setNewName(""); setNewDays([]); }} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">Cancel</button>
              <button
                onClick={createEvent}
                disabled={!newName.trim() || newDays.length === 0 || saving}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
              >
                {saving ? "Creating..." : "Create Event"}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
