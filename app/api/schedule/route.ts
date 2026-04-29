import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

// GET — load everything
export async function GET() {
  const [rooms, teams, people, sessions, placements, blocked] = await Promise.all([
    prisma.room.findMany(),
    prisma.team.findMany(),
    prisma.person.findMany(),
    prisma.session.findMany({ include: { attendees: true } }),
    prisma.placement.findMany(),
    prisma.blocked.findMany(),
  ]);
  return NextResponse.json({ rooms, teams, people, sessions, placements, blocked });
}

// POST — save full state (replace everything)
export async function POST(req: NextRequest) {
  const { rooms, teams, people, sessions, placements, blocked } = await req.json();

  await prisma.$transaction([
    prisma.blocked.deleteMany(),
    prisma.placement.deleteMany(),
    prisma.session.deleteMany(),
    prisma.person.deleteMany(),
    prisma.team.deleteMany(),
    prisma.room.deleteMany(),
  ]);

  await prisma.room.createMany({ data: rooms.map((r: { id: string; name: string }) => ({ id: r.id, name: r.name })) });
  await prisma.team.createMany({ data: teams.map((t: { id: string; name: string; roomId: string; colorIdx: number }) => ({ id: t.id, name: t.name, roomId: t.roomId, colorIdx: t.colorIdx })) });
  await prisma.person.createMany({ data: people.map((p: { id: string; name: string; teamId: string }) => ({ id: p.id, name: p.name, teamId: p.teamId })) });

  for (const s of sessions) {
    await prisma.session.create({
      data: {
        id: s.id,
        name: s.name,
        notes: s.notes ?? "",
        teamId: s.teamId,
        attendees: { connect: s.attendeeIds.map((id: string) => ({ id })) },
      },
    });
  }

  if (placements.length > 0) {
    await prisma.placement.createMany({
      data: placements.map((p: { id: string; sessionId: string; roomId: string; day: string; slotIdx: number }) => ({
        id: p.id, sessionId: p.sessionId, roomId: p.roomId, day: p.day, slotIdx: p.slotIdx,
      })),
    });
  }

  if (blocked.length > 0) {
    await prisma.blocked.createMany({
      data: blocked.map((b: { id: string; roomId: string; day: string; slotIdx: number }) => ({
        id: b.id, roomId: b.roomId, day: b.day, slotIdx: b.slotIdx,
      })),
    });
  }

  return NextResponse.json({ ok: true });
}
