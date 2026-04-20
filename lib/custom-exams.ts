import { prisma } from "@/lib/db";
import type { CustomExam, CustomQuestion } from "@prisma/client";
import type { ExamConfig } from "@/lib/exams";

type CustomExamWithQuestions = CustomExam & { questions: CustomQuestion[] };

function mapQuestion(q: CustomQuestion) {
  return {
    id: q.id,
    index: q.index,
    section: q.section,
    subject: q.subject,
    type: q.type as "mcq" | "numerical",
    text: q.text,
    options: q.options ? JSON.parse(q.options) : undefined,
    correctAnswer: q.correctAnswer,
    explanation: q.explanation,
    image: q.image ?? undefined,
    isBonus: q.isBonus,
  };
}

function mapExam(customExam: CustomExamWithQuestions): ExamConfig {
  return {
    id: customExam.id,
    name: customExam.name,
    durationMinutes: customExam.durationMinutes,
    maxMarks: customExam.maxMarks,
    cardDetails: customExam.cardDetails,
    scoring: {
      correct: customExam.scoringCorrect,
      incorrect: customExam.scoringIncorrect,
    },
    baseExamId: customExam.baseExamId ?? undefined,
    isPremium: customExam.isPremium,
    category: customExam.category ?? undefined,
    section: customExam.section ?? undefined,
    instructions: JSON.parse(customExam.instructions),
    paletteLegend: JSON.parse(customExam.paletteLegend),
    questions: customExam.questions.map(mapQuestion),
  };
}

export async function getCustomExam(examId: string): Promise<ExamConfig | null> {
  const customExam = await prisma.customExam.findUnique({
    where: { id: examId },
    include: { questions: { orderBy: { index: "asc" } } },
  });
  if (!customExam) return null;
  return mapExam(customExam);
}

export async function getAllCustomExams(): Promise<ExamConfig[]> {
  const exams = await prisma.customExam.findMany({
    where: { published: true },
    include: { questions: { orderBy: { index: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return exams.map(mapExam);
}

export async function getAllCustomExamsAdmin() {
  const exams = await prisma.customExam.findMany({
    include: { questions: { orderBy: { index: "asc" } } },
    orderBy: { createdAt: "desc" },
  });
  return exams.map((e) => ({ ...mapExam(e), published: e.published }));
}
