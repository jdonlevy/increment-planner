"use client";

import { useState, useEffect, useCallback, useMemo, useRef } from "react";
import { useRouter, useParams } from "next/navigation";

// ─── Types ───────────────────────────────────────────────────────────────────

type Room    = { id: string; name: string };
type Team    = { id: string; name: string; colorIdx: number; roomId: string | null };
type Person  = { id: string; name: string; teamId: string };
type Session = { id: string; name: string; notes: string; crossTeam: boolean; teamId: string; attendeeIds: string[] };
type Placement = { id: string; sessionId: string; roomId: string; day: string; slotIdx: number };
type Blocked   = { id: string; roomId: string; day: string; slotIdx: number };
type EventBreak    = { label: string; from: string; to: string; color: string };
type ActivityEntry = { id: string; actor: string; action: string; createdAt: string };
type Event     = { id: string; name: string; days: string[]; slots: string[]; lunchSlots: number[]; lunchLabel: string; lunchColor: string; breaks: EventBreak[] };

// ─── Constants ───────────────────────────────────────────────────────────────

const SLOTS = [
  "09:00","09:30","10:00","10:30","11:00","11:30","12:00",
  "12:30","13:00","13:30","14:00","14:30","15:00","15:30","16:00","16:30",
];

// Indices 6 ("12:00") and 7 ("12:30") are the lunch break
const LUNCH_SLOT_INDICES = new Set([6, 7]);

const TEAM_COLORS = [
  { bg: "bg-indigo-100",  border: "border-indigo-300",  text: "text-indigo-800",  dot: "bg-indigo-400",  hex: "#e0e7ff" },
  { bg: "bg-emerald-100", border: "border-emerald-300", text: "text-emerald-800", dot: "bg-emerald-400", hex: "#d1fae5" },
  { bg: "bg-amber-100",   border: "border-amber-300",   text: "text-amber-800",   dot: "bg-amber-400",   hex: "#fef3c7" },
  { bg: "bg-rose-100",    border: "border-rose-300",    text: "text-rose-800",    dot: "bg-rose-400",    hex: "#fee2e2" },
  { bg: "bg-violet-100",  border: "border-violet-300",  text: "text-violet-800",  dot: "bg-violet-400",  hex: "#ede9fe" },
  { bg: "bg-cyan-100",    border: "border-cyan-300",    text: "text-cyan-800",    dot: "bg-cyan-400",    hex: "#cffafe" },
  { bg: "bg-orange-100",  border: "border-orange-300",  text: "text-orange-800",  dot: "bg-orange-400",  hex: "#ffedd5" },
  { bg: "bg-teal-100",    border: "border-teal-300",    text: "text-teal-800",    dot: "bg-teal-400",    hex: "#ccfbf1" },
];

function initials(name: string) {
  return name.split(" ").map(w => w[0] ?? "").join("").toUpperCase().slice(0, 2) || "?";
}

function timeAgo(iso: string) {
  const secs = Math.floor((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return "just now";
  if (secs < 3600) return `${Math.floor(secs / 60)}m ago`;
  return `${Math.floor(secs / 3600)}h ago`;
}

// Returns a darkened version of a hex colour for text (60% darker)
function darkenHex(hex: string): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0,2),16), g = parseInt(h.slice(2,4),16), b = parseInt(h.slice(4,6),16);
  const d = (x: number) => Math.max(0, Math.floor(x * 0.4)).toString(16).padStart(2,"0");
  return `#${d(r)}${d(g)}${d(b)}`;
}

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

  const slotMap = new Map<string, Placement[]>();
  for (const p of placements) {
    const key = `${p.day}|${p.slotIdx}`;
    if (!slotMap.has(key)) slotMap.set(key, []);
    slotMap.get(key)!.push(p);
  }

  for (const [, group] of slotMap) {
    if (group.length < 2) continue;
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
            clashes.set(pid, [...new Set([...existing, ...names])]);
          }
        }
      }
    }
  }
  return clashes;
}

// ─── SessionCard ─────────────────────────────────────────────────────────────

const GREY = { bg: "bg-slate-100", border: "border-slate-300", text: "text-slate-600", dot: "bg-slate-400", hex: "#f1f5f9" };

function SessionCard({
  session, team, people, clash, expanded, onToggleExpand, onDragStart,
}: {
  session: Session; team: Team | undefined; people: Person[];
  clash?: string[]; expanded: boolean; onToggleExpand: () => void;
  onDragStart: (id: string) => void;
}) {
  const c = session.crossTeam
    ? (team ? TEAM_COLORS[team.colorIdx % TEAM_COLORS.length] : TEAM_COLORS[0])
    : GREY;
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
            : attendees.map(p => <p key={p.id} className="text-[10px] text-slate-600">• {p.name}</p>)
          }
          {session.notes && <p className="text-[10px] text-slate-400 italic mt-1">{session.notes}</p>}
        </div>
      )}
    </div>
  );
}

// ─── AttendeeSelector ────────────────────────────────────────────────────────

function AttendeeSelector({
  value, onChange, people, currentIds, inputClassName,
}: {
  value: string; onChange: (v: string) => void;
  people: Person[]; currentIds: string[];
  inputClassName?: string;
}) {
  const suggestions = useMemo(() => {
    if (!value.trim()) return [];
    const seen = new Set<string>();
    return people.filter(p => {
      if (currentIds.includes(p.id)) return false;
      if (!p.name.toLowerCase().includes(value.toLowerCase())) return false;
      const key = p.name.toLowerCase();
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    }).slice(0, 5);
  }, [value, people, currentIds]);

  return (
    <div className="relative">
      <input
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder="Add attendees…"
        className={inputClassName ?? "w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"}
      />
      {suggestions.length > 0 && (
        <div className="absolute z-20 w-full bg-white border border-slate-200 rounded-lg shadow-lg mt-0.5 overflow-hidden">
          {suggestions.map(p => (
            <button
              key={p.id}
              onMouseDown={e => { e.preventDefault(); onChange("__select__" + p.id); }}
              className="w-full text-left px-3 py-1.5 text-xs text-slate-700 hover:bg-indigo-50 hover:text-indigo-700"
            >
              {p.name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

// ─── Main Page ────────────────────────────────────────────────────────────────

export default function EventPage() {
  const router  = useRouter();
  const params  = useParams();
  const eventId = params.id as string;

  // ── Core state ──
  const [event,      setEvent]      = useState<Event | null>(null);
  const [rooms,      setRooms]      = useState<Room[]>([]);
  const [teams,      setTeams]      = useState<Team[]>([]);
  const [people,     setPeople]     = useState<Person[]>([]);
  const [sessions,   setSessions]   = useState<Session[]>([]);
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [blocked,    setBlocked]    = useState<Blocked[]>([]);
  const [loading,    setLoading]    = useState(true);
  const [activeDay,  setActiveDay]  = useState(0);

  // ── Panel state ──
  const [tab,              setTab]              = useState<"sessions" | "teams">("sessions");
  const [expandedSessions, setExpandedSessions] = useState<Set<string>>(new Set());
  const [showAddSession,   setShowAddSession]   = useState(false);
  const [newSessName,      setNewSessName]      = useState("");
  const [newSessTeam,      setNewSessTeam]      = useState("");
  const [newSessNotes,     setNewSessNotes]     = useState("");
  const [newSessAttendees, setNewSessAttendees] = useState<string[]>([]);
  const [newSessCrossTeam, setNewSessCrossTeam] = useState(false);
  const [attendeeInput,    setAttendeeInput]    = useState("");

  // ── Teams / rooms / people forms ──
  const [newRoomName,   setNewRoomName]   = useState("");
  const [newTeamName,   setNewTeamName]   = useState("");
  const [newTeamRoom,   setNewTeamRoom]   = useState("");
  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonTeam, setNewPersonTeam] = useState("");

  // ── Edit session modal ──
  const [editSession,       setEditSession]       = useState<Session | null>(null);
  const [editAttendeeInput, setEditAttendeeInput] = useState("");

  // ── Cell click modal ──
  const [cellModal,        setCellModal]        = useState<{ roomId: string; day: string; slotIdx: number } | null>(null);
  const [cellStep,         setCellStep]         = useState<"choose" | "form">("choose");
  const [cellSessName,     setCellSessName]     = useState("");
  const [cellSessTeam,     setCellSessTeam]     = useState("");
  const [cellSessNotes,    setCellSessNotes]    = useState("");
  const [cellSessAttendees,setCellSessAttendees]= useState<string[]>([]);
  const [cellSessCrossTeam,setCellSessCrossTeam]= useState(false);
  const [cellAttendeeInput,setCellAttendeeInput]= useState("");

  // ── Slot editor ──
  const [showSlotEditor,    setShowSlotEditor]    = useState(false);
  const [editStartTime,     setEditStartTime]     = useState("09:00");
  const [editEndTime,       setEditEndTime]       = useState("16:30");
  const [editSlotDuration,  setEditSlotDuration]  = useState(30);
  const [editLunchStart,    setEditLunchStart]    = useState("12:00");
  const [editLunchEnd,      setEditLunchEnd]      = useState("13:00");
  const [editLunchLabel,    setEditLunchLabel]    = useState("Lunch Break");
  const [editLunchColor,    setEditLunchColor]    = useState("#fef3c7");
  const [editHasLunch,      setEditHasLunch]      = useState(true);
  const [editBreaks,        setEditBreaks]        = useState<EventBreak[]>([]);
  const [newBreakLabel,     setNewBreakLabel]     = useState("");
  const [newBreakFrom,      setNewBreakFrom]      = useState("10:30");
  const [newBreakTo,        setNewBreakTo]        = useState("11:00");
  const [newBreakColor,     setNewBreakColor]     = useState("#fed7aa");
  const [savingSlots,       setSavingSlots]       = useState(false);
  const [slotSaveError,     setSlotSaveError]     = useState("");

  // ── Drag state ──
  const draggingSessionId = useRef<string | null>(null);
  const draggingBlockedId = useRef<string | null>(null);
  const [dragOverCell, setDragOverCell] = useState<{ roomId: string; day: string; slotIdx: number } | null>(null);

  // ── Save state ──
  const [saveStatus, setSaveStatus] = useState<"saved" | "saving" | "unsaved">("saved");
  const loaded        = useRef(false);
  const initialCounts = useRef({ sessions: -1, placements: -1, blocked: -1 });
  const saveTimerRef  = useRef<ReturnType<typeof setTimeout> | null>(null);

  // ── Live activity ──
  const [plannerName,    setPlannerName]    = useState("Anonymous");
  const [editingName,    setEditingName]    = useState(false);
  const [nameInput,      setNameInput]      = useState("");
  const [activities,     setActivities]     = useState<ActivityEntry[]>([]);
  const [showActivity,   setShowActivity]   = useState(false);
  const [toasts,         setToasts]         = useState<ActivityEntry[]>([]);
  const myName           = useRef("Anonymous");
  const lastSeenId       = useRef<string | null>(null);
  const firstPoll        = useRef(false);
  const applyingRemote   = useRef(false);
  const [liveReady,      setLiveReady]      = useState(false);

  // ── Load ──
  useEffect(() => {
    const init = async () => {
      // Ensure DB columns are up to date before loading (idempotent, fast after first run)
      await fetch("/api/migrate", { method: "POST" });
      const [evRes, globalRes, schedRes] = await Promise.all([
        fetch(`/api/events/${eventId}`),
        fetch("/api/global"),
        fetch(`/api/events/${eventId}/schedule`),
      ]);
      if (!evRes.ok) { router.push("/"); return; }
      const ev     = await evRes.json();
      const global = await globalRes.json();
      const sched  = await schedRes.json();
      setEvent(ev);
      setRooms(global.rooms);
      setTeams(global.teams);
      setPeople(global.people);
      setSessions(sched.sessions.map((s: { id: string; name: string; notes: string; crossTeam: boolean; teamId: string; attendees: { id: string }[] }) => ({
        id: s.id, name: s.name, notes: s.notes, crossTeam: s.crossTeam ?? false, teamId: s.teamId,
        attendeeIds: s.attendees.map((a: { id: string }) => a.id),
      })));
      setPlacements(sched.placements);
      setBlocked(sched.blocked);
      initialCounts.current = {
        sessions:   sched.sessions.length,
        placements: sched.placements.length,
        blocked:    sched.blocked.length,
      };
      setLoading(false);
      loaded.current = true;
      const stored = localStorage.getItem("plannerName") ?? "";
      if (stored) { setPlannerName(stored); myName.current = stored; }
      setLiveReady(true);
    };
    init();
  }, [eventId, router]);

  // ── Auto-save ──
  const globalPayload = useMemo(() => ({ rooms, teams, people }), [rooms, teams, people]);
  const schedPayload  = useMemo(() => ({ sessions, placements, blocked }), [sessions, placements, blocked]);

  const triggerSave = useCallback(() => {
    if (!loaded.current) return;
    if (applyingRemote.current) return;
    // Safety guard: never save if we'd be wiping sessions that existed on load
    const { sessions: initS } = initialCounts.current;
    if (initS > 0 && schedPayload.sessions.length === 0) return;
    setSaveStatus("unsaved");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(async () => {
      saveTimerRef.current = null;
      setSaveStatus("saving");
      await Promise.all([
        fetch("/api/global", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(globalPayload) }),
        fetch(`/api/events/${eventId}/schedule`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(schedPayload) }),
      ]);
      setSaveStatus("saved");
    }, 1500);
  }, [globalPayload, schedPayload, eventId]);

  useEffect(() => { if (loaded.current) triggerSave(); }, [globalPayload, schedPayload, triggerSave]);

  // ── Live activity polling ──
  useEffect(() => {
    if (!liveReady) return;

    const applySchedule = async () => {
      if (saveTimerRef.current) return; // user has unsaved edits — don't overwrite
      try {
        const schedRes = await fetch(`/api/events/${eventId}/schedule`);
        if (!schedRes.ok) return;
        const sched = await schedRes.json();
        applyingRemote.current = true;
        setSessions(sched.sessions.map((s: { id: string; name: string; notes: string; crossTeam: boolean; teamId: string; attendees: { id: string }[] }) => ({
          id: s.id, name: s.name, notes: s.notes, crossTeam: s.crossTeam ?? false, teamId: s.teamId,
          attendeeIds: s.attendees.map((a: { id: string }) => a.id),
        })));
        setPlacements(sched.placements);
        setBlocked(sched.blocked);
        setTimeout(() => { applyingRemote.current = false; }, 100);
      } catch { /* ignore */ }
    };

    const poll = async () => {
      try {
        const res = await fetch(`/api/events/${eventId}/activity`);
        if (!res.ok) return;
        const data: ActivityEntry[] = await res.json();
        setActivities(data);

        if (!firstPoll.current) {
          if (data.length > 0) lastSeenId.current = data[0].id;
          firstPoll.current = true;
          return;
        }

        // Find new entries since last poll
        const lastIdx = data.findIndex(a => a.id === lastSeenId.current);
        const newEntries = lastIdx > 0 ? data.slice(0, lastIdx) : lastIdx === -1 ? data : [];
        if (newEntries.length === 0) return;

        lastSeenId.current = data[0].id;
        const others = newEntries.filter(a => a.actor !== myName.current);
        if (others.length > 0) {
          setToasts(prev => [...others, ...prev].slice(0, 4));
          await applySchedule();
        }
      } catch { /* ignore */ }
    };

    poll();
    const iv = setInterval(poll, 8000);
    return () => clearInterval(iv);
  }, [liveReady, eventId]);

  // ── Auto-dismiss toasts ──
  useEffect(() => {
    if (toasts.length === 0) return;
    const t = setTimeout(() => setToasts(prev => prev.slice(0, -1)), 5000);
    return () => clearTimeout(t);
  }, [toasts]);

  // ── Log activity ──
  const logActivity = useCallback((action: string) => {
    fetch(`/api/events/${eventId}/activity`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ actor: myName.current, action }),
    }).catch(() => {});
  }, [eventId]);

  // ── Derived ──
  const activeSlots        = useMemo(() => event?.slots?.length      ? event.slots      : SLOTS,                          [event]);
  const activeLunchIndices = useMemo(() => event?.lunchSlots?.length ? new Set(event.lunchSlots) : LUNCH_SLOT_INDICES, [event]);
  const activeBreaks       = useMemo(() => (event?.breaks ?? []).map(b => ({
    ...b,
    slotIndices: new Set(activeSlots.map((s, i) => (s >= b.from && s < b.to ? i : -1)).filter(i => i >= 0)),
  })), [event, activeSlots]);
  const allBlockedIndices  = useMemo(() => {
    const s = new Set(activeLunchIndices);
    for (const b of activeBreaks) b.slotIndices.forEach(i => s.add(i));
    return s;
  }, [activeLunchIndices, activeBreaks]);
  const clashMap           = useMemo(() => buildClashMap(placements, sessions, people), [placements, sessions, people]);

  const teamOf    = (id: string) => teams.find(t => t.id === id);
  const sessionOf = (id: string) => sessions.find(s => s.id === id);
  const placementAt = (roomId: string, day: string, slotIdx: number) =>
    placements.find(p => p.roomId === roomId && p.day === day && p.slotIdx === slotIdx);
  const isBlockedCell = (roomId: string, day: string, slotIdx: number) =>
    blocked.some(b => b.roomId === roomId && b.day === day && b.slotIdx === slotIdx);
  const blockedAt = (roomId: string, day: string, slotIdx: number) =>
    blocked.find(b => b.roomId === roomId && b.day === day && b.slotIdx === slotIdx);

  const unplacedSessions = sessions.filter(s => !placements.some(p => p.sessionId === s.id));

  // ── Session actions ──
  const addSession = (name: string, teamId: string, notes: string, attendeeIds: string[], crossTeam: boolean, placeAt?: { roomId: string; day: string; slotIdx: number }) => {
    if (!name.trim() || !teamId) return;
    const id = uid();
    setSessions(prev => [...prev, { id, name: name.trim(), notes: notes.trim(), crossTeam, teamId, attendeeIds }]);
    if (placeAt) {
      setPlacements(prev => [...prev.filter(p => !(p.roomId === placeAt.roomId && p.day === placeAt.day && p.slotIdx === placeAt.slotIdx)), {
        id: uid(), sessionId: id, roomId: placeAt.roomId, day: placeAt.day, slotIdx: placeAt.slotIdx,
      }]);
      const room = rooms.find(r => r.id === placeAt.roomId);
      logActivity(`Scheduled '${name.trim()}' in ${room?.name ?? "a room"} at ${activeSlots[placeAt.slotIdx]}`);
    } else {
      logActivity(`Added session '${name.trim()}'`);
    }
  };

  const removeSession = (id: string) => {
    const sess = sessions.find(s => s.id === id);
    setSessions(prev => prev.filter(s => s.id !== id));
    setPlacements(prev => prev.filter(p => p.sessionId !== id));
    if (sess) logActivity(`Removed session '${sess.name}'`);
  };

  const saveEdit = () => {
    if (!editSession) return;
    setSessions(prev => prev.map(s => s.id === editSession.id ? editSession : s));
    logActivity(`Edited session '${editSession.name}'`);
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
    setTeams(prev => [...prev, { id: uid(), name: newTeamName.trim(), colorIdx: prev.length % TEAM_COLORS.length, roomId: newTeamRoom || null }]);
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
    setSessions(prev => prev.map(s => ({ ...s, attendeeIds: s.attendeeIds.filter(a => a !== id) })));
  };

  // ── Drag & drop ──
  const handleDrop = (roomId: string, day: string, slotIdx: number) => {
    if (allBlockedIndices.has(slotIdx)) return;

    // Moving a blocked slot
    const bId = draggingBlockedId.current;
    if (bId) {
      if (!placementAt(roomId, day, slotIdx) && !isBlockedCell(roomId, day, slotIdx)) {
        setBlocked(prev => [
          ...prev.filter(b => b.id !== bId),
          { id: uid(), roomId, day, slotIdx },
        ]);
      }
      draggingBlockedId.current = null;
      setDragOverCell(null);
      return;
    }

    // Moving a session
    const id = draggingSessionId.current;
    if (!id || isBlockedCell(roomId, day, slotIdx)) return;
    const sess = sessions.find(s => s.id === id);
    const room = rooms.find(r => r.id === roomId);
    setPlacements(prev => [
      ...prev.filter(p => p.sessionId !== id && !(p.roomId === roomId && p.day === day && p.slotIdx === slotIdx)),
      { id: uid(), sessionId: id, roomId, day, slotIdx },
    ]);
    if (sess && room) logActivity(`Moved '${sess.name}' → ${room.name} at ${activeSlots[slotIdx]}`);
    draggingSessionId.current = null;
    setDragOverCell(null);
  };

  const handleRemovePlacement = (placementId: string) => {
    const pl = placements.find(p => p.id === placementId);
    const sess = pl ? sessions.find(s => s.id === pl.sessionId) : null;
    setPlacements(prev => prev.filter(p => p.id !== placementId));
    if (sess) logActivity(`Unscheduled '${sess.name}'`);
  };

  const toggleBlocked = (roomId: string, day: string, slotIdx: number) => {
    if (placementAt(roomId, day, slotIdx) || allBlockedIndices.has(slotIdx)) return;
    const room = rooms.find(r => r.id === roomId);
    const exists = blocked.find(b => b.roomId === roomId && b.day === day && b.slotIdx === slotIdx);
    setBlocked(prev => {
      if (exists) return prev.filter(b => b.id !== exists.id);
      return [...prev, { id: uid(), roomId, day, slotIdx }];
    });
    if (room) logActivity(exists
      ? `Cleared unavailable: ${room.name} at ${activeSlots[slotIdx]}`
      : `Marked ${room.name} at ${activeSlots[slotIdx]} as unavailable`);
  };

  // ── Cell click ──
  const openCellModal = (roomId: string, day: string, slotIdx: number) => {
    setCellModal({ roomId, day, slotIdx });
    setCellStep("choose");
    setCellSessName(""); setCellSessTeam(""); setCellSessNotes("");
    setCellSessAttendees([]); setCellAttendeeInput("");
  };

  const closeCellModal = () => { setCellModal(null); setCellStep("choose"); setCellSessCrossTeam(false); };

  const submitCellSession = () => {
    if (!cellModal || !cellSessName.trim() || !cellSessTeam) return;
    addSession(cellSessName, cellSessTeam, cellSessNotes, cellSessAttendees, cellSessCrossTeam, cellModal);
    closeCellModal();
  };

  // ── Attendee input handler (shared) ──
  const handleAttendeeInput = (
    val: string,
    setInput: (v: string) => void,
    setIds: (fn: (prev: string[]) => string[]) => void,
  ) => {
    if (val.startsWith("__select__")) {
      setIds(prev => [...prev, val.replace("__select__", "")]);
      setInput("");
    } else {
      setInput(val);
    }
  };

  // ── Auto-schedule ──
  const autoSchedule = () => {
    if (!event) return;

    // Remove any placements that are currently involved in a clash
    const currentClashes = buildClashMap(placements, sessions, people);
    const clashingIds = new Set(currentClashes.keys());
    const keptPlacements = placements.filter(p => !clashingIds.has(p.id));
    const newPl: Placement[] = [...keptPlacements];

    // Schedule: unplaced sessions + those evicted due to clashes
    const placedSessionIds = new Set(newPl.map(p => p.sessionId));
    const toPlace = sessions.filter(s => !placedSessionIds.has(s.id));

    const personBusy = (pid: string, day: string, slotIdx: number) =>
      newPl.some(pl => {
        const s = sessions.find(s => s.id === pl.sessionId);
        return pl.day === day && pl.slotIdx === slotIdx && s?.attendeeIds.includes(pid);
      });
    const roomBusy = (roomId: string, day: string, slotIdx: number) =>
      newPl.some(pl => pl.roomId === roomId && pl.day === day && pl.slotIdx === slotIdx);
    const isBlk = (roomId: string, day: string, slotIdx: number) =>
      blocked.some(b => b.roomId === roomId && b.day === day && b.slotIdx === slotIdx);

    for (const session of toPlace) {
      let placed = false;
      const homeRoomId = teams.find(t => t.id === session.teamId)?.roomId;
      const orderedRooms = homeRoomId
        ? [rooms.find(r => r.id === homeRoomId)!, ...rooms.filter(r => r.id !== homeRoomId)].filter(Boolean)
        : rooms;

      // Room is the outermost loop — always fill the home room before trying others
      for (const room of orderedRooms) {
        if (placed) break;
        for (const day of event.days) {
          if (placed) break;
          for (let slotIdx = 0; slotIdx < activeSlots.length; slotIdx++) {
            if (allBlockedIndices.has(slotIdx)) continue;
            if (roomBusy(room.id, day, slotIdx)) continue;
            if (isBlk(room.id, day, slotIdx)) continue;
            if (session.attendeeIds.some(pid => personBusy(pid, day, slotIdx))) continue;
            newPl.push({ id: uid(), sessionId: session.id, roomId: room.id, day, slotIdx });
            placed = true;
            break;
          }
        }
      }
    }
    const scheduled = newPl.length - keptPlacements.length;
    setPlacements(newPl);
    logActivity(`Auto-scheduled ${scheduled} session${scheduled !== 1 ? "s" : ""}`);
  };

  // ── CSV Export ──
  const exportCSV = () => {
    if (!event) return;
    const rows = [["Day", "Time", "Room", "Session", "Team", "Attendees", "Notes"]];
    for (const day of event.days) {
      for (let slotIdx = 0; slotIdx < activeSlots.length; slotIdx++) {
        if (allBlockedIndices.has(slotIdx)) continue;
        for (const room of rooms) {
          const p = placementAt(room.id, day, slotIdx);
          if (!p) continue;
          const sess = sessionOf(p.sessionId);
          if (!sess) continue;
          const team = teamOf(sess.teamId);
          const attendees = people.filter(pe => sess.attendeeIds.includes(pe.id)).map(pe => pe.name).join("; ");
          rows.push([formatDayFull(day), activeSlots[slotIdx], room.name, sess.name, team?.name ?? "", attendees, sess.notes]);
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

  // ── PDF Export ──
  const exportPDF = () => {
    if (!event) return;
    let html = `<!DOCTYPE html><html><head><meta charset="utf-8"><title>${event.name}</title><style>
      * { box-sizing: border-box; margin: 0; padding: 0; }
      body { font-family: Arial, sans-serif; font-size: 11px; padding: 20px; color: #1e293b; }
      h1 { font-size: 18px; font-weight: 700; margin-bottom: 2px; }
      .subtitle { color: #94a3b8; font-size: 10px; margin-bottom: 4px; }
      h2 { font-size: 13px; font-weight: 600; margin: 20px 0 6px; color: #475569; border-bottom: 1px solid #e2e8f0; padding-bottom: 4px; }
      table { border-collapse: collapse; width: 100%; table-layout: fixed; }
      th { background: #f8fafc; border: 1px solid #cbd5e1; padding: 6px 8px; text-align: left; font-size: 9px; text-transform: uppercase; letter-spacing: 0.06em; color: #64748b; }
      th .team-name { font-weight: 400; color: #94a3b8; display: block; text-transform: none; letter-spacing: 0; font-size: 9px; }
      td { border: 1px solid #e2e8f0; padding: 3px 5px; vertical-align: top; }
      .time-cell { width: 52px; color: #94a3b8; font-size: 10px; white-space: nowrap; background: #f8fafc; }
      .lunch-cell { background: #fafafa; color: #94a3b8; font-style: italic; text-align: center; padding: 8px; font-size: 10px; }
      .blocked-cell { background: #f1f5f9; color: #cbd5e1; font-size: 9px; text-align: center; }
      .sess-name { font-weight: 600; font-size: 11px; }
      .sess-team { font-size: 9px; color: #64748b; margin-top: 1px; }
      .sess-people { font-size: 9px; color: #64748b; margin-top: 2px; }
      .sess-clash { color: #ef4444; font-size: 9px; font-weight: 600; margin-top: 2px; }
      .sess-notes { font-size: 9px; color: #94a3b8; font-style: italic; margin-top: 2px; }
      @media print { @page { margin: 15mm; size: A3 landscape; } h2 { page-break-before: auto; } }
    </style></head><body>`;

    html += `<h1>${event.name}</h1>
    <p class="subtitle">Generated ${new Date().toLocaleDateString("en-GB", { weekday: "long", day: "numeric", month: "long", year: "numeric" })}</p>`;

    for (const day of event.days) {
      html += `<h2>${formatDayFull(day)}</h2><table><thead><tr>`;
      html += `<th style="width:52px">Time</th>`;
      for (const room of rooms) {
        const homeTeam = teams.find(t => t.roomId === room.id);
        html += `<th>${room.name}${homeTeam ? `<span class="team-name">${homeTeam.name}</span>` : ""}</th>`;
      }
      html += `</tr></thead><tbody>`;

      let lunchRendered = false;
      const renderedBreaksPdf = new Set<string>();
      for (let slotIdx = 0; slotIdx < activeSlots.length; slotIdx++) {
        if (activeLunchIndices.has(slotIdx)) {
          if (!lunchRendered) {
            const lunchStart = activeSlots[Math.min(...[...activeLunchIndices])] ?? "12:00";
            const lunchEndIdx = Math.max(...[...activeLunchIndices]);
            const [lh, lm] = (activeSlots[lunchEndIdx] ?? "12:30").split(":").map(Number);
            const lunchEnd = `${String(Math.floor((lh * 60 + lm + 30) / 60)).padStart(2,"0")}:${String((lh * 60 + lm + 30) % 60).padStart(2,"0")}`;
            { const lc = event?.lunchColor ?? "#fef3c7"; const lt = darkenHex(lc); html += `<tr><td class="time-cell" style="background:${lc};color:${lt}">${lunchStart}</td><td colspan="${rooms.length}" class="lunch-cell" style="background:${lc};color:${lt}">${event?.lunchLabel ?? "Lunch Break"} (${lunchStart}–${lunchEnd})</td></tr>`; }
            lunchRendered = true;
          }
          continue;
        }
        const breakMatch = activeBreaks.find(b => b.slotIndices.has(slotIdx));
        if (breakMatch) {
          if (!renderedBreaksPdf.has(breakMatch.label)) {
            { const bc = breakMatch.color ?? "#fed7aa"; const bct = darkenHex(bc); html += `<tr><td class="time-cell" style="background:${bc};color:${bct}">${breakMatch.from}</td><td colspan="${rooms.length}" class="lunch-cell" style="background:${bc};color:${bct}">${breakMatch.label} (${breakMatch.from}–${breakMatch.to})</td></tr>`; }
            renderedBreaksPdf.add(breakMatch.label);
          }
          continue;
        }
        html += `<tr><td class="time-cell">${activeSlots[slotIdx]}</td>`;
        for (const room of rooms) {
          const p    = placements.find(pl => pl.roomId === room.id && pl.day === day && pl.slotIdx === slotIdx);
          const isBlk = blocked.some(b => b.roomId === room.id && b.day === day && b.slotIdx === slotIdx);
          if (isBlk) {
            html += `<td class="blocked-cell">Unavailable</td>`;
          } else if (p) {
            const sess = sessions.find(s => s.id === p.sessionId);
            if (sess) {
              const team     = teams.find(t => t.id === sess.teamId);
              const color    = sess.crossTeam ? (team ? TEAM_COLORS[team.colorIdx % TEAM_COLORS.length].hex : "#f8fafc") : GREY.hex;
              const attNames = people.filter(pe => sess.attendeeIds.includes(pe.id)).map(pe => pe.name).join(", ");
              const clash    = clashMap.get(p.id);
              html += `<td style="background:${color}">`;
              html += `<div class="sess-name">${sess.name}</div>`;
              if (team) html += `<div class="sess-team">${team.name}</div>`;
              if (attNames) html += `<div class="sess-people">${attNames}</div>`;
              if (clash?.length) html += `<div class="sess-clash">⚠ ${clash.join(", ")}</div>`;
              if (sess.notes) html += `<div class="sess-notes">${sess.notes}</div>`;
              html += `</td>`;
            } else {
              html += `<td></td>`;
            }
          } else {
            html += `<td></td>`;
          }
        }
        html += `</tr>`;
      }
      html += `</tbody></table>`;
    }
    html += `</body></html>`;

    const win = window.open("", "_blank");
    if (win) { win.document.write(html); win.document.close(); setTimeout(() => win.print(), 400); }
  };

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
            <button onClick={() => router.push("/")} className="text-slate-400 hover:text-slate-700 text-sm transition-all active:scale-95 select-none">
              ← Back
            </button>
            <div className="h-4 w-px bg-slate-200" />
            <div>
              <h1 className="text-base font-bold text-slate-900 leading-tight">{event.name}</h1>
              <p className="text-[10px] text-slate-400">Increment Planning Scheduler</p>
            </div>
          </div>
          <div className="flex items-center gap-2">
            {/* Live presence + activity */}
            {(() => {
              const recentActors = [...new Map(
                activities
                  .filter(a => Date.now() - new Date(a.createdAt).getTime() < 5 * 60 * 1000)
                  .map(a => [a.actor, a])
              ).values()].slice(0, 5);
              return (
                <button
                  onClick={() => setShowActivity(v => !v)}
                  className={`flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg border transition-all text-xs font-medium active:scale-95 select-none ${
                    showActivity ? "bg-emerald-50 border-emerald-300 text-emerald-700 active:bg-emerald-100" : "border-slate-200 text-slate-500 hover:border-emerald-300 hover:text-emerald-600 active:bg-slate-100"
                  }`}
                >
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  <span>Live</span>
                  {recentActors.length > 0 && (
                    <span className="flex -space-x-1 ml-0.5">
                      {recentActors.map(a => (
                        <span key={a.actor} title={a.actor}
                          className="w-5 h-5 rounded-full bg-indigo-100 border border-white flex items-center justify-center text-[9px] font-bold text-indigo-600">
                          {initials(a.actor)}
                        </span>
                      ))}
                    </span>
                  )}
                </button>
              );
            })()}
            {/* Name pill */}
            {editingName ? (
              <form onSubmit={e => { e.preventDefault(); const n = nameInput.trim() || "Anonymous"; setPlannerName(n); myName.current = n; localStorage.setItem("plannerName", n); setEditingName(false); }} className="flex gap-1">
                <input autoFocus value={nameInput} onChange={e => setNameInput(e.target.value)} placeholder="Your name"
                  className="border border-indigo-300 rounded-lg px-2 py-1 text-xs text-slate-900 w-28 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                <button type="submit" className="text-xs bg-indigo-600 text-white px-2 py-1 rounded-lg">✓</button>
                <button type="button" onClick={() => setEditingName(false)} className="text-xs text-slate-400 hover:text-slate-700 px-1">✕</button>
              </form>
            ) : (
              <button onClick={() => { setNameInput(plannerName === "Anonymous" ? "" : plannerName); setEditingName(true); }}
                className="flex items-center gap-1.5 text-xs text-slate-500 hover:text-slate-800 border border-slate-200 hover:border-slate-400 px-2.5 py-1.5 rounded-lg transition-colors">
                <span className="w-4 h-4 rounded-full bg-indigo-100 flex items-center justify-center text-[9px] font-bold text-indigo-600">{initials(plannerName)}</span>
                {plannerName}
              </button>
            )}
            <div className="h-4 w-px bg-slate-200" />
            <span className={`text-xs font-medium ${
              saveStatus === "saved" ? "text-emerald-600" : saveStatus === "saving" ? "text-amber-500" : "text-slate-400"
            }`}>
              {saveStatus === "saved" ? "✓ Saved" : saveStatus === "saving" ? "Saving…" : "Unsaved"}
            </span>
            <button
              onClick={() => {
                const nonLunch = activeSlots.filter((_, i) => !activeLunchIndices.has(i));
                setEditStartTime(nonLunch[0] ?? "09:00");
                setEditEndTime(nonLunch[nonLunch.length - 1] ?? "16:30");
                const dur = nonLunch.length >= 2
                  ? (() => { const [h1,m1] = nonLunch[0].split(":").map(Number); const [h2,m2] = nonLunch[1].split(":").map(Number); return (h2*60+m2)-(h1*60+m1); })()
                  : 30;
                setEditSlotDuration(dur);
                const lunchTimes = [...activeLunchIndices].sort((a,b)=>a-b).map(i => activeSlots[i]).filter(Boolean);
                const hasLunch = lunchTimes.length > 0;
                setEditHasLunch(hasLunch);
                if (hasLunch) {
                  setEditLunchStart(lunchTimes[0]);
                  const [lh,lm] = lunchTimes[lunchTimes.length-1].split(":").map(Number);
                  const endMins = lh*60+lm+dur;
                  setEditLunchEnd(`${String(Math.floor(endMins/60)).padStart(2,"0")}:${String(endMins%60).padStart(2,"0")}`);
                }
                setEditLunchLabel(event?.lunchLabel ?? "Lunch Break");
                setEditLunchColor(event?.lunchColor ?? "#fef3c7");
                setEditBreaks(event?.breaks ?? []);
                setNewBreakLabel(""); setNewBreakFrom("10:30"); setNewBreakTo("11:00"); setNewBreakColor("#fed7aa");
                setShowSlotEditor(true);
              }}
              className="text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-300 hover:border-slate-400 px-3 py-1.5 rounded-lg transition-all active:scale-95 active:bg-slate-100 select-none"
            >
              Edit Times
            </button>
            <button
              onClick={() => autoSchedule()}
              className="text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-300 hover:border-slate-400 px-3 py-1.5 rounded-lg transition-all active:scale-95 active:bg-slate-100 select-none"
            >
              Auto-Schedule
            </button>
            <button onClick={exportCSV} className="text-xs text-slate-600 hover:text-slate-900 hover:bg-slate-50 border border-slate-300 hover:border-slate-400 px-3 py-1.5 rounded-lg transition-all active:scale-95 active:bg-slate-100 select-none">
              Export CSV
            </button>
            <button onClick={exportPDF} className="text-xs text-white bg-indigo-600 hover:bg-indigo-500 active:bg-indigo-700 active:scale-95 px-3 py-1.5 rounded-lg transition-all font-medium select-none">
              Export PDF
            </button>
          </div>
        </div>
      </header>

      <div className="flex flex-1 overflow-hidden max-w-[1600px] mx-auto w-full px-4 py-4 gap-4">

        {/* ── Left Panel ── */}
        <aside className="w-72 shrink-0 flex flex-col gap-3 overflow-y-auto">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-1 flex gap-1">
            <button onClick={() => setTab("sessions")} className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${tab === "sessions" ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800"}`}>Sessions</button>
            <button onClick={() => setTab("teams")}    className={`flex-1 text-xs font-semibold py-1.5 rounded-lg transition-colors ${tab === "teams"    ? "bg-indigo-600 text-white" : "text-slate-500 hover:text-slate-800"}`}>Teams & People</button>
          </div>

          {tab === "sessions" ? (
            <>
              <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                <div className="flex items-center justify-between mb-3">
                  <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide">Unscheduled</h2>
                  <button onClick={() => setShowAddSession(v => !v)} className="text-xs text-indigo-600 hover:text-indigo-800 font-semibold">
                    {showAddSession ? "Cancel" : "+ Add"}
                  </button>
                </div>

                {showAddSession && (
                  <div className="mb-3 space-y-2 pb-3 border-b border-slate-100">
                    <input value={newSessName} onChange={e => setNewSessName(e.target.value)} placeholder="Session name"
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                    <select value={newSessTeam} onChange={e => setNewSessTeam(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400">
                      <option value="">Select team…</option>
                      {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                    </select>
                    <textarea value={newSessNotes} onChange={e => setNewSessNotes(e.target.value)} placeholder="Notes (optional)" rows={2}
                      className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
                    <AttendeeSelector
                      value={attendeeInput}
                      onChange={v => handleAttendeeInput(v, setAttendeeInput, setNewSessAttendees)}
                      people={people} currentIds={newSessAttendees}
                    />
                    {newSessAttendees.length > 0 && (
                      <div className="flex flex-wrap gap-1">
                        {newSessAttendees.map(id => { const p = people.find(pe => pe.id === id); return p ? (
                          <span key={id} className="bg-indigo-100 text-indigo-700 text-[10px] px-1.5 py-0.5 rounded-full flex items-center gap-1">
                            {p.name}<button onClick={() => setNewSessAttendees(prev => prev.filter(a => a !== id))} className="text-indigo-400 hover:text-indigo-700">×</button>
                          </span>
                        ) : null; })}
                      </div>
                    )}
                    <label className="flex items-center gap-2 cursor-pointer select-none">
                      <input type="checkbox" checked={newSessCrossTeam} onChange={e => setNewSessCrossTeam(e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
                      <span className="text-xs text-slate-600">Cross-team session</span>
                    </label>
                    <button
                      onClick={() => { addSession(newSessName, newSessTeam, newSessNotes, newSessAttendees, newSessCrossTeam); setNewSessName(""); setNewSessTeam(""); setNewSessNotes(""); setNewSessAttendees([]); setNewSessCrossTeam(false); setAttendeeInput(""); setShowAddSession(false); }}
                      disabled={!newSessName.trim() || !newSessTeam}
                      className="w-full bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 text-white text-xs font-semibold py-1.5 rounded-lg transition-colors"
                    >Add Session</button>
                  </div>
                )}

                <div className="space-y-2">
                  {unplacedSessions.length === 0 && <p className="text-xs text-slate-400 italic text-center py-2">All sessions scheduled!</p>}
                  {unplacedSessions.map(s => (
                    <div key={s.id} className="relative group">
                      <SessionCard session={s} team={teamOf(s.teamId)} people={people}
                        expanded={expandedSessions.has(s.id)}
                        onToggleExpand={() => setExpandedSessions(prev => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
                        onDragStart={id => { draggingSessionId.current = id; }} />
                      <div className="absolute top-1 right-6 hidden group-hover:flex gap-0.5">
                        <button onClick={() => setEditSession(s)} className="text-[10px] text-slate-400 hover:text-indigo-600 px-1">✎</button>
                        <button onClick={() => { if (confirm(`Delete "${s.name}"? This cannot be undone.`)) removeSession(s.id); }} className="text-[10px] text-slate-400 hover:text-red-500 px-1">✕</button>
                      </div>
                    </div>
                  ))}
                </div>
              </div>

              {placements.length > 0 && (
                <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-4">
                  <h2 className="text-xs font-semibold text-slate-700 uppercase tracking-wide mb-3">Scheduled</h2>
                  <div className="space-y-2">
                    {sessions.filter(s => placements.some(p => p.sessionId === s.id)).map(s => {
                      const p = placements.find(pl => pl.sessionId === s.id)!;
                      const room = rooms.find(r => r.id === p.roomId);
                      return (
                        <div key={s.id} className="relative group">
                          <SessionCard session={s} team={teamOf(s.teamId)} people={people} clash={clashMap.get(p.id)}
                            expanded={expandedSessions.has(s.id)}
                            onToggleExpand={() => setExpandedSessions(prev => { const n = new Set(prev); n.has(s.id) ? n.delete(s.id) : n.add(s.id); return n; })}
                            onDragStart={id => { draggingSessionId.current = id; }} />
                          <p className="text-[10px] text-slate-400 mt-0.5">{formatDayTab(p.day)} · {activeSlots[p.slotIdx]} · {room?.name}</p>
                          <div className="absolute top-1 right-1 hidden group-hover:flex gap-0.5">
                            <button onClick={() => setEditSession(s)} className="text-[10px] text-slate-400 hover:text-indigo-600 px-1">✎</button>
                            <button onClick={() => { if (confirm(`Delete "${s.name}"? This cannot be undone.`)) removeSession(s.id); }} className="text-[10px] text-slate-400 hover:text-red-500 px-1">✕</button>
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
                  <input value={newRoomName} onChange={e => setNewRoomName(e.target.value)} onKeyDown={e => e.key === "Enter" && addRoom()} placeholder="Room name"
                    className="flex-1 border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
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
                  <input value={newTeamName} onChange={e => setNewTeamName(e.target.value)} placeholder="Team name"
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  <select value={newTeamRoom} onChange={e => setNewTeamRoom(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400">
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
                  const c = TEAM_COLORS[team.colorIdx % TEAM_COLORS.length];
                  return (
                    <div key={team.id} className="mb-3">
                      <p className={`text-[10px] font-semibold uppercase tracking-wide mb-1 ${c.text}`}>{team.name}</p>
                      {people.filter(p => p.teamId === team.id).map(p => (
                        <div key={p.id} className="flex items-center justify-between group pl-2">
                          <span className="text-xs text-slate-700">{p.name}</span>
                          <button onClick={() => removePerson(p.id)} className="text-slate-300 hover:text-red-500 text-xs opacity-0 group-hover:opacity-100 transition-opacity">✕</button>
                        </div>
                      ))}
                    </div>
                  );
                })}
                <div className="space-y-1.5 pt-2 border-t border-slate-100">
                  <input value={newPersonName} onChange={e => setNewPersonName(e.target.value)} onKeyDown={e => e.key === "Enter" && addPerson()}
                    placeholder="Person name" list="person-suggestions"
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  <datalist id="person-suggestions">{people.map(p => <option key={p.id} value={p.name} />)}</datalist>
                  <select value={newPersonTeam} onChange={e => setNewPersonTeam(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-2.5 py-1.5 text-xs text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400">
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
          <div className="flex gap-2 mb-3 shrink-0 flex-wrap">
            {event.days.map((day, i) => (
              <button key={day} onClick={() => setActiveDay(i)}
                className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                  activeDay === i ? "bg-indigo-600 text-white shadow-sm" : "bg-white text-slate-600 border border-slate-200 hover:border-indigo-300 hover:text-indigo-600"
                }`}>
                {formatDayTab(day)}
              </button>
            ))}
          </div>

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
                    {rooms.map(room => {
                      const homeTeam = teams.find(t => t.roomId === room.id);
                      const c = homeTeam ? TEAM_COLORS[homeTeam.colorIdx % TEAM_COLORS.length] : null;
                      return (
                        <th key={room.id} className="bg-slate-50 border-b border-r border-slate-200 px-3 py-2 text-left min-w-[160px]">
                          <span className="text-[10px] font-semibold text-slate-700 uppercase tracking-wide block">{room.name}</span>
                          {homeTeam && c && (
                            <span className={`text-[10px] font-medium ${c.text} flex items-center gap-1 mt-0.5`}>
                              <span className={`w-1.5 h-1.5 rounded-full ${c.dot} shrink-0`} />
                              {homeTeam.name}
                            </span>
                          )}
                        </th>
                      );
                    })}
                  </tr>
                </thead>
                <tbody>
                  {(() => {
                    const rows = [];
                    let lunchRendered = false;
                    const renderedBreaks = new Set<string>();
                    for (let slotIdx = 0; slotIdx < activeSlots.length; slotIdx++) {
                      const slot = activeSlots[slotIdx];
                      if (activeLunchIndices.has(slotIdx)) {
                        if (!lunchRendered) {
                          const lunchStart = activeSlots[Math.min(...[...activeLunchIndices])] ?? "12:00";
                          const lunchEndIdx = Math.max(...[...activeLunchIndices]);
                          const [lh, lm] = (activeSlots[lunchEndIdx] ?? "12:30").split(":").map(Number);
                          const lunchEnd = `${String(Math.floor((lh * 60 + lm + 30) / 60)).padStart(2,"0")}:${String((lh * 60 + lm + 30) % 60).padStart(2,"0")}`;
                          const lc = event?.lunchColor ?? "#fef3c7";
                          const lt = darkenHex(lc);
                          rows.push(
                            <tr key="lunch">
                              <td className="sticky left-0 border-b border-r px-3 py-2 text-[10px] font-medium z-10 whitespace-nowrap" style={{ background: lc, color: lt, borderColor: lt + "33" }}>
                                {lunchStart}
                              </td>
                              <td colSpan={rooms.length} className="border-b text-center text-xs font-medium py-2 select-none" style={{ background: lc, color: lt, borderColor: lt + "33" }}>
                                {event?.lunchLabel ?? "Lunch Break"} ({lunchStart}–{lunchEnd})
                              </td>
                            </tr>
                          );
                          lunchRendered = true;
                        }
                        continue;
                      }
                      const breakMatch = activeBreaks.find(b => b.slotIndices.has(slotIdx));
                      if (breakMatch) {
                        if (!renderedBreaks.has(breakMatch.label)) {
                          const bc = breakMatch.color ?? "#fed7aa";
                          const bt = darkenHex(bc);
                          rows.push(
                            <tr key={`break-${breakMatch.label}`}>
                              <td className="sticky left-0 border-b border-r px-3 py-2 text-[10px] font-medium z-10 whitespace-nowrap" style={{ background: bc, color: bt, borderColor: bt + "33" }}>
                                {breakMatch.from}
                              </td>
                              <td colSpan={rooms.length} className="border-b text-center text-xs font-medium py-2 select-none" style={{ background: bc, color: bt, borderColor: bt + "33" }}>
                                {breakMatch.label} ({breakMatch.from}–{breakMatch.to})
                              </td>
                            </tr>
                          );
                          renderedBreaks.add(breakMatch.label);
                        }
                        continue;
                      }
                      rows.push(
                        <tr key={slot}>
                          <td className="sticky left-0 bg-white border-b border-r border-slate-100 px-3 py-1 text-[10px] font-medium text-slate-400 z-10 whitespace-nowrap">
                            {slot}
                          </td>
                          {rooms.map(room => {
                            const placement = placementAt(room.id, currentDay, slotIdx);
                            const blk       = blockedAt(room.id, currentDay, slotIdx);
                            const isBlk     = !!blk;
                            const session   = placement ? sessionOf(placement.sessionId) : null;
                            const clash     = placement ? clashMap.get(placement.id) : undefined;
                            const isOver    = dragOverCell?.roomId === room.id && dragOverCell?.day === currentDay && dragOverCell?.slotIdx === slotIdx;

                            return (
                              <td
                                key={room.id}
                                className={`border-b border-r border-slate-100 p-1 align-top transition-colors ${
                                  isBlk ? "bg-slate-100" : isOver ? "bg-indigo-50 cursor-copy" : "hover:bg-slate-50/60 cursor-pointer"
                                }`}
                                onDragOver={e => { e.preventDefault(); setDragOverCell({ roomId: room.id, day: currentDay, slotIdx }); }}
                                onDragLeave={() => setDragOverCell(null)}
                                onDrop={() => handleDrop(room.id, currentDay, slotIdx)}
                                onContextMenu={e => { e.preventDefault(); toggleBlocked(room.id, currentDay, slotIdx); }}
                                onClick={() => { if (!placement && !isBlk) openCellModal(room.id, currentDay, slotIdx); }}
                              >
                                {isBlk ? (
                                  <div
                                    draggable
                                    onDragStart={e => { e.stopPropagation(); draggingBlockedId.current = blk.id; draggingSessionId.current = null; }}
                                    onDragEnd={() => { draggingBlockedId.current = null; setDragOverCell(null); }}
                                    className="h-8 flex items-center justify-between px-1.5 cursor-grab active:cursor-grabbing group/blk"
                                  >
                                    <span className="text-[10px] text-slate-400 select-none">Unavailable</span>
                                    <button
                                      onClick={e => { e.stopPropagation(); toggleBlocked(room.id, currentDay, slotIdx); }}
                                      className="text-[10px] text-slate-300 hover:text-red-500 opacity-0 group-hover/blk:opacity-100 transition-opacity leading-none"
                                      title="Remove"
                                    >✕</button>
                                  </div>
                                ) : session && placement ? (
                                  <div className="relative group/cell">
                                    <SessionCard
                                      session={session} team={teamOf(session.teamId)} people={people} clash={clash}
                                      expanded={expandedSessions.has(session.id)}
                                      onToggleExpand={() => setExpandedSessions(prev => { const n = new Set(prev); n.has(session.id) ? n.delete(session.id) : n.add(session.id); return n; })}
                                      onDragStart={id => { draggingSessionId.current = id; }}
                                    />
                                    {clash && clash.length > 0 && (
                                      <p className="text-[10px] text-red-500 font-medium mt-0.5 px-1">⚠ {clash.join(", ")}</p>
                                    )}
                                    <button
                                      onClick={e => { e.stopPropagation(); handleRemovePlacement(placement.id); }}
                                      className="absolute top-1 right-1 text-[10px] text-slate-300 hover:text-red-500 opacity-0 group-hover/cell:opacity-100 transition-opacity"
                                    >✕</button>
                                  </div>
                                ) : (
                                  <div className="h-8 flex items-center justify-center opacity-0 hover:opacity-100 transition-opacity">
                                    <span className="text-[10px] text-slate-300">+ click to add</span>
                                  </div>
                                )}
                              </td>
                            );
                          })}
                        </tr>
                      );
                    }
                    return rows;
                  })()}
                </tbody>
              </table>
            )}
          </div>
          <p className="text-[10px] text-slate-400 mt-2 shrink-0">Click an empty cell to add a session or block it. Right-click to toggle unavailable. Drag sessions to reschedule.</p>
        </main>
      </div>

      {/* ── Slot Editor Modal ── */}
      {showSlotEditor && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={() => setShowSlotEditor(false)}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900 text-sm">Schedule Times</h2>
              <button onClick={() => setShowSlotEditor(false)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>

            <div className="px-5 py-4 space-y-4">
              {/* Day times */}
              <div className="space-y-3">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Day</p>
                <div className="grid grid-cols-2 gap-3">
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">Start</label>
                    <input type="time" value={editStartTime} onChange={e => setEditStartTime(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  </div>
                  <div>
                    <label className="block text-xs text-slate-500 mb-1">End</label>
                    <input type="time" value={editEndTime} onChange={e => setEditEndTime(e.target.value)}
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  </div>
                </div>
                <div>
                  <label className="block text-xs text-slate-500 mb-1">Slot size</label>
                  <select value={editSlotDuration} onChange={e => setEditSlotDuration(Number(e.target.value))}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value={15}>15 minutes</option>
                    <option value={30}>30 minutes</option>
                    <option value={60}>60 minutes</option>
                  </select>
                </div>
              </div>

              {/* Lunch break */}
              <div className="space-y-3 pt-3 border-t border-slate-100">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Lunch Break</p>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <input type="checkbox" checked={editHasLunch} onChange={e => setEditHasLunch(e.target.checked)}
                      className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
                    <span className="text-xs text-slate-500">Enabled</span>
                  </label>
                </div>
                {editHasLunch && (
                  <>
                    <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Label</label>
                        <input value={editLunchLabel} onChange={e => setEditLunchLabel(e.target.value)} placeholder="Lunch Break"
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">Colour</label>
                        <input type="color" value={editLunchColor} onChange={e => setEditLunchColor(e.target.value)}
                          className="h-[38px] w-10 rounded-lg border border-slate-300 p-0.5 cursor-pointer" />
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-3">
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">From</label>
                        <input type="time" value={editLunchStart} onChange={e => setEditLunchStart(e.target.value)}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                      </div>
                      <div>
                        <label className="block text-xs text-slate-500 mb-1">To</label>
                        <input type="time" value={editLunchEnd} onChange={e => setEditLunchEnd(e.target.value)}
                          className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                      </div>
                    </div>
                  </>
                )}
              </div>

              {/* Additional Breaks */}
              <div className="space-y-3 pt-3 border-t border-slate-100">
                <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">Additional Breaks</p>
                {editBreaks.map((b, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg px-3 py-2" style={{ background: b.color ?? "#fed7aa" }}>
                    <span className="w-3 h-3 rounded-full border border-white/50 shrink-0" style={{ background: darkenHex(b.color ?? "#fed7aa") }} />
                    <span className="flex-1 text-xs font-medium" style={{ color: darkenHex(b.color ?? "#fed7aa") }}>{b.label}</span>
                    <span className="text-xs opacity-60" style={{ color: darkenHex(b.color ?? "#fed7aa") }}>{b.from}–{b.to}</span>
                    <input type="color" value={b.color ?? "#fed7aa"}
                      onChange={e => setEditBreaks(prev => prev.map((x, j) => j === i ? { ...x, color: e.target.value } : x))}
                      className="h-5 w-5 rounded border-0 cursor-pointer p-0 shrink-0" title="Change colour" />
                    <button onClick={() => setEditBreaks(prev => prev.filter((_, j) => j !== i))}
                      className="text-xs opacity-50 hover:opacity-100 ml-1" style={{ color: darkenHex(b.color ?? "#fed7aa") }}>✕</button>
                  </div>
                ))}
                <div className="space-y-2 pt-1">
                  <div className="grid grid-cols-[1fr_auto] gap-2 items-end">
                    <input
                      value={newBreakLabel} onChange={e => setNewBreakLabel(e.target.value)}
                      placeholder="Break name (e.g. Tea Break)"
                      className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                    />
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">Colour</label>
                      <input type="color" value={newBreakColor} onChange={e => setNewBreakColor(e.target.value)}
                        className="h-[38px] w-10 rounded-lg border border-slate-300 p-0.5 cursor-pointer" />
                    </div>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">From</label>
                      <input type="time" value={newBreakFrom} onChange={e => setNewBreakFrom(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                    </div>
                    <div>
                      <label className="block text-xs text-slate-500 mb-1">To</label>
                      <input type="time" value={newBreakTo} onChange={e => setNewBreakTo(e.target.value)}
                        className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                    </div>
                  </div>
                  <button
                    onClick={() => {
                      if (!newBreakLabel.trim() || !newBreakFrom || !newBreakTo) return;
                      setEditBreaks(prev => [...prev, { label: newBreakLabel.trim(), from: newBreakFrom, to: newBreakTo, color: newBreakColor }]);
                      setNewBreakLabel(""); setNewBreakFrom("10:30"); setNewBreakTo("11:00"); setNewBreakColor("#fed7aa");
                    }}
                    disabled={!newBreakLabel.trim()}
                    className="w-full border border-dashed border-slate-300 hover:border-indigo-400 hover:text-indigo-600 disabled:opacity-40 text-slate-500 text-xs font-medium py-2 rounded-lg transition-colors"
                  >+ Add Break</button>
                </div>
              </div>
            </div>

            <div className="px-5 py-4 border-t border-slate-200 flex items-center justify-end gap-2">
              {slotSaveError && <p className="text-xs text-red-500 mr-auto">{slotSaveError}</p>}
              <button onClick={() => { setShowSlotEditor(false); setSlotSaveError(""); }} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
              <button
                disabled={savingSlots}
                onClick={async () => {
                  if (!event) return;
                  setSavingSlots(true);
                  // Generate slots from start/end/duration
                  const [sh, sm] = editStartTime.split(":").map(Number);
                  const [eh, em] = editEndTime.split(":").map(Number);
                  const newSlots: string[] = [];
                  let curr = sh * 60 + sm;
                  const endMins = eh * 60 + em;
                  while (curr <= endMins) {
                    newSlots.push(`${String(Math.floor(curr/60)).padStart(2,"0")}:${String(curr%60).padStart(2,"0")}`);
                    curr += editSlotDuration;
                  }
                  // Compute lunch slot indices
                  const newLunchSlots: number[] = editHasLunch
                    ? newSlots.map((s, i) => s >= editLunchStart && s < editLunchEnd ? i : -1).filter(i => i >= 0)
                    : [];
                  // Compute break slot indices (for clearing placements)
                  const newBreakSlotSet = new Set(
                    editBreaks.flatMap(b => newSlots.map((s, i) => (s >= b.from && s < b.to ? i : -1)).filter(i => i >= 0))
                  );
                  const newLunchSet = new Set(newLunchSlots);
                  const shouldClear = (idx: number) => idx >= newSlots.length || newLunchSet.has(idx) || newBreakSlotSet.has(idx);
                  setPlacements(prev => prev.filter(p => !shouldClear(p.slotIdx)));
                  setBlocked(prev => prev.filter(b => !shouldClear(b.slotIdx)));
                  setSlotSaveError("");
                  const res = await fetch(`/api/events/${event.id}`, {
                    method: "PATCH",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ slots: newSlots, lunchSlots: newLunchSlots, lunchLabel: editLunchLabel, lunchColor: editLunchColor, breaks: editBreaks }),
                  });
                  if (res.ok) {
                    setEvent(await res.json());
                    setSavingSlots(false);
                    setShowSlotEditor(false);
                  } else {
                    setSlotSaveError("Save failed — please try again.");
                    setSavingSlots(false);
                  }
                }}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
              >
                {savingSlots ? "Saving…" : "Save"}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Cell Click Modal ── */}
      {cellModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4" onClick={closeCellModal}>
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <div>
                <h2 className="font-semibold text-slate-900 text-sm">
                  {activeSlots[cellModal.slotIdx]} · {rooms.find(r => r.id === cellModal.roomId)?.name}
                </h2>
                <p className="text-[10px] text-slate-400">{formatDayFull(cellModal.day)}</p>
              </div>
              <button onClick={closeCellModal} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>

            {cellStep === "choose" ? (
              <div className="p-5 space-y-2">
                <button
                  onClick={() => setCellStep("form")}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-indigo-100 hover:border-indigo-400 hover:bg-indigo-50 transition-colors text-left"
                >
                  <span className="text-xl">📋</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Add Session</p>
                    <p className="text-xs text-slate-400">Create and schedule a new session here</p>
                  </div>
                </button>
                <button
                  onClick={() => { toggleBlocked(cellModal.roomId, cellModal.day, cellModal.slotIdx); closeCellModal(); }}
                  className="w-full flex items-center gap-3 px-4 py-3 rounded-xl border-2 border-slate-100 hover:border-slate-300 hover:bg-slate-50 transition-colors text-left"
                >
                  <span className="text-xl">🚫</span>
                  <div>
                    <p className="text-sm font-semibold text-slate-800">Mark as Unavailable</p>
                    <p className="text-xs text-slate-400">Block this slot so nothing can be scheduled</p>
                  </div>
                </button>
              </div>
            ) : (
              <>
                <div className="p-5 space-y-3">
                  <input value={cellSessName} onChange={e => setCellSessName(e.target.value)} placeholder="Session name" autoFocus
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
                  <select value={cellSessTeam} onChange={e => setCellSessTeam(e.target.value)}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400">
                    <option value="">Select team…</option>
                    {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
                  </select>
                  <textarea value={cellSessNotes} onChange={e => setCellSessNotes(e.target.value)} placeholder="Notes (optional)" rows={2}
                    className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
                  <AttendeeSelector
                    value={cellAttendeeInput}
                    onChange={v => handleAttendeeInput(v, setCellAttendeeInput, setCellSessAttendees)}
                    people={people} currentIds={cellSessAttendees}
                    inputClassName="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  />
                  {cellSessAttendees.length > 0 && (
                    <div className="flex flex-wrap gap-1.5">
                      {cellSessAttendees.map(id => { const p = people.find(pe => pe.id === id); return p ? (
                        <span key={id} className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                          {p.name}<button onClick={() => setCellSessAttendees(prev => prev.filter(a => a !== id))} className="text-indigo-400 hover:text-indigo-700">×</button>
                        </span>
                      ) : null; })}
                    </div>
                  )}
                </div>
                  <label className="flex items-center gap-2 cursor-pointer select-none">
                    <input type="checkbox" checked={cellSessCrossTeam} onChange={e => setCellSessCrossTeam(e.target.checked)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
                    <span className="text-sm text-slate-600">Cross-team session</span>
                  </label>
                <div className="px-5 py-4 border-t border-slate-200 flex justify-between gap-2">
                  <button onClick={() => setCellStep("choose")} className="text-sm text-slate-500 hover:text-slate-700">← Back</button>
                  <div className="flex gap-2">
                    <button onClick={closeCellModal} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800">Cancel</button>
                    <button onClick={submitCellSession} disabled={!cellSessName.trim() || !cellSessTeam}
                      className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors">
                      Add & Schedule
                    </button>
                  </div>
                </div>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── Edit Session Modal ── */}
      {editSession && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-sm">
            <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900 text-sm">Edit Session</h2>
              <button onClick={() => setEditSession(null)} className="text-slate-400 hover:text-slate-700">✕</button>
            </div>
            <div className="p-5 space-y-3">
              <input value={editSession.name} onChange={e => setEditSession(s => s ? { ...s, name: e.target.value } : s)} placeholder="Session name"
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400" />
              <select value={editSession.teamId} onChange={e => setEditSession(s => s ? { ...s, teamId: e.target.value } : s)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400">
                {teams.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <textarea value={editSession.notes} onChange={e => setEditSession(s => s ? { ...s, notes: e.target.value } : s)} placeholder="Notes" rows={2}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400 resize-none" />
              <label className="flex items-center gap-2 cursor-pointer select-none">
                <input type="checkbox" checked={editSession.crossTeam} onChange={e => setEditSession(s => s ? { ...s, crossTeam: e.target.checked } : s)} className="rounded border-slate-300 text-indigo-600 focus:ring-indigo-400" />
                <span className="text-sm text-slate-600">Cross-team session</span>
              </label>
              <div>
                <p className="text-xs font-medium text-slate-600 mb-1.5">Attendees</p>
                <AttendeeSelector
                  value={editAttendeeInput}
                  onChange={v => handleAttendeeInput(v, setEditAttendeeInput, ids => setEditSession(s => s ? { ...s, attendeeIds: ids(s.attendeeIds) } : s))}
                  people={people} currentIds={editSession.attendeeIds}
                  inputClassName="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm text-slate-900 focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
                <div className="flex flex-wrap gap-1.5 mt-2">
                  {editSession.attendeeIds.map(id => { const p = people.find(pe => pe.id === id); return p ? (
                    <span key={id} className="bg-indigo-100 text-indigo-700 text-xs px-2 py-0.5 rounded-full flex items-center gap-1">
                      {p.name}
                      <button onClick={() => setEditSession(s => s ? { ...s, attendeeIds: s.attendeeIds.filter(a => a !== id) } : s)} className="text-indigo-400 hover:text-indigo-700">×</button>
                    </span>
                  ) : null; })}
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

      {/* ── Live Activity Panel ── */}
      {showActivity && (
        <div className="fixed top-0 right-0 h-full w-80 bg-white border-l border-slate-200 shadow-2xl z-40 flex flex-col">
          <div className="flex items-center justify-between px-4 py-3 border-b border-slate-200 shrink-0">
            <div className="flex items-center gap-2">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
              <h2 className="text-sm font-semibold text-slate-900">Live Activity</h2>
            </div>
            <button onClick={() => setShowActivity(false)} className="text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button>
          </div>
          <div className="flex-1 overflow-y-auto p-3 space-y-2">
            {activities.length === 0 && (
              <p className="text-xs text-slate-400 text-center py-8">No activity yet</p>
            )}
            {activities.map(a => (
              <div key={a.id} className={`flex gap-2.5 p-2.5 rounded-xl ${a.actor === plannerName ? "bg-indigo-50" : "bg-slate-50"}`}>
                <span className="w-7 h-7 rounded-full bg-indigo-100 flex items-center justify-center text-[10px] font-bold text-indigo-600 shrink-0 mt-0.5">
                  {initials(a.actor)}
                </span>
                <div className="min-w-0">
                  <p className="text-[11px] font-semibold text-slate-700">{a.actor}</p>
                  <p className="text-[11px] text-slate-600 leading-snug">{a.action}</p>
                  <p className="text-[10px] text-slate-400 mt-0.5">{timeAgo(a.createdAt)}</p>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* ── Activity Toasts ── */}
      <div className="fixed bottom-4 right-4 z-50 flex flex-col-reverse gap-2 items-end pointer-events-none">
        {toasts.map(t => (
          <div key={t.id} className="bg-slate-900 text-white text-xs rounded-xl px-4 py-3 shadow-xl max-w-xs flex gap-2.5 items-start pointer-events-auto">
            <span className="w-6 h-6 rounded-full bg-indigo-400 flex items-center justify-center text-[9px] font-bold shrink-0 mt-0.5">
              {initials(t.actor)}
            </span>
            <div>
              <p className="font-semibold text-indigo-300">{t.actor}</p>
              <p className="text-slate-300">{t.action}</p>
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
