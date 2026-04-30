import { prisma } from "@/lib/prisma";
import { NextResponse } from "next/server";

const IP_MAY_DAYS = ["2026-05-18", "2026-05-19", "2026-05-21"];
const DAY_MAP: Record<string, string> = {
  mon: "2026-05-18",
  tue: "2026-05-19",
  thu: "2026-05-21",
};

export async function POST() {
  // Check if IP MAY 2026 already exists
  let event = await prisma.event.findFirst({ where: { name: "IP MAY 2026" } });

  if (!event) {
    event = await prisma.event.create({ data: { name: "IP MAY 2026", days: IP_MAY_DAYS } });
  }

  // Migrate orphaned sessions (no eventId)
  const orphanedSessions = await prisma.session.findMany({ where: { eventId: null } });
  if (orphanedSessions.length > 0) {
    await prisma.session.updateMany({ where: { eventId: null }, data: { eventId: event.id } });
  }

  // Migrate orphaned placements — also convert mon/tue/thu to dates
  const orphanedPlacements = await prisma.placement.findMany({ where: { eventId: null } });
  for (const p of orphanedPlacements) {
    const day = DAY_MAP[p.day] ?? p.day;
    await prisma.placement.update({ where: { id: p.id }, data: { eventId: event.id, day } });
  }

  // Migrate orphaned blocked slots
  const orphanedBlocked = await prisma.blocked.findMany({ where: { eventId: null } });
  for (const b of orphanedBlocked) {
    const day = DAY_MAP[b.day] ?? b.day;
    await prisma.blocked.update({ where: { id: b.id }, data: { eventId: event.id, day } });
  }

  return NextResponse.json({
    ok: true,
    eventId: event.id,
    migrated: {
      sessions: orphanedSessions.length,
      placements: orphanedPlacements.length,
      blocked: orphanedBlocked.length,
    },
  });
}
