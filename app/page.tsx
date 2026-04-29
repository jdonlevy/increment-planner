"use client";

import { useState, useEffect, useCallback, useRef } from "react";

// ─── Types ────────────────────────────────────────────────────────────────────

type Person    = { id: string; name: string; teamId: string };
type Team      = { id: string; name: string; roomId: string; colorIdx: number };
type Room      = { id: string; name: string };
type Session   = { id: string; name: string; attendeeIds: string[]; notes: string };
type Placement = { id: string; sessionId: string; roomId: string; day: Day; slotIdx: number };
type Blocked   = { id: string; roomId: string; day: Day; slotIdx: number };
type Day       = "mon" | "tue" | "thu";
type Tab       = "schedule" | "sessions" | "people" | "rooms";
type Mode      = "place" | "block";

// ─── Constants ────────────────────────────────────────────────────────────────

const DAYS: { key: Day; label: string }[] = [
  { key: "mon", label: "Monday 18th May" },
  { key: "tue", label: "Tuesday 19th May" },
  { key: "thu", label: "Thursday 21st May" },
];

const SLOTS = [
  "09:00–10:00", "10:00–11:00", "11:00–12:00",
  "12:00–13:00", "13:00–14:00", "14:00–15:00",
  "15:15–16:15", "16:15–17:30",
];
const LUNCH_SLOT = 3;

const COLORS = [
  { pill: "bg-blue-500 text-white",    cell: "bg-blue-100 border-blue-400 text-blue-900"       },
  { pill: "bg-purple-500 text-white",  cell: "bg-purple-100 border-purple-400 text-purple-900" },
  { pill: "bg-amber-500 text-white",   cell: "bg-amber-100 border-amber-400 text-amber-900"    },
  { pill: "bg-rose-500 text-white",    cell: "bg-rose-100 border-rose-400 text-rose-900"       },
  { pill: "bg-emerald-500 text-white", cell: "bg-emerald-100 border-emerald-400 text-emerald-900" },
  { pill: "bg-cyan-500 text-white",    cell: "bg-cyan-100 border-cyan-400 text-cyan-900"       },
  { pill: "bg-orange-500 text-white",  cell: "bg-orange-100 border-orange-400 text-orange-900" },
  { pill: "bg-pink-500 text-white",    cell: "bg-pink-100 border-pink-400 text-pink-900"       },
  { pill: "bg-teal-500 text-white",    cell: "bg-teal-100 border-teal-400 text-teal-900"       },
  { pill: "bg-indigo-500 text-white",  cell: "bg-indigo-100 border-indigo-400 text-indigo-900" },
];

function uid() { return Math.random().toString(36).slice(2, 9); }

// ─── Seed data ────────────────────────────────────────────────────────────────

function seedData() {
  const r: Record<string, Room>    = {};
  const t: Record<string, Team>    = {};
  const p: Record<string, Person>  = {};
  const s: Record<string, Session> = {};

  const rooms = ["H1", "H5+6", "H9", "H10", "H2", "H3", "Scrum Room"];
  const rids   = rooms.map(() => uid());
  rooms.forEach((name, i) => { r[rids[i]] = { id: rids[i], name }; });

  const teamDefs = [
    { name: "Self Service", roomIdx: 0 },
    { name: "Radio",        roomIdx: 1 },
    { name: "Shared",       roomIdx: 2 },
    { name: "gFIX",         roomIdx: 3 },
    { name: "Outdoor UK",   roomIdx: 4 },
    { name: "Outdoor Intl", roomIdx: 5 },
    { name: "Sales Ops",    roomIdx: 6 },
  ];
  const tids = teamDefs.map(() => uid());
  teamDefs.forEach((td, i) => {
    t[tids[i]] = { id: tids[i], name: td.name, roomId: rids[td.roomIdx], colorIdx: i % COLORS.length };
  });

  const peopleDefs: [string, number][] = [
    ["Alice",0],["Ben",0],["Clara",0],
    ["Dan",1],["Eva",1],["Frank",1],
    ["Grace",2],["Harry",2],
    ["Isla",3],["Jack",3],
    ["Karen",4],["Leo",4],["Mia",4],
    ["Noah",5],["Olivia",5],
    ["Paul",6],["Quinn",6],
  ];
  const pids = peopleDefs.map(() => uid());
  peopleDefs.forEach(([name, ti], i) => {
    p[pids[i]] = { id: pids[i], name, teamId: tids[ti] };
  });

  const sessionDefs: [string, number[]][] = [
    ["Sprint Review",       [0,1,6,7]],
    ["Dependency Mapping",  [0,1,2,3,4,5,6,7,8,9,10,11,12,13,14,15,16]],
    ["Partnerships Review", [3,4,14,15]],
    ["Backlog Refinement",  [0,1,2]],
    ["Architecture Sync",   [6,7,8,9]],
    ["Ireland Roll Out",    [13,14]],
    ["Capacity Planning",   [0,1,3,4]],
    ["Release Planning",    [10,11,12]],
    ["Cross-team Demo",     [0,3,6,10,13,15]],
    ["Risk Review",         [6,7,15,16]],
  ];
  sessionDefs.forEach(([name, pidxs]) => {
    const id = uid();
    s[id] = { id, name, attendeeIds: pidxs.map(i => pids[i]), notes: "" };
  });

  return { rooms: r, teams: t, people: p, sessions: s };
}

// ─── App ─────────────────────────────────────────────────────────────────────

export default function Home() {
  const [rooms,      setRooms]      = useState<Record<string, Room>>({});
  const [teams,      setTeams]      = useState<Record<string, Team>>({});
  const [people,     setPeople]     = useState<Record<string, Person>>({});
  const [sessions,   setSessions]   = useState<Record<string, Session>>({});
  const [placements, setPlacements] = useState<Placement[]>([]);
  const [blocked,    setBlocked]    = useState<Blocked[]>([]);

  const [tab,         setTab]        = useState<Tab>("schedule");
  const [activeDay,   setActiveDay]  = useState<Day>("mon");
  const [mode,        setMode]       = useState<Mode>("place");
  const [selectedId,  setSelectedId] = useState<string | null>(null);
  const [editSession, setEditSession] = useState<Partial<Session> & { isNew?: boolean } | null>(null);
  const [dragId,      setDragId]     = useState<string | null>(null); // sessionId being dragged
  const [dragFromPl,  setDragFromPl] = useState<string | null>(null); // placementId if from grid
  const [dragOver,    setDragOver]   = useState<string | null>(null); // "roomId:slotIdx" hover target

  const [newPersonName, setNewPersonName] = useState("");
  const [newPersonTeam, setNewPersonTeam] = useState("");
  const [newRoomName,   setNewRoomName]   = useState("");

  useEffect(() => {
    const seed = seedData();
    setRooms(seed.rooms);
    setTeams(seed.teams);
    setPeople(seed.people);
    setSessions(seed.sessions);
  }, []);

  // ── Derived ──────────────────────────────────────────────────────────────

  const placedIds   = new Set(placements.map(p => p.sessionId));
  const unscheduled = Object.values(sessions).filter(s => !placedIds.has(s.id));
  const roomList    = Object.values(rooms);
  const teamList    = Object.values(teams);
  const peopleList  = Object.values(people);

  const clashPlacementIds = useCallback((): Set<string> => {
    const set = new Set<string>();
    const grouped: Record<string, Placement[]> = {};
    placements.forEach(pl => {
      const key = `${pl.day}:${pl.slotIdx}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(pl);
    });
    Object.values(grouped).forEach(group => {
      if (group.length < 2) return;
      for (let i = 0; i < group.length; i++) {
        for (let j = i + 1; j < group.length; j++) {
          const a = sessions[group[i].sessionId];
          const b = sessions[group[j].sessionId];
          if (!a || !b) continue;
          if (a.attendeeIds.some(id => b.attendeeIds.includes(id))) {
            set.add(group[i].id);
            set.add(group[j].id);
          }
        }
      }
    });
    return set;
  }, [placements, sessions]);

  const clashIds    = clashPlacementIds();
  const clashCount  = clashIds.size;
  const totalPlaced = placedIds.size;

  // ── Place session ─────────────────────────────────────────────────────────

  const placeSession = (sessionId: string, roomId: string, day: Day, slotIdx: number, fromPlId?: string) => {
    if (slotIdx === LUNCH_SLOT) return;
    const isBlocked = blocked.some(b => b.roomId === roomId && b.day === day && b.slotIdx === slotIdx);
    if (isBlocked) return;

    setPlacements(prev => {
      let next = prev.filter(p => p.sessionId !== sessionId); // remove old placement of this session
      if (fromPlId) next = next.filter(p => p.id !== fromPlId); // remove source if grid drag
      const occupant = next.find(p => p.roomId === roomId && p.day === day && p.slotIdx === slotIdx);
      if (occupant) next = next.filter(p => p.id !== occupant.id); // remove whoever was there
      next.push({ id: uid(), sessionId, roomId, day, slotIdx });
      return next;
    });
  };

  const handleCellClick = (roomId: string, day: Day, slotIdx: number) => {
    if (slotIdx === LUNCH_SLOT) return;
    if (mode === "block") {
      const existing = blocked.find(b => b.roomId === roomId && b.day === day && b.slotIdx === slotIdx);
      if (existing) {
        setBlocked(prev => prev.filter(b => b.id !== existing.id));
      } else {
        // Remove any placed session from this cell first
        setPlacements(prev => prev.filter(p => !(p.roomId === roomId && p.day === day && p.slotIdx === slotIdx)));
        setBlocked(prev => [...prev, { id: uid(), roomId, day, slotIdx }]);
      }
      return;
    }
    if (selectedId) {
      placeSession(selectedId, roomId, day, slotIdx);
      setSelectedId(null);
    }
  };

  const unplace = (placementId: string) => {
    setPlacements(prev => prev.filter(p => p.id !== placementId));
  };

  // ── Drag & Drop ───────────────────────────────────────────────────────────

  const handleDragStart = (sessionId: string, placementId?: string) => {
    setDragId(sessionId);
    setDragFromPl(placementId ?? null);
    setSelectedId(null);
  };

  const handleDrop = (roomId: string, day: Day, slotIdx: number) => {
    if (!dragId) return;
    placeSession(dragId, roomId, day, slotIdx, dragFromPl ?? undefined);
    setDragId(null);
    setDragFromPl(null);
    setDragOver(null);
  };

  // ── Auto-scheduler ────────────────────────────────────────────────────────

  const autoSchedule = () => {
    const newPl: Placement[] = [...placements];

    const personBusy = (pid: string, day: Day, slotIdx: number) =>
      newPl.some(pl => {
        const s = sessions[pl.sessionId];
        return pl.day === day && pl.slotIdx === slotIdx && s?.attendeeIds.includes(pid);
      });

    const roomBusy = (roomId: string, day: Day, slotIdx: number) =>
      newPl.some(pl => pl.roomId === roomId && pl.day === day && pl.slotIdx === slotIdx);

    const isBlocked = (roomId: string, day: Day, slotIdx: number) =>
      blocked.some(b => b.roomId === roomId && b.day === day && b.slotIdx === slotIdx);

    const unplaced = Object.values(sessions).filter(s => !newPl.some(p => p.sessionId === s.id));

    for (const session of unplaced) {
      let placed = false;
      for (const { key: day } of DAYS) {
        if (placed) break;
        for (let slotIdx = 0; slotIdx < SLOTS.length; slotIdx++) {
          if (placed || slotIdx === LUNCH_SLOT) continue;
          for (const room of roomList) {
            if (roomBusy(room.id, day, slotIdx)) continue;
            if (isBlocked(room.id, day, slotIdx)) continue;
            if (session.attendeeIds.some(pid => personBusy(pid, day, slotIdx))) continue;
            newPl.push({ id: uid(), sessionId: session.id, roomId: room.id, day, slotIdx });
            placed = true;
            break;
          }
        }
      }
    }
    setPlacements(newPl);
  };

  // ── Export CSV ────────────────────────────────────────────────────────────

  const exportCSV = () => {
    const rows: string[][] = [["Day", "Time", "Room", "Session", "Attendees", "Clash?"]];
    DAYS.forEach(({ key: day, label }) => {
      SLOTS.forEach((slot, slotIdx) => {
        if (slotIdx === LUNCH_SLOT) {
          rows.push([label, slot, "", "LUNCH", "", ""]);
          return;
        }
        roomList.forEach(room => {
          const pl = placements.find(p => p.roomId === room.id && p.day === day && p.slotIdx === slotIdx);
          const bl = blocked.some(b => b.roomId === room.id && b.day === day && b.slotIdx === slotIdx);
          if (pl) {
            const session = sessions[pl.sessionId];
            const attendees = session.attendeeIds.map(id => people[id]?.name).filter(Boolean).join(", ");
            const isClash = clashIds.has(pl.id) ? "YES" : "";
            rows.push([label, slot, room.name, session.name, attendees, isClash]);
          } else if (bl) {
            rows.push([label, slot, room.name, "UNAVAILABLE", "", ""]);
          }
        });
      });
    });

    const csv = rows.map(r => r.map(c => `"${c}"`).join(",")).join("\n");
    const blob = new Blob([csv], { type: "text/csv" });
    const url  = URL.createObjectURL(blob);
    const a    = document.createElement("a");
    a.href     = url;
    a.download = "IP_May_2026_Schedule.csv";
    a.click();
    URL.revokeObjectURL(url);
  };

  // ── Session CRUD ──────────────────────────────────────────────────────────

  const saveSession = () => {
    if (!editSession?.name?.trim()) return;
    const s: Session = {
      id:          editSession.id ?? uid(),
      name:        editSession.name.trim(),
      attendeeIds: editSession.attendeeIds ?? [],
      notes:       editSession.notes ?? "",
    };
    setSessions(prev => ({ ...prev, [s.id]: s }));
    setEditSession(null);
  };

  const deleteSession = (id: string) => {
    setSessions(prev  => { const n = { ...prev }; delete n[id]; return n; });
    setPlacements(prev => prev.filter(p => p.sessionId !== id));
    if (selectedId === id) setSelectedId(null);
  };

  const toggleAttendee = (personId: string) => {
    setEditSession(prev => {
      if (!prev) return prev;
      const ids = prev.attendeeIds ?? [];
      return { ...prev, attendeeIds: ids.includes(personId) ? ids.filter(x => x !== personId) : [...ids, personId] };
    });
  };

  // ── People CRUD ───────────────────────────────────────────────────────────

  const addPerson = () => {
    if (!newPersonName.trim() || !newPersonTeam) return;
    const p: Person = { id: uid(), name: newPersonName.trim(), teamId: newPersonTeam };
    setPeople(prev => ({ ...prev, [p.id]: p }));
    setNewPersonName("");
  };

  const deletePerson = (id: string) => {
    setPeople(prev  => { const n = { ...prev }; delete n[id]; return n; });
    setSessions(prev => {
      const n = { ...prev };
      Object.values(n).forEach(s => { n[s.id] = { ...s, attendeeIds: s.attendeeIds.filter(x => x !== id) }; });
      return n;
    });
  };

  // ── Room CRUD ─────────────────────────────────────────────────────────────

  const addRoom = () => {
    if (!newRoomName.trim()) return;
    const r: Room = { id: uid(), name: newRoomName.trim() };
    setRooms(prev => ({ ...prev, [r.id]: r }));
    setNewRoomName("");
  };

  const deleteRoom = (id: string) => {
    setRooms(prev  => { const n = { ...prev }; delete n[id]; return n; });
    setPlacements(prev => prev.filter(p => p.roomId !== id));
    setBlocked(prev    => prev.filter(b => b.roomId !== id));
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render helpers
  // ─────────────────────────────────────────────────────────────────────────

  const sessionColor = (session: Session) => {
    const person = people[session.attendeeIds[0]];
    const team   = person ? teams[person.teamId] : null;
    return team ? COLORS[team.colorIdx] : COLORS[0];
  };

  // ─────────────────────────────────────────────────────────────────────────
  // Render
  // ─────────────────────────────────────────────────────────────────────────

  return (
    <div className="min-h-screen bg-slate-100 flex flex-col text-sm select-none">

      {/* Header */}
      <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between shadow-sm">
        <div>
          <h1 className="text-base font-bold text-slate-900">IP May 2026 — Increment Planner</h1>
          <p className="text-xs text-slate-400">
            {totalPlaced}/{Object.keys(sessions).length} sessions scheduled
            {unscheduled.length > 0 && ` · ${unscheduled.length} unscheduled`}
          </p>
        </div>
        <div className="flex items-center gap-2">
          {clashCount > 0 && (
            <span className="bg-red-100 text-red-700 px-3 py-1 rounded-full text-xs font-semibold">
              ⚠ {clashCount} person clash{clashCount !== 1 ? "es" : ""}
            </span>
          )}
          <button onClick={exportCSV} className="bg-slate-100 hover:bg-slate-200 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg transition-colors border border-slate-300">
            Export CSV
          </button>
          <button onClick={autoSchedule} className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors">
            Auto-Schedule
          </button>
          <button onClick={() => { setPlacements([]); setSelectedId(null); }} className="bg-slate-200 hover:bg-slate-300 text-slate-700 text-xs font-semibold px-3 py-2 rounded-lg transition-colors">
            Clear
          </button>
        </div>
      </header>

      {/* Nav */}
      <nav className="bg-white border-b border-slate-200 px-6 flex gap-1">
        {(["schedule","sessions","people","rooms"] as Tab[]).map(t => (
          <button
            key={t}
            onClick={() => setTab(t)}
            className={`px-4 py-2.5 text-xs font-medium capitalize border-b-2 transition-colors ${
              tab === t ? "border-indigo-500 text-indigo-600" : "border-transparent text-slate-500 hover:text-slate-700"
            }`}
          >
            {t === "sessions" ? `Sessions (${Object.keys(sessions).length})`
              : t === "people" ? `People (${Object.keys(people).length})`
              : t === "rooms"  ? `Rooms (${Object.keys(rooms).length})`
              : "Schedule"}
          </button>
        ))}
      </nav>

      {/* ── SCHEDULE TAB ── */}
      {tab === "schedule" && (
        <div className="flex flex-1 overflow-hidden">

          {/* Sidebar – unscheduled sessions */}
          <aside className="w-52 bg-white border-r border-slate-200 flex flex-col">
            <div className="p-3 border-b border-slate-100 flex items-center justify-between">
              <p className="text-xs font-semibold text-slate-500 uppercase tracking-wide">
                Unscheduled ({unscheduled.length})
              </p>
            </div>

            {/* Mode toggle */}
            <div className="p-2 border-b border-slate-100 flex gap-1">
              <button
                onClick={() => setMode("place")}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                  mode === "place" ? "bg-indigo-100 text-indigo-700" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                Place
              </button>
              <button
                onClick={() => { setMode("block"); setSelectedId(null); }}
                className={`flex-1 py-1.5 rounded text-xs font-medium transition-colors ${
                  mode === "block" ? "bg-red-100 text-red-700" : "text-slate-500 hover:bg-slate-100"
                }`}
              >
                Block Slots
              </button>
            </div>

            {mode === "block" && (
              <div className="px-3 py-2 bg-red-50 border-b border-red-100">
                <p className="text-xs text-red-600">Click any cell to mark it unavailable. Click again to unblock.</p>
              </div>
            )}

            <div className="p-2 space-y-1.5 flex-1 overflow-y-auto">
              {unscheduled.length === 0 && (
                <p className="text-xs text-slate-400 italic px-1 pt-2">All sessions placed</p>
              )}
              {unscheduled.map(session => {
                const isSelected = selectedId === session.id;
                const color      = sessionColor(session);
                return (
                  <div
                    key={session.id}
                    draggable
                    onDragStart={() => { handleDragStart(session.id); setSelectedId(null); }}
                    onDragEnd={() => { setDragId(null); setDragFromPl(null); setDragOver(null); }}
                    onClick={() => mode === "place" && setSelectedId(isSelected ? null : session.id)}
                    className={`rounded-lg px-3 py-2 cursor-grab active:cursor-grabbing border-2 transition-all ${
                      isSelected
                        ? "border-indigo-500 bg-indigo-50"
                        : "border-slate-200 hover:border-indigo-300 bg-slate-50"
                    }`}
                  >
                    <p className="font-medium text-slate-800 text-xs leading-tight">{session.name}</p>
                    <p className="text-slate-400 text-xs mt-0.5">
                      {session.attendeeIds.length} attendee{session.attendeeIds.length !== 1 ? "s" : ""}
                    </p>
                    {isSelected && <p className="text-indigo-500 text-xs font-medium mt-1">→ click or drag a cell</p>}
                  </div>
                );
              })}
            </div>
          </aside>

          {/* Grid */}
          <main className="flex-1 overflow-auto p-4">
            {/* Day tabs */}
            <div className="flex gap-1 mb-4">
              {DAYS.map(d => (
                <button
                  key={d.key}
                  onClick={() => setActiveDay(d.key)}
                  className={`px-4 py-2 rounded-lg text-xs font-semibold transition-colors ${
                    activeDay === d.key
                      ? "bg-indigo-600 text-white"
                      : "bg-white text-slate-600 hover:bg-slate-50 border border-slate-200"
                  }`}
                >
                  {d.label}
                </button>
              ))}
            </div>

            {selectedId && mode === "place" && (
              <div className="mb-3 bg-indigo-50 border border-indigo-200 rounded-lg px-4 py-2 text-xs text-indigo-700 font-medium">
                Session selected — click a cell or drag it to place.
              </div>
            )}
            {clashCount > 0 && (
              <div className="mb-3 bg-red-50 border border-red-200 rounded-lg px-4 py-2 text-xs text-red-700">
                ⚠ <strong>{clashCount} placement{clashCount !== 1 ? "s" : ""}</strong> have person clashes — the same person is double-booked.
              </div>
            )}

            <div className="bg-white rounded-xl border border-slate-200 overflow-hidden shadow-sm">
              <table className="w-full border-collapse">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="w-28 px-3 py-2 text-xs font-semibold text-slate-500 text-left">Time</th>
                    {roomList.map(room => (
                      <th key={room.id} className="px-2 py-2 text-xs font-semibold text-slate-700 text-center min-w-36">
                        {room.name}
                        <span className="block text-slate-400 font-normal text-[10px]">
                          {teamList.find(t => t.roomId === room.id)?.name ?? ""}
                        </span>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {SLOTS.map((slot, slotIdx) => {
                    const isLunch = slotIdx === LUNCH_SLOT;
                    return (
                      <tr key={slotIdx} className="border-b border-slate-100 last:border-0">
                        <td className="px-3 py-1.5 text-xs font-mono text-slate-400 whitespace-nowrap align-middle">
                          {slot}
                          {isLunch && <span className="ml-1 text-slate-300 text-[10px]">lunch</span>}
                        </td>
                        {roomList.map(room => {
                          if (isLunch) {
                            return (
                              <td key={room.id} className="border-l border-slate-100 px-2 py-1 text-center bg-slate-50">
                                <span className="text-xs text-slate-300 italic">lunch</span>
                              </td>
                            );
                          }

                          const placement   = placements.find(p => p.roomId === room.id && p.day === activeDay && p.slotIdx === slotIdx);
                          const session     = placement ? sessions[placement.sessionId] : null;
                          const isBlockedCell = blocked.some(b => b.roomId === room.id && b.day === activeDay && b.slotIdx === slotIdx);
                          const isClash     = placement ? clashIds.has(placement.id) : false;
                          const color       = session ? sessionColor(session) : COLORS[0];
                          const dropKey     = `${room.id}:${slotIdx}`;
                          const isDragTarget = dragOver === dropKey;

                          if (isBlockedCell && !session) {
                            return (
                              <td
                                key={room.id}
                                onClick={() => handleCellClick(room.id, activeDay, slotIdx)}
                                className="border-l border-slate-100 px-2 py-1.5 cursor-pointer"
                                title="Click to unblock"
                              >
                                <div className="h-14 rounded bg-slate-200 flex items-center justify-center">
                                  <span className="text-xs text-slate-500 font-medium">Unavailable</span>
                                </div>
                              </td>
                            );
                          }

                          return (
                            <td
                              key={room.id}
                              onClick={() => !session && handleCellClick(room.id, activeDay, slotIdx)}
                              onDragOver={e => { e.preventDefault(); setDragOver(dropKey); }}
                              onDragLeave={() => setDragOver(null)}
                              onDrop={e => { e.preventDefault(); handleDrop(room.id, activeDay, slotIdx); }}
                              className={`border-l border-slate-100 px-2 py-1.5 transition-colors ${
                                session ? "cursor-default"
                                : mode === "block" ? "cursor-pointer"
                                : selectedId || dragId ? "cursor-pointer" : "cursor-default"
                              } ${isDragTarget && !session ? "bg-indigo-50" : ""}`}
                            >
                              {session ? (
                                <div
                                  draggable
                                  onDragStart={() => handleDragStart(session.id, placement!.id)}
                                  onDragEnd={() => { setDragId(null); setDragFromPl(null); setDragOver(null); }}
                                  className={`rounded-lg px-2 py-1.5 border-2 cursor-grab active:cursor-grabbing ${
                                    isClash ? "bg-red-50 border-red-400" : `${color.cell} border-transparent`
                                  } ${isDragTarget ? "opacity-50" : ""}`}
                                >
                                  <div className="flex items-start justify-between gap-1">
                                    <p className="font-semibold text-xs leading-tight">{session.name}</p>
                                    <button
                                      onMouseDown={e => e.stopPropagation()}
                                      onClick={e => { e.stopPropagation(); unplace(placement!.id); }}
                                      className="text-slate-400 hover:text-red-500 text-xs shrink-0 leading-none"
                                    >✕</button>
                                  </div>
                                  <p className="text-[10px] text-slate-500 mt-0.5">
                                    {session.attendeeIds.length} people
                                  </p>
                                  {isClash && <p className="text-[10px] text-red-600 font-semibold">⚠ Person clash</p>}
                                </div>
                              ) : (
                                <div
                                  className={`h-14 rounded border border-dashed transition-colors ${
                                    isDragTarget
                                      ? "border-indigo-400 bg-indigo-50"
                                      : mode === "block"
                                      ? "border-red-200 hover:bg-red-50"
                                      : selectedId || dragId
                                      ? "border-indigo-200 hover:bg-indigo-50/40"
                                      : "border-slate-200"
                                  }`}
                                />
                              )}
                            </td>
                          );
                        })}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </main>
        </div>
      )}

      {/* ── SESSIONS TAB ── */}
      {tab === "sessions" && (
        <div className="flex-1 p-6 overflow-y-auto">
          <div className="max-w-3xl mx-auto space-y-4">
            <div className="flex items-center justify-between">
              <h2 className="font-semibold text-slate-800">Sessions</h2>
              <button
                onClick={() => setEditSession({ isNew: true, attendeeIds: [], notes: "" })}
                className="bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold px-4 py-2 rounded-lg transition-colors"
              >
                + Add Session
              </button>
            </div>

            {Object.values(sessions).map(session => {
              const placement = placements.find(p => p.sessionId === session.id);
              const isClash   = placement ? clashIds.has(placement.id) : false;
              const attendees = session.attendeeIds.map(id => people[id]).filter(Boolean);
              return (
                <div key={session.id} className={`bg-white rounded-xl border shadow-sm p-4 ${isClash ? "border-red-300" : "border-slate-200"}`}>
                  <div className="flex items-start justify-between">
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-2 flex-wrap">
                        <h3 className="font-semibold text-slate-900">{session.name}</h3>
                        {placement ? (
                          <span className="bg-emerald-100 text-emerald-700 text-xs px-2 py-0.5 rounded-full font-medium">
                            {DAYS.find(d => d.key === placement.day)?.label} · {SLOTS[placement.slotIdx]} · {rooms[placement.roomId]?.name}
                          </span>
                        ) : (
                          <span className="bg-amber-100 text-amber-700 text-xs px-2 py-0.5 rounded-full font-medium">Unscheduled</span>
                        )}
                        {isClash && <span className="bg-red-100 text-red-700 text-xs px-2 py-0.5 rounded-full font-semibold">⚠ Clash</span>}
                      </div>
                      <div className="flex flex-wrap gap-1.5 mt-2">
                        {attendees.length === 0 && <span className="text-xs text-slate-400 italic">No attendees</span>}
                        {attendees.map(person => {
                          const team  = teams[person.teamId];
                          const color = team ? COLORS[team.colorIdx] : COLORS[0];
                          return <span key={person.id} className={`text-xs px-2 py-0.5 rounded-full font-medium ${color.pill}`}>{person.name}</span>;
                        })}
                      </div>
                      {session.notes && <p className="text-xs text-slate-500 mt-1.5 italic">{session.notes}</p>}
                    </div>
                    <div className="flex gap-1 ml-4">
                      <button onClick={() => setEditSession({ ...session })} className="text-xs text-slate-400 hover:text-indigo-600 px-2 py-1 rounded hover:bg-indigo-50 transition-colors">Edit</button>
                      <button onClick={() => deleteSession(session.id)} className="text-xs text-slate-400 hover:text-red-500 px-2 py-1 rounded hover:bg-red-50 transition-colors">Delete</button>
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── PEOPLE TAB ── */}
      {tab === "people" && (
        <div className="p-6 overflow-y-auto flex-1">
          <div className="max-w-2xl mx-auto space-y-4">
            <h2 className="font-semibold text-slate-800">People</h2>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex gap-3">
              <input
                value={newPersonName}
                onChange={e => setNewPersonName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addPerson()}
                placeholder="Name"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <select
                value={newPersonTeam}
                onChange={e => setNewPersonTeam(e.target.value)}
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400 text-slate-700"
              >
                <option value="">Select team...</option>
                {teamList.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
              </select>
              <button onClick={addPerson} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors">Add</button>
            </div>

            {teamList.map(team => {
              const members = peopleList.filter(p => p.teamId === team.id);
              const color   = COLORS[team.colorIdx];
              return (
                <div key={team.id} className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm">
                  <span className={`text-xs px-2.5 py-1 rounded-full font-medium ${color.pill} inline-block mb-3`}>{team.name}</span>
                  <div className="flex flex-wrap gap-2">
                    {members.length === 0 && <span className="text-xs text-slate-400 italic">No members</span>}
                    {members.map(person => (
                      <div key={person.id} className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-medium ${color.cell} border`}>
                        {person.name}
                        <button onClick={() => deletePerson(person.id)} className="text-slate-400 hover:text-red-500 transition-colors leading-none">✕</button>
                      </div>
                    ))}
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {/* ── ROOMS TAB ── */}
      {tab === "rooms" && (
        <div className="p-6 overflow-y-auto flex-1">
          <div className="max-w-xl mx-auto space-y-4">
            <h2 className="font-semibold text-slate-800">Rooms</h2>
            <div className="bg-white rounded-xl border border-slate-200 p-4 shadow-sm flex gap-3">
              <input
                value={newRoomName}
                onChange={e => setNewRoomName(e.target.value)}
                onKeyDown={e => e.key === "Enter" && addRoom()}
                placeholder="Room name (e.g. H1)"
                className="flex-1 border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
              />
              <button onClick={addRoom} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-500 transition-colors">Add</button>
            </div>
            <div className="bg-white rounded-xl border border-slate-200 shadow-sm divide-y divide-slate-100">
              {roomList.length === 0 && <p className="p-4 text-xs text-slate-400 italic">No rooms added</p>}
              {roomList.map(room => {
                const ownerTeam = teamList.find(t => t.roomId === room.id);
                return (
                  <div key={room.id} className="flex items-center justify-between px-4 py-3">
                    <div>
                      <span className="font-medium text-slate-800">{room.name}</span>
                      {ownerTeam && (
                        <span className={`ml-2 text-xs px-2 py-0.5 rounded-full font-medium ${COLORS[ownerTeam.colorIdx].pill}`}>
                          {ownerTeam.name}
                        </span>
                      )}
                    </div>
                    <button onClick={() => deleteRoom(room.id)} className="text-slate-400 hover:text-red-500 text-xs transition-colors">Delete</button>
                  </div>
                );
              })}
            </div>
          </div>
        </div>
      )}

      {/* ── SESSION EDIT MODAL ── */}
      {editSession && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-lg max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 border-b border-slate-200">
              <h2 className="font-semibold text-slate-900">{editSession.isNew ? "New Session" : "Edit Session"}</h2>
              <button onClick={() => setEditSession(null)} className="text-slate-400 hover:text-slate-700 text-lg leading-none">✕</button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Session name</label>
                <input
                  value={editSession.name ?? ""}
                  onChange={e => setEditSession(p => ({ ...p!, name: e.target.value }))}
                  placeholder="e.g. Sprint Review"
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                  autoFocus
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-1.5">Notes (optional)</label>
                <input
                  value={editSession.notes ?? ""}
                  onChange={e => setEditSession(p => ({ ...p!, notes: e.target.value }))}
                  placeholder="Any notes..."
                  className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-indigo-400"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-slate-600 mb-2">
                  Attendees ({(editSession.attendeeIds ?? []).length} selected)
                </label>
                <div className="space-y-3">
                  {teamList.map(team => {
                    const members = peopleList.filter(p => p.teamId === team.id);
                    if (members.length === 0) return null;
                    const color = COLORS[team.colorIdx];
                    return (
                      <div key={team.id}>
                        <p className={`text-xs font-semibold mb-1.5 px-2 py-0.5 rounded-full inline-block ${color.pill}`}>{team.name}</p>
                        <div className="flex flex-wrap gap-1.5">
                          {members.map(person => {
                            const checked = (editSession.attendeeIds ?? []).includes(person.id);
                            return (
                              <button
                                key={person.id}
                                onClick={() => toggleAttendee(person.id)}
                                className={`text-xs px-2.5 py-1 rounded-full font-medium border-2 transition-all ${
                                  checked ? `${color.pill} border-transparent` : "border-slate-200 text-slate-600 hover:border-slate-400"
                                }`}
                              >
                                {person.name}
                              </button>
                            );
                          })}
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
            <div className="px-6 py-4 border-t border-slate-200 flex justify-end gap-2">
              <button onClick={() => setEditSession(null)} className="px-4 py-2 text-sm text-slate-600 hover:text-slate-800 transition-colors">Cancel</button>
              <button
                onClick={saveSession}
                disabled={!editSession.name?.trim()}
                className="bg-indigo-600 hover:bg-indigo-500 disabled:bg-slate-200 disabled:text-slate-400 text-white text-sm font-medium px-5 py-2 rounded-lg transition-colors"
              >
                Save Session
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
