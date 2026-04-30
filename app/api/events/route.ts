import { prisma } from "@/lib/prisma";
import { NextRequest, NextResponse } from "next/server";

export async function GET() {
  const events = await prisma.event.findMany({
    orderBy: { createdAt: "asc" },
    include: { _count: { select: { sessions: true } } },
  });
  return NextResponse.json(events);
}

export async function POST(req: NextRequest) {
  const { name, days } = await req.json();
  if (!name || !days?.length) {
    return NextResponse.json({ error: "name and days required" }, { status: 400 });
  }
  const event = await prisma.event.create({ data: { name, days } });
  return NextResponse.json(event);
}
