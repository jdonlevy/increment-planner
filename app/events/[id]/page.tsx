"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useParams } from "next/navigation";

// ─── Types ───────────────────────────────────────────────────────────────────

type Room    = { id: string; name: string };
type Team    = { id: string; name: string; colorIdx: number; roomId: string | null };
type Person  = { id: string; name: string; teamId: string };
type Session = { id: string; name: string; notes: string; teamId: string; attendeeIds: string[] };
type Placement = { id: string; sessionId: string; roomId: string; day: string; slotIdx: number };
type Blocked   = { id: string; roomId: string; day: string; slotIdx: number };
type Event     = { id: string; name: string; days: string[] };

// ─── Constants ───────────────────────────────────────────────────────────────

const SLOTS = [
  "09:00","09:30","10:00","10:30","11:00","11:30","12:00",
  "12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30",
];

const TEAM_COLORS = [
  { bg: "bg-indigo-100",  border: "border-indigo-300",  text: "text-indigo-800",  dot: "bg-indigo-400"  },
  { bg: "bg-emerald-100", border: "border-emerald-300", text: "text-emerald-800", dot: "bg-emerald-400" },
  { bg: "bg-amber-100",   border: "border-amber-300",   text: "text-amber-800",   dot: "bg-amber-400"   },
  { bg: "bg-rose-100",    border: "border-rose-300",    text: "text-rose-800",    dot: "bg-rose-400"    },
  { bg: "bg-violet-100",  border: "border-violet-300",  text: "text-violet-800",  dot: "bg-violet-400"  },
  { bg: "bg-cyan-100",    border: "border-cyan-300",    text: "text-cyan-800",    dot: "bg-cyan-400"    },
  { bg: "bg-orange-100",  border: "border-orange-300",  text: "text-orange-800",  dot: "bg-orange-400"  },
  { bg: "bg-teal-100",    border: "border-teal-300",    text: "text-teal-800",    dot: "bg-teal-400"    },
];

function uid() {
  return Math.random().toString(36).slice(2) + Date.now().toString(36);
}

function formatDayTab(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });
}

function formatDayFull(dateStr: string) {
  const d = new Date(dateStr + "T00:00:00");
  return d.toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" });
}

// ─── Clash detection ──────────────────────────────────────────────────────────

function buildClashMap(
  placements: Placement[],
  sessions: Session[],
  people: Person[],
): Map<string, string[]> {
  const sessionMap = new Map(sessions.map(s => [s.id, s]));
  const personMap  = new Map(people.map(p => [p.id, p]));
  const clashes    = new Map<string, string[]>();

  // Group placements by (day, slotIdx)
  const slotMap = new Map<string, Placement[]>();
  for (const p of placements) {
    const key = `${p.day}|${p.slotIdx}`;
    if (!slotMap.has(key)) slotMap.set(key, []);
    slotMap.get(key)!.push(p);
  }

  for (const [, group] of slotMap) {
    if (group.length < 2) continue;
    // Collect all attendeeIds per placement
    const attendeeSets = group.map(p => ({
      placementId: p.id,
      ids: new Set(sessionMap.get(p.sessionId)?.attendeeIds ?? []),
    }));
    for (let i = 0; i < attendeeSets.length; i++) {
      for (let j = i + 1; j < attendeeSets.length; j++) {
        const shared = [...attendeeSets[i].ids].filter(id => attendeeSets[j].ids.has(id));
        if (shared.length > 0) {
          const names = shared.map(id => personMap.get(id)?.name ?? id);
          for (const pid of [attendeeSets[i].placementId, attendeeSets[j].placementId]) {
            const existing = clashes.get(pid) ?? [];
            const merged = [...new Set([...existing, ...names])];
            clashes.set(pid, merged);
          }
        }
      }
    }
  }
  return clashes;
}

// ─── Sub-components ──────────────────────────────────────────────────────────

function SessionCard({
  session, team, people, clash, expanded, onToggleExpand,
  onDragStart,
}: {
  session: Session; team: Team | undefined; people: Person[];
  clash?: string[]; expanded: boolean; onToggleExpand: () => void;
  onDragStart: (id: string) => void;
}) {
  const c = team ? TEAM_COLORS[team.colorIdx % TEAM_COLORS.length] : TEAM_COLORS[0];
  const attendees = people.filter(p => session.attendeeIds.includes(p.id));

  return (
    <div
      draggable
      onDragStart={() => onDragStart(session.id)}
      className={`rounded-lg border ${c.bg} ${c.border} p-2.5 cursor-grab active:cursor-grabbing select-none`}
    >
      <div className="flex items-start justify-between gap-1">
        <div className="min-w-0">
          <p className={`text-xs font-semibold truncate ${c.text}`}>{session.name}</p>
          {team && <p className="text-[10px] text-slate-500 truncate">{team.name}</p>}
        </div>
        <div className="flex items-center gap-1 shrink-0">
          {clash && clash.length > 0 && (
            <span title={`Clash: ${clash.join(", ")}`} className="text-red-500 text-xs">⚠</span>
          )}
          <button
            onClick={e => { e.stopPropagation(); onToggleExpand(); }}
            className="text-slate-400 hover:text-slate-700 text-[10px] leading-none px-1"
          >
            {expanded ? "▲" : "▼"}
          </button>
        </div>
      </div>
      {expanded && (
        <div className="mt-1.5 pt-1.5 border-t border-slate-200 space-y-0.5">
          {attendees.length === 0
            ? <p className="text-[10px] text-slate-400 italic">No attendees</p>
            : attendees.map(p => (
                <p key={p.id} className="text-[10px] text-slate-600">• {p.name}</p>
              ))
          }
          {session.notes && <p className="text-[10px] text-slate-400 italic mt-1">{session.notes}</p>}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EventPage() {
  const router = useRouter();
  const params = useParams();
  const eventId = params.id as string;

  // ── State ──
  const [event,    setEvent]    = useState<Event | null>(null);
  const [rooms,    setRooms]    = useState<Room[]>([]);
  const [teams,    setTeams]    = useState<Team[]>([]);
  const [people,   setPeople]   = useState<Person[]>([]);
  const [sessions,    setSessions]    = useState<Session[]>([]);
  const [placements,  setPlacements]  = useState<Placement[]>([]);
  const [blocked,     setBlocked]     = useState<Blocked[]>([]);
  const [loading,  setLoading]  = useState(true);
  const [activeDay, setActiveDay] = useState(0);

  // Panel state
  const [tab, setTab]       = useState<"sessions" | "teams">("sessions");
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());

  // Add session form
  const [showAddSession, setShowAddSession] = useState(false);
  const [newSessName,    setNewSessName]    = useState("");
  const [newSessTeam,    setNewSessTeam]    = useState("");
  const [newSessNotes,   setNewSessNotes]   = useState("");
  const [newSessAttendees, setNewSessAttendees] = useState<string[]>([]);
  const [attendeeInput,  setAttendeeInput]  = useState("");

  // Add team/room/person forms
  const [newRoomName,   setNewRoomName]   = useState("");
  const [newTeamName,   setNewTeamName]   = useState("");
  const [newTeamRoom,   setNewTeamRoom]   = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonTeam, setNewPersonTeam] = useState("");

  // Edit session modal
  const [editSession, setEditSession] = useState<Session | null>(null);
  const [editAttendeeInput, setEditAttendeeInput] = useState("");

  // Drag state
  const draggingSessionId = useRef<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<{ roomId: string; day: string; slotIdx: number } | null>(null);

  // Saving
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const loaded = useRef(false);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Load data ──
  useEffect(() => {
    const init = async () => {
      const [evRes, globalRes, schedRes] = await Promise.all([
        fetch(`/api/events/${eventId}`),
        fetch("/api/global"),
        fetch(`/api/events/${eventId}/schedule`),
      ]);
      if (!evRes.ok) { router.push("/"); return; }
      const ev      = await evRes.json();
      const global  = await globalRes.json();
      const sched   = await schedRes.json();

      setEvent(ev);
      setRooms(global.rooms);
      setTeams(global.teams);
      setPeople(global.people);
      setSessions(sched.sessions.map((s: { id: string; name: string; notes: string; teamId: string; attendees: { id: string }[] }) => ({
        id: s.id, name: s.name, notes: s.notes, teamId: s.teamId,
        attendeeIds: s.attendees.map((a: { id: string }) => a.id),
      })));
      setPlacements(sched.placements);
      setBlocked(sched.blocked);
      setLoading(false);
      loaded.current = true;
    };
    init();
  }, [eventId, router]);

  // ── Auto-save ──
  const globalPayload = useMemo(() => ({ rooms, teams, people }), [rooms, teams, people]);
  const schedPayload  = useMemo(() => ({ sessions, placements, blocked }), [sessions, placements, blocked]);

  const triggerSave = useCallback(() => {
    if (!loaded.current) return;
    setSaveStatus("unsaved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      setSaveStatus("saving");
      await Promise.all([
        fetch("/api/global", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(globalPayload) }),
        fetch(`/api/events/${eventId}/schedule`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(schedPayload) }),
      ]);
      setSaveStatus("saved");
    }, 1500);
  }, [globalPayload, schedPayload, eventId]);

  useEffect(() => { if (loaded.current) triggerSave(); }, [globalPayload, schedPayload, triggerSave]);

  // ── Clash map ──
  const clashMap = useMemo(() => buildClashMap(placements, sessions, people), [placements, sessions, people]);

  // ── Lookup helpers ──
  const teamOf    = (id: string) => teams.find(t => t.id === id);
  const sessionOf = (id: string) => sessions.find(s => s.id === id);

  const placementAt = (roomId: string, day: string, slotIdx: number) =>
    placements.find(p => p.roomId === roomId && p.day === day && p.slotIdx === slotIdx);
  const isBlocked = (roomId: string, day: string, slotIdx: number) =>
    blocked.some(b => b.roomId === roomId && b.day === day && b.slotIdx === slotIdx);

  // ── Session actions ──
  const unplacedSessions = sessions.filter(s => !placements.some(p => p.sessionId === s.id));

  const addSession = () => {
    if (!newSessName.trim() || !newSessTeam) return;
    setSessions(prev => [...prev, {
      id: uid(), name: newSessName.trim(), notes: newSessNotes.trim(),
      teamId: newSessTeam, attendeeIds: newSessAttendees,
    }]);
    setNewSessName(""); setNewSessTeam(""); setNewSessNotes("");
    setNewSessAttendees([]); setAttendeeInput(""); setShowAddSession(false);
  };

  const removeSession = (id: string) => {
    setSessions(prev => prev.filter(s => s.id !== id));
    setPlacements(prev => prev.filter(p => p.sessionId !== id));
  };

  const saveEdit = () => {
    if (!editSession) return;
    setSessions(prev => prev.map(s => s.id === editSession.id ? editSession : s));
    setEditSession(null);
  };

  // ── Room / team / person actions ──
  const addRoom = () => {
    if (!newRoomName.trim()) return;
    setRooms(prev => [...prev, { id: uid(), name: newRoomName.trim() }]);
    setNewRoomName("");
  };

  const removeRoom = (id: string) => {
    setRooms(prev => prev.filter(r => r.id !== id));
    setPlacements(prev => prev.filter(p => p.roomId !== id));
    setBlocked(prev => prev.filter(b => b.roomId !== id));
    setTeams(prev => prev.map(t => t.roomId === id ? { ...t, roomId: null } : t));
  };

  const addTeam = () => {
    if (!newTeamName.trim()) return;
    setTeams(prev => [...prev, {
      id: uid(), name: newTeamName.trim(),
      colorIdx: prev.length % TEAM_COLORS.length,
      roomId: newTeamRoom || null,
    }]);
    setNewTeamName(""); setNewTeamRoom("");
  };

  const removeTeam = (id: string) => {
    setTeams(prev => prev.filter(t => t.id !== id));
    setPeople(prev => prev.filter(p => p.teamId !== id));
    setSessions(prev => prev.filter(s => s.teamId !== id));
    setPlacements(prev => prev.filter(p => {
      const sess = sessions.find(s => s.id === p.sessionId);
      return sess?.teamId !== id;
    }));
  };

  const addPerson = () => {
    if (!newPersonName.trim() || !newPersonTeam) return;
    setPeople(prev => [...prev, { id: uid(), name: newPersonName.trim(), teamId: newPersonTeam }]);
    setNewPersonName(""); setNewPersonTeam("");
  };

  const removePerson = (id: string) => {
    setPeople(prev => prev.filter(p => p.id !== id));
    setSessions(prev => prev.map(s => ({
      ...s, attendeeIds: s.attendeeIds.filter(a => a !== id),
    })));
  };

  // ── Drag & drop ──
  const handleDrop = (roomId: string, day: string, slotIdx: number) => {
    const id = draggingSessionId.current;
    if (!id || isBlocked(roomId, day, slotIdx)) return;
    setPlacements(prev => {
      const without = prev.filter(p => p.sessionId !== id && !(p.roomId === roomId && p.day === day && p.slotIdx === slotIdx));
      const session = sessionOf(id);
      if (!session) return prev;
      // Prefer team's home room but allow any room
      return [...without, { id: uid(), sessionId: id, roomId, day, slotIdx }];
    });
    draggingSessionId.current = null;
    setDragOverCell(null);
  };

  const handleRemovePlacement = (placementId: string) => {
    setPlacements(prev => prev.filter(p => p.id !== placementId));
  };

  const toggleBlocked = (roomId: string, day: string, slotIdx: number) => {
    if (placementAt(roomId, day, slotIdx)) return; // can't block occupied cell
    setBlocked(prev => {
      const exists = prev.find(b => b.roomId === roomId && b.day === day && b.slotIdx === slotIdx);
      if (exists) return prev.filter(b => b.id !== exists.id);
      return [...prev, { id: uid(), roomId, day, slotIdx }];
    });
  };

  // ── Export ──
  const exportCSV = () => {
    if (!event) return;
    const rows = [["Day", "Time", "Room", "Session", "Team", "Attendees", "Notes"]];
    for (const day of event.days) {
      for (let slotIdx = 0; slotIdx < SLOTS.length; slotIdx++) {
        for (const room of rooms) {
          const p = placementAt(room.id, day, slotIdx);
          if (!p) continue;
          const sess = sessionOf(p.sessionId);
          if (!sess) continue;
          const team = teamOf(sess.teamId);
          const attendees = people.filter(pe => sess.attendeeIds.includes(pe.id)).map(pe => pe.name).join("; ");
          rows.push([formatDayFull(day), SLOTS[slotIdx], room.name, sess.name, team?.name ?? "", attendees, sess.notes]);
        }
      }
    }
    const csv = rows.map(r => r.map(c => `"${c.replace(/"/g, '""')}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${event.name.replace(/\s+/g, "_")}.csv`;
    a.click();
  };

  // ── Attendee input helpers ──
  const allPeopleNames = useMemo(() => people.map(p => p.name.toLowerCase()), [people]);
  const attendeeSuggestions = (input: string, teamId: string, currentIds: string[]) => {
    if (!input.trim()) return [];
    const teamPeople = people.filter(p => p.teamId === teamId && !currentIds.includes(p.id));
    return teamPeople.filter(p => p.name.toLowerCase().includes(input.toLowerCase())).slice(0, 5);
  };
  const allSuggestions = (input: string, currentIds: string[]) => {
    if (!input.trim()) return [];
    return people.filter(p => !currentIds.includes(p.id) && p.name.toLowerCase().includes(input.toLowerCase())).slice(0, 5);
  };

  void allPeopleNames; // used via allSuggestions

  // ── Render ──
  if (loading) {
    return (
      <div className="min-h-screen bg-slate-100 flex items-center justify-center">
        <p className="text-slate-400 text-sm">Loading...</p>
      </div>
    );
  }

  if (!event) return null;

  const currentDay = event.days[activeDay] ?? event.days[0];

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col">
      {/* Header */}
      <header className="bg-white border-b border-slate-200 shadow-sm shrink-0">
        <div className="max-w-[1600px] mx-auto px-4 py-3 flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <button
              onClick={() => router.push("/")}
              className="text-slate-400 hover:text-slate-700 text-sm transition-colors flex items-center gap-1"
            >
              ← Back
            </button>
            <div className="h-4 w-px bg-slate-200" />
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-tight">{event.name}</h1>
              <p className="text-[10px] text-slate-400">Increment Planning Scheduler</p>
            </div>
          </div>
          <div className="flex items-center gap-3">
            <span className={`text-xs font-medium ${
              saveStatus === "saved"   ? "text-emerald-600" :
              saveStatus === "saving"  ? "text-amber-500"   : "text-slate-400"
            }`}>
              {saveStatus === "saved" ? "✓ Saved" : saveStatus === "saving" ? "Saving…" : "Unsaved"}
            </span>
            <button
              onClick={exportCSV}
              className="text-xs text-slate-600 hover:text-slate-900 border border-slate-300 px-3 py-1.5 rounded-lg transition-colors"
            >
              Export CSV
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden max-w-[1600px] mx-auto w-full px-4 py-4 gap-4">
        {/* ── Left Panel ── */}
        <aside className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto">
          {/* Panel tabs */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-1 flex gap-1">
            <button
              onClick={() => setTab("sessions")}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${tab === "sessions" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800"}`}
            >
              Sessions
            </button>
            <button
              onClick={() => setTab("teams")}
              className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${tab === "teams" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800"}`}
            >
              Teams & People
            </button>
          </div>

          {tab === "sessions" ? (
            <>
              {/* Unscheduled sessions */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Unscheduled</h2>
                  <button
                    onClick={() => setShowAddSession(v => !v)}
                    className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold"
                  >
                    {showAddSession ? "Cancel" : "+ Add"}
                  </button>
                </div>

                {showAddSession && (
                  <div className="mb-3 space-y-2 pb-3 border-b border-slate-100">
                    <input
                      value={newSessName}
                      onChange={e => setNewSessName(e.target.value)}
                      placeholder="Session name"
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <select
                      value={newSessTeam}
                      onChange={e => setNewSessTeam(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    >
                      <option value="">Select team…</option>
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <textarea
                      value={newSessNotes}
                      onChange={e => setNewSessNotes(e.target.value)}
                      placeholder="Notes (optional)"
                      rows={2}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
                    />
                    {/* Attendees */}
                    <div className="relative">
                      <input
                        value={attendeeInput}
                        onChange={e => setAttendeeInput(e.target.value)}
                        placeholder="Add attendees…"
                        className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                      />
                      {attendeeInput && (
                        <div className="absolute z-10 w-full bg-white border border-slate-200 rounded-lg shadow-lg mt-0.5 overflow-hidden">
                          {allSuggestions(attendeeInput, newSessAttendees).map(p => (
                            <button
                              key={p.id}
                              onMouseDown={() => { setNewSessAttendees(prev => [...prev, p.id]); setAttendeeInput(""); }}
                              className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                            >
                              {p.name}
                            </button>
                          ))}
                        </div>
                      )}
                    </div>
                    {newSessAttendees.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {newSessAttendees.map(id => {
                          const p = people.find(pe => pe.id === id);
                          return p ? (
                            <span key={id} className="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1">
                              {p.name}
                              <button onClick={() => setNewSessAttendees(prev => prev.filter(a => a !== id))} className="text-indigo-400 hover:text-indigo-700">×</button>
                            </span>
                          ) : null;
                        })}
                      </div>
                    )}
                    <button
                      onClick={addSession}
                      disabled={!newSessName.trim() || !newSessTeam}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold py-1.5 rounded-lg transition-colors"
                    >
                      Add Session
                    </button>
                  </div>
                )}

                <div className="space-y-2">
                  {unplacedSessions.length === 0 && (
                    <p className="text-xs text-slate-400 italic text-center py-2">All sessions scheduled!</p>
                  )}
                  {unplacedSessions.map(s => (
                    <div key={s.id} className="relative group">
                      <SessionCard
                        session={s}
                        team={teamOf(s.teamId)}
                        people={people}
                        expanded={expandedSessions.has(s.id)}
                        onToggleExpand={() => setExpandedSessions(prev => {
                          const next = new Set(prev);
                          next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                          return next;
                        })}
                        onDragStart={id => { draggingSessionId.current = id; }}
                      />
                      <div className="absolute top-1 right-6 hidden group-hover:flex gap-0.5">
                        <button onClick={() => setEditSession(s)} className="text-[10px] text-slate-400 hover:text-indigo-600 px-1">✎</button>
                        <button onClick={() => removeSession(s.id)} className="text-[10px] text-slate-400 hover:text-red-500 px-1">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {/* All scheduled sessions (for drag back) */}
              {placements.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                  <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">Scheduled</h2>
                  <div className="space-y-2">
                    {sessions.filter(s => placements.some(p => p.sessionId === s.id)).map(s => {
                      const p = placements.find(pl => pl.sessionId === s.id)!;
                      const room = rooms.find(r => r.id === p.roomId);
                      const clash = clashMap.get(p.id);
                      return (
                        <div key={s.id} className="relative group">
                          <SessionCard
                            session={s}
                            team={teamOf(s.teamId)}
                            people={people}
                            clash={clash}
                            expanded={expandedSessions.has(s.id)}
                            onToggleExpand={() => setExpandedSessions(prev => {
                              const next = new Set(prev);
                              next.has(s.id) ? next.delete(s.id) : next.add(s.id);
                              return next;
                            })}
                            onDragStart={id => { draggingSessionId.current = id; }}
                          />
                          <div className="mt-0.5">
                            <p className="text-[10px] text-slate-400">{formatDayTab(p.day)} · {SLOTS[p.slotIdx]} · {room?.name}</p>
                          </div>
                          <div className="absolute top-1 right-1 hidden group-hover:flex gap-0.5">
                            <button onClick={() => setEditSession(s)} className="text-[10px] text-slate-400 hover:text-indigo-600 px-1">✎</button>
                            <button onClick={() => removeSession(s.id)} className="text-[10px] text-slate-400 hover:text-red-500 px-1">✕</button>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          ) : (
            <>
              {/* Rooms */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">Rooms</h2>
                <div className="space-y-1.5 mb-3">
                  {rooms.map(r => (
                    <div key={r.id} className="flex items-center justify-between group">
                      <span className="text-xs text-slate-700">{r.name}</span>
                      <button onClick={() => removeRoom(r.id)} className="text-slate-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                    </div>
                  ))}
                </div>
                <div className="flex gap-1.5">
                  <input
                    value={newRoomName}
                    onChange={e => setNewRoomName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addRoom()}
                    placeholder="Room name"
                    className="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <button onClick={addRoom} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs px-2.5 py-1.5 rounded-lg font-semibold transition-colors">Add</button>
                </div>
              </div>

              {/* Teams */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">Teams</h2>
                <div className="space-y-1.5 mb-3">
                  {teams.map(t => {
                    const c = TEAM_COLORS[t.colorIdx % TEAM_COLORS.length];
                    const homeRoom = rooms.find(r => r.id === t.roomId);
                    return (
                      <div key={t.id} className="flex items-center justify-between group">
                        <div className="flex items-center gap-2">
                          <span className={`w-2 h-2 rounded-full ${c.dot}`} />
                          <span className="text-xs text-slate-700">{t.name}</span>
                          {homeRoom && <span className="text-[10px] text-slate-400">({homeRoom.name})</span>}
                        </div>
                        <button onClick={() => removeTeam(t.id)} className="text-slate-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                      </div>
                    );
                  })}
                </div>
                <div className="space-y-1.5">
                  <input
                    value={newTeamName}
                    onChange={e => setNewTeamName(e.target.value)}
                    placeholder="Team name"
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  <select
                    value={newTeamRoom}
                    onChange={e => setNewTeamRoom(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">Home room (optional)</option>
                    {rooms.map(r => <option key={r.id} value={r.id}>{r.name}</option>)}
                  </select>
                  <button onClick={addTeam} disabled={!newTeamName.trim()} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold py-1.5 rounded-lg transition-colors">Add Team</button>
                </div>
              </div>

              {/* People */}
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">People</h2>
                {teams.map(team => {
                  const teamPeople = people.filter(p => p.teamId === team.id);
                  const c = TEAM_COLORS[team.colorIdx % TEAM_COLORS.length];
                  return (
                    <div key={team.id} className="mb-3">
                      <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1 ${c.text}`}>{team.name}</p>
                      <div className="space-y-0.5 mb-1">
                        {teamPeople.map(p => (
                          <div key={p.id} className="flex items-center justify-between group pl-2">
                            <span className="text-xs text-slate-700">{p.name}</span>
                            <button onClick={() => removePerson(p.id)} className="text-slate-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                          </div>
                        ))}
                      </div>
                    </div>
                  );
                })}
                <div className="space-y-1.5 pt-2 border-t border-slate-100">
                  <input
                    value={newPersonName}
                    onChange={e => setNewPersonName(e.target.value)}
                    onKeyDown={e => e.key === "Enter" && addPerson()}
                    placeholder="Person name"
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    list="person-suggestions"
                  />
                  <datalist id="person-suggestions">
                    {people.map(p => <option key={p.id} value={p.name} />)}
                  </datalist>
                  <select
                    value={newPersonTeam}
                    onChange={e => setNewPersonTeam(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  >
                    <option value="">Select team…</option>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <button onClick={addPerson} disabled={!newPersonName.trim() || !newPersonTeam} className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold py-1.5 rounded-lg transition-colors">Add Person</button>
                </div>
              </div>
            </>
          )}
        </aside>

        {/* ── Main Grid ── */}
        <main className="flex-1 flex flex-col min-w-0">
          {/* Day tabs */}
          <div className="flex gap-2 mb-3 shrink-0 flex-wrap">
            {event.days.map((day, i) => (
              <button
                key={day}
                onClick={() => setActiveDay(i)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  activeDay === i
                    ? "bg-indigo-600 text-white shadow-sm"
                    : "bg-white text-slate-600 border border-slate-200 hover:border-indigo-300 hover:text-indigo-600"
                }`}
              >
                {formatDayTab(day)}
              </button>
            ))}
          </div>

          {/* Grid */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-auto flex-1">
            {rooms.length === 0 ? (
              <div className="flex items-center justify-center h-full text-slate-400 text-sm py-24">
                Add rooms in the Teams & People tab to get started
              </div>
            ) : (
              <table className="border-collapse text-xs min-w-full">
                <thead>
                  <tr>
                    <th className="sticky left-0 bg-slate-50 border-b border-r border-slate-200 px-3 py-2 text-left text-[10px] font-semibold text-slate-500 uppercase tracking-wide w-16 z-10">
                      Time
                    </th>
                    {rooms.map(room => (
                      <th key={room.id} className="bg-slate-50 border-b border-r border-slate-200 px-3 py-2 text-left text-[10px] font-semibold text-slate-600 uppercase tracking-wide min-w-[160px]">
                        {room.name}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SLOTS.map((slot, slotIdx) => (
                    <tr key={slot} className="group/row">
                      <td className="sticky left-0 bg-white border-b border-r border-slate-100 px-3 py-1 text-[10px] font-medium text-slate-400 z-10 whitespace-nowrap">
                        {slot}
                      </td>
                      {rooms.map(room => {
                        const placement = placementAt(room.id, currentDay, slotIdx);
                        const blocked   = isBlocked(room.id, currentDay, slotIdx);
                        const session   = placement ? sessionOf(placement.sessionId) : null;
                        const clash     = placement ? clashMap.get(placement.id) : undefined;
                        const isOver    = dragOverCell?.roomId === room.id && dragOverCell?.day === currentDay && dragOverCell?.slotIdx === slotIdx;

                        return (
                          <td
                            key={room.id}
                            className={`border-b border-r border-slate-100 p-1 align-top transition-colors ${
                              blocked
                                ? "bg-slate-100"
                                : isOver
                                ? "bg-indigo-50"
                                : "hover:bg-slate-50/60"
                            }`}
                            onDragOver={e => { e.preventDefault(); setDragOverCell({ roomId: room.id, day: currentDay, slotIdx }); }}
                            onDragLeave={() => setDragOverCell(null)}
                            onDrop={() => handleDrop(room.id, currentDay, slotIdx)}
                            onContextMenu={e => { e.preventDefault(); toggleBlocked(room.id, currentDay, slotIdx); }}
                          >
                            {blocked ? (
                              <div className="h-8 flex items-center justify-center">
                                <span className="text-[10px] text-slate-400 select-none">Blocked</span>
                              </div>
                            ) : session && placement ? (
                              <div className="relative group/cell">
                                <SessionCard
                                  session={session}
                                  team={teamOf(session.teamId)}
                                  people={people}
                                  clash={clash}
                                  expanded={expandedSessions.has(session.id)}
                                  onToggleExpand={() => setExpandedSessions(prev => {
                                    const next = new Set(prev);
                                    next.has(session.id) ? next.delete(session.id) : next.add(session.id);
                                    return next;
                                  })}
                                  onDragStart={id => { draggingSessionId.current = id; }}
                                />
                                {clash && clash.length > 0 && (
                                  <div className="mt-0.5 px-1">
                                    <p className="text-[10px] text-red-500 font-medium">⚠ {clash.join(", ")}</p>
                                  </div>
                                )}
                                <button
                                  onClick={() => handleRemovePlacement(placement.id)}
                                  className="absolute top-1 right-1 text-[10px] text-slate-300 hover:text-red-500 opacity-0 group-hover/cell:opacity-100 transition-opacity"
                                >
                                  ✕
                                </button>
                              </div>
                            ) : (
                              <div className="h-8" />
                            )}
                          </td>
                        );
                      })}
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-[10px] text-slate-400 mt-2 shrink-0">Right-click a cell to block/unblock it. Drag sessions to schedule them.</p>
        </main>
      </div>

      {/* Edit Session Modal */}
      {editSession && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900 text-sm">Edit Session</h2>
              <button onClick={() => setEditSession(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <input
                value={editSession.name}
                onChange={e => setEditSession(s => s ? { ...s, name: e.target.value } : s)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                placeholder="Session name"
              />
              <select
                value={editSession.teamId}
                onChange={e => setEditSession(s => s ? { ...s, teamId: e.target.value } : s)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
              >
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <textarea
                value={editSession.notes}
                onChange={e => setEditSession(s => s ? { ...s, notes: e.target.value } : s)}
                placeholder="Notes"
                rows={2}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none"
              />
              {/* Attendees */}
              <div>
                <p className="text-xs font-medium text-slate-600 mb-1.5">Attendees</p>
                <div className="relative">
                  <input
                    value={editAttendeeInput}
                    onChange={e => setEditAttendeeInput(e.target.value)}
                    placeholder="Add attendee…"
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  {editAttendeeInput && (
                    <div className="absolute z-10 w-full bg-white border border-slate-200 rounded-lg shadow-lg mt-0.5">
                      {allSuggestions(editAttendeeInput, editSession.attendeeIds).map(p => (
                        <button
                          key={p.id}
                          onMouseDown={() => {
                            setEditSession(s => s ? { ...s, attendeeIds: [...s.attendeeIds, p.id] } : s);
                            setEditAttendeeInput("");
                          }}
                          className="w-full text-left px-3 py-1.5 text-sm text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
                        >
                          {p.name}
                        </button>
                      ))}
                    </div>
                  )}
                </div>
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {editSession.attendeeIds.map(id => {
                    const p = people.find(pe => pe.id === id);
                    return p ? (
                      <span key={id} className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                        {p.name}
                        <button onClick={() => setEditSession(s => s ? { ...s, attendeeIds: s.attendeeIds.filter(a => a !== id) } : s)} className="text-indigo-400 hover:text-indigo-700">×</button>
                      </span>
                    ) : null;
                  })}
                </div>
              </div>
            </div>
            <div className="px-5 py-4 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => setEditSession(null)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button onClick={saveEdit} className="bg-indigo-600 hover:bg-indigo-500 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">Save</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
