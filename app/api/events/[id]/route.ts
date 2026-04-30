import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const event = await prisma.event.findUnique({ where: { id } });
  if (!event) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json(event);
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const data = await req.json();
  const event = await prisma.event.update({
    where: { id },
    data: {
      ...(data.slots      !== undefined && { slots:      data.slots }),
      ...(data.lunchSlots !== undefined && { lunchSlots: data.lunchSlots }),
      ...(data.lunchLabel !== undefined && { lunchLabel: data.lunchLabel }),
      ...(data.breaks     !== undefined && { breaks:     data.breaks }),
    },
  });
  return NextResponse.json(event);
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  await prisma.event.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
