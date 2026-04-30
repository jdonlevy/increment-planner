import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const [sessions, placements, blocked] = await Promise.all([
    prisma.session.findMany({ where: { eventId: id }, include: { attendees: true } }),
    prisma.placement.findMany({ where: { eventId: id } }),
    prisma.blocked.findMany({ where: { eventId: id } }),
  ]);
  return NextResponse.json({ sessions, placements, blocked });
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { sessions, placements, blocked } = await req.json();

  await prisma.$transaction([
    prisma.placement.deleteMany({ where: { eventId: id } }),
    prisma.blocked.deleteMany({ where: { eventId: id } }),
    prisma.session.deleteMany({ where: { eventId: id } }),
  ]);

  for (const s of sessions) {
    await prisma.session.create({
      data: {
        id: s.id,
        name: s.name,
        notes: s.notes ?? "",
        teamId: s.teamId,
        eventId: id,
        attendees: { connect: s.attendeeIds.map((aid: string) => ({ id: aid })) },
      },
    });
  }

  if (placements.length > 0) {
    await prisma.placement.createMany({
      data: placements.map((p: { id: string; sessionId: string; roomId: string; day: string; slotIdx: number }) => ({
        id: p.id, sessionId: p.sessionId, roomId: p.roomId, day: p.day, slotIdx: p.slotIdx, eventId: id,
      })),
    });
  }

  if (blocked.length > 0) {
    await prisma.blocked.createMany({
      data: blocked.map((b: { id: string; roomId: string; day: string; slotIdx: number }) => ({
        id: b.id, roomId: b.roomId, day: b.day, slotIdx: b.slotIdx, eventId: id,
      })),
    });
  }

  return NextResponse.json({ ok: true });
}
