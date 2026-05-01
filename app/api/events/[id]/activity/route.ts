import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const activities = await prisma.activityLog.findMany({
    where: { eventId: id },
    orderBy: { createdAt: "desc" },
    take: 30,
  });
  return NextResponse.json(activities);
}

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const { actor, action } = await req.json();
  const entry = await prisma.activityLog.create({
    data: { eventId: id, actor: actor ?? "Anonymous", action },
  });
  return NextResponse.json(entry);
}
