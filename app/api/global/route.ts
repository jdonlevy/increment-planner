import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const [rooms, teams, people] = await Promise.all([
    prisma.room.findMany(),
    prisma.team.findMany(),
    prisma.person.findMany(),
  ]);
  return NextResponse.json({ rooms, teams, people });
}

export async function POST(req: NextRequest) {
  const { rooms, teams, people } = await req.json();

  // Get current IDs to diff
  const [existingRooms, existingTeams, existingPeople] = await Promise.all([
    prisma.room.findMany({ select: { id: true } }),
    prisma.team.findMany({ select: { id: true } }),
    prisma.person.findMany({ select: { id: true } }),
  ]);

  const incomingRoomIds   = new Set(rooms.map((r: { id: string }) => r.id));
  const incomingTeamIds   = new Set(teams.map((t: { id: string }) => t.id));
  const incomingPeopleIds = new Set(people.map((p: { id: string }) => p.id));

  const deletedRoomIds   = existingRooms.filter(r => !incomingRoomIds.has(r.id)).map(r => r.id);
  const deletedTeamIds   = existingTeams.filter(t => !incomingTeamIds.has(t.id)).map(t => t.id);
  const deletedPeopleIds = existingPeople.filter(p => !incomingPeopleIds.has(p.id)).map(p => p.id);

  await prisma.$transaction(async tx => {
    // Delete removed records
    if (deletedPeopleIds.length) await tx.person.deleteMany({ where: { id: { in: deletedPeopleIds } } });
    if (deletedTeamIds.length)   await tx.team.deleteMany({ where: { id: { in: deletedTeamIds } } });
    if (deletedRoomIds.length)   await tx.room.deleteMany({ where: { id: { in: deletedRoomIds } } });

    // Upsert rooms
    for (const r of rooms) {
      await tx.room.upsert({ where: { id: r.id }, update: { name: r.name }, create: { id: r.id, name: r.name } });
    }

    // Upsert teams
    for (const t of teams) {
      await tx.team.upsert({
        where: { id: t.id },
        update: { name: t.name, colorIdx: t.colorIdx, roomId: t.roomId || null },
        create: { id: t.id, name: t.name, colorIdx: t.colorIdx, roomId: t.roomId || null },
      });
    }

    // Upsert people
    for (const p of people) {
      await tx.person.upsert({
        where: { id: p.id },
        update: { name: p.name, teamId: p.teamId },
        create: { id: p.id, name: p.name, teamId: p.teamId },
      });
    }
  });

  return NextResponse.json({ ok: true });
}
