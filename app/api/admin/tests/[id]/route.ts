import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { jwtVerify } from "jose";
import { prisma } from "@/lib/db";

const ADMIN_SECRET = new TextEncoder().encode(
  process.env.ADMIN_JWT_SECRET || "admin-secret-key-change-in-prod-32chars!!"
);

async function isAdmin(): Promise<boolean> {
  try {
    const cookieStore = await cookies();
    const token = cookieStore.get("employee_auth")?.value;
    if (!token) return false;
    const { payload } = await jwtVerify(token, ADMIN_SECRET);
    return payload.role === "admin";
  } catch {
    return false;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const exam = await prisma.customExam.findUnique({
    where: { id },
    include: { questions: { orderBy: { index: "asc" } } },
  });
  if (!exam) return NextResponse.json({ error: "Not found" }, { status: 404 });

  return NextResponse.json({
    ...exam,
    instructions: JSON.parse(exam.instructions),
    paletteLegend: JSON.parse(exam.paletteLegend),
    questions: exam.questions.map((q: any) => ({
      ...q,
      options: q.options ? JSON.parse(q.options) : [],
    })),
  });
}

export async function PUT(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const data = await request.json();

  try {
    // Delete existing questions and recreate
    await prisma.customQuestion.deleteMany({ where: { examId: id } });

    const updated = await prisma.customExam.update({
      where: { id },
      data: {
        name: data.name,
        durationMinutes: data.durationMinutes,
        maxMarks: data.maxMarks,
        cardDetails: data.cardDetails,
        scoringCorrect: data.scoringCorrect,
        scoringIncorrect: data.scoringIncorrect,
        isPremium: data.isPremium ?? false,
        category: data.category || null,
        section: data.section || null,
        baseExamId: data.baseExamId || null,
        questions: {
          create: data.questions.map((q: any, i: number) => ({
            index: i + 1,
            section: q.section,
            subject: q.subject,
            type: q.type,
            text: q.text,
            image: q.image || null,
            options: q.options ? JSON.stringify(q.options) : null,
            correctAnswer: q.correctAnswer,
            explanation: q.explanation || "",
            isBonus: q.isBonus ?? false,
          })),
        },
      },
    });

    return NextResponse.json({ success: true, id: updated.id });
  } catch (error: any) {
    console.error("Failed to update exam:", error);
    return NextResponse.json({ error: "Failed to update", details: error.message }, { status: 500 });
  }
}

export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  const { published } = await request.json();

  try {
    await prisma.customExam.update({ where: { id }, data: { published } });
    return NextResponse.json({ success: true, published });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to update", details: error.message }, { status: 500 });
  }
}

export async function DELETE(
  _request: Request,
  { params }: { params: Promise<{ id: string }> }
) {
  if (!(await isAdmin())) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { id } = await params;
  try {
    await prisma.customExam.delete({ where: { id } });
    return NextResponse.json({ success: true });
  } catch (error: any) {
    return NextResponse.json({ error: "Failed to delete", details: error.message }, { status: 500 });
  }
}
