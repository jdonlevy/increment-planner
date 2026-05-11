import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

const MAX_SNAPSHOTS = 20;

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const snapshots = await prisma.scheduleSnapshot.findMany({
    where: { eventId: id },
    orderBy: { createdAt: "desc" },
    take: MAX_SNAPSHOTS,
    select: { id: true, actor: true, createdAt: true },
  });
  return NextResponse.json(snapshots);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, data } = await req.json();

  await prisma.scheduleSnapshot.create({
    data: { eventId: id, actor: actor ?? "Anonymous", data },
  });

  // Prune to last MAX_SNAPSHOTS
  const all = await prisma.scheduleSnapshot.findMany({
    where: { eventId: id },
    orderBy: { createdAt: "desc" },
    select: { id: true },
  });
  if (all.length > MAX_SNAPSHOTS) {
    const toDelete = all.slice(MAX_SNAPSHOTS).map(s => s.id);
    await prisma.scheduleSnapshot.deleteMany({ where: { id: { in: toDelete } } });
  }

  return NextResponse.json({ ok: true });
}

export async function DELETE(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { snapshotId } = await req.json();
  const snapshot = await prisma.scheduleSnapshot.findUnique({ where: { id: snapshotId } });
  if (!snapshot || snapshot.eventId !== id) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(snapshot.data);
}
