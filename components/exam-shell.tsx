"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { Route } from "next";
import { useRouter } from "next/navigation";
import clsx from "clsx";
import type { ExamConfig } from "@/lib/exams";
import {
  calculateResult,
  createInitialState,
  findQuestionIndex,
  getQuestionStatus,
  getVisibleQuestions,
  shouldUnlockBonus,
  type QuestionStatus,
} from "@/lib/exam-engine";
import { useAuth } from "@/components/auth-context";
import { canAccessMockTest } from "@/lib/premium-access";
import { recordAttemptFromResult } from "@/lib/user-attempts";

type ExamShellProps = {
  exam: ExamConfig;
  testId?: string;
};

// NTA colour scheme
const statusStyles: Record<QuestionStatus, string> = {
  notVisited:   "bg-[#d3d3d3] text-[#333] border border-[#aaa]",
  answered:     "bg-[#27ae60] text-white border border-[#1e8449]",
  notAnswered:  "bg-[#e74c3c] text-white border border-[#c0392b]",
  marked:       "bg-[#8e44ad] text-white border border-[#6c3483]",
  answeredMarked: "bg-[#8e44ad] text-white border border-[#6c3483] ring-2 ring-[#27ae60]",
};

const legendItems: { status: QuestionStatus; label: string }[] = [
  { status: "notVisited",     label: "Not Visited" },
  { status: "notAnswered",    label: "Not Answered" },
  { status: "answered",       label: "Answered" },
  { status: "marked",         label: "Marked for Review" },
  { status: "answeredMarked", label: "Answered & Marked for Review (will be considered for evaluation)" },
];

export function ExamShell({ exam, testId }: ExamShellProps) {
  const router = useRouter();
  const { user, hasPremiumForExam } = useAuth();
  const [state, setState] = useState(() => createInitialState(exam));
  const [tabWarning, setTabWarning] = useState(false);
  const [showSubmitConfirm, setShowSubmitConfirm] = useState(false);
  const [activeSection, setActiveSection] = useState<string | null>(null);
  // Keep a ref to the latest state so the timer callback can read it
  const stateRef = useRef(state);
  useEffect(() => { stateRef.current = state; }, [state]);

  const resolvedTestId = testId?.trim() || `${exam.id}-open`;

  const canAccess = useMemo(
    () => canAccessMockTest(exam.id, resolvedTestId, hasPremiumForExam),
    [exam.id, resolvedTestId, hasPremiumForExam],
  );

  const visibleQuestions = useMemo(
    () => getVisibleQuestions(exam, state.unlockedBonus),
    [exam, state.unlockedBonus],
  );

  const currentIndex = useMemo(
    () => findQuestionIndex(visibleQuestions, state.currentQuestionId),
    [visibleQuestions, state.currentQuestionId],
  );

  const currentQuestion = visibleQuestions[currentIndex];

  // Derive ordered subject→sections map from questions
  const subjectSections = useMemo(() => {
    const map = new Map<string, string[]>();
    for (const q of visibleQuestions) {
      if (!map.has(q.subject)) map.set(q.subject, []);
      const sections = map.get(q.subject)!;
      if (!sections.includes(q.section)) sections.push(q.section);
    }
    return map;
  }, [visibleQuestions]);

  // All sections in order
  const allSections = useMemo(() => {
    const result: string[] = [];
    subjectSections.forEach((sections) => sections.forEach((s) => result.push(s)));
    return result;
  }, [subjectSections]);

  // Default active section on mount
  useEffect(() => {
    if (allSections.length > 0 && activeSection === null) {
      setActiveSection(allSections[0]);
    }
  }, [allSections, activeSection]);

  // Sync active section when navigating questions
  useEffect(() => {
    if (currentQuestion) setActiveSection(currentQuestion.section);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [currentQuestion?.id]);

  // ── Fullscreen on mount ──────────────────────────────────────────────────
  useEffect(() => {
    if (!canAccess) return;
    const el = document.documentElement;
    if (el.requestFullscreen) {
      el.requestFullscreen().catch(() => {/* user may deny */});
    }
    return () => {
      if (document.fullscreenElement) {
        document.exitFullscreen().catch(() => {});
      }
    };
  }, [canAccess]);

  // ── Tab-visibility warning ───────────────────────────────────────────────
  useEffect(() => {
    if (!canAccess) return;
    const handleVisibility = () => {
      if (document.hidden) setTabWarning(true);
    };
    document.addEventListener("visibilitychange", handleVisibility);
    return () => document.removeEventListener("visibilitychange", handleVisibility);
  }, [canAccess]);

  // ── Countdown timer ──────────────────────────────────────────────────────
  useEffect(() => {
    if (!canAccess) return;
    const timer = window.setInterval(() => {
      setState((prev) => {
        if (prev.remainingSeconds <= 1) {
          window.clearInterval(timer);
          // Use setTimeout to call finaliseExam outside the setState callback
          setTimeout(() => finaliseExam(stateRef.current), 0);
          return { ...prev, remainingSeconds: 0 };
        }
        return {
          ...prev,
          remainingSeconds: prev.remainingSeconds - 1,
          timeSpent: {
            ...prev.timeSpent,
            [prev.currentQuestionId]: (prev.timeSpent[prev.currentQuestionId] ?? 0) + 1,
          },
        };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [canAccess]);

  // ── Bonus unlock ─────────────────────────────────────────────────────────
  useEffect(() => {
    if (!exam.bonusUnlock || state.unlockedBonus) return;
    if (shouldUnlockBonus(exam, state.answers)) {
      setState((prev) => ({ ...prev, unlockedBonus: true }));
    }
  }, [exam, state.answers, state.unlockedBonus]);

  // ── Navigation helpers ───────────────────────────────────────────────────
  const goToQuestion = (questionId: string) => {
    setState((prev) => ({
      ...prev,
      currentQuestionId: questionId,
      visited: { ...prev.visited, [questionId]: true },
      statuses: {
        ...prev.statuses,
        [questionId]: getQuestionStatus(
          Boolean(prev.answers[questionId]),
          Boolean(prev.review[questionId]),
          true,
        ),
      },
    }));
  };

  const saveAndNext = (mode: "save" | "review") => {
    const next = visibleQuestions[currentIndex + 1];
    setState((prev) => {
      const hasAnswer = Boolean(prev.answers[currentQuestion.id]);
      const review = mode === "review" ? true : Boolean(prev.review[currentQuestion.id]);
      const updatedReview = { ...prev.review, [currentQuestion.id]: review };
      const updatedStatuses = {
        ...prev.statuses,
        [currentQuestion.id]: getQuestionStatus(hasAnswer, review, true),
      };
      if (!next) return { ...prev, review: updatedReview, statuses: updatedStatuses };
      return {
        ...prev,
        review: updatedReview,
        statuses: updatedStatuses,
        currentQuestionId: next.id,
        visited: { ...prev.visited, [next.id]: true },
      };
    });
  };

  const clearResponse = () => {
    setState((prev) => {
      const answers = { ...prev.answers };
      delete answers[currentQuestion.id];
      return {
        ...prev,
        answers,
        review: { ...prev.review, [currentQuestion.id]: false },
        statuses: {
          ...prev.statuses,
          [currentQuestion.id]: getQuestionStatus(false, false, true),
        },
      };
    });
  };

  const goBack = () => {
    const prev = visibleQuestions[currentIndex - 1];
    if (prev) goToQuestion(prev.id);
  };

  // Shared save + navigate — used by both manual submit and timer expiry
  const finaliseExam = async (currentState: typeof state) => {
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    const result = calculateResult(exam, currentState);
    sessionStorage.setItem(`tesster-result-${exam.id}`, JSON.stringify(result));
    recordAttemptFromResult(exam, result, resolvedTestId);

    let resultId: string | null = null;
    try {
      const res = await fetch("/api/results", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "include",
        body: JSON.stringify(result),
      });
      const data = await res.json();
      console.log("[finaliseExam] POST /api/results →", res.status, data);
      if (data.resultId) resultId = data.resultId;
      // Store resultId in localStorage so mock-tests board can link to it
      if (resultId) {
        try {
          localStorage.setItem(`tesster-resultId-${resolvedTestId}`, resultId);
          localStorage.setItem(`tesster-resultId-${exam.id}`, resultId);
        } catch {}
      }
    } catch (e) {
      console.error("[finaliseExam] fetch failed:", e);
    }

    const url = resultId
      ? `/results?exam=${exam.id}&resultId=${resultId}`
      : `/results?exam=${exam.id}`;
    console.log("[finaliseExam] Navigating to:", url);
    router.push(url as any);
  };

  const submitExam = async () => { await finaliseExam(state); };

  // ── Counts ───────────────────────────────────────────────────────────────
  const counts = useMemo(() => {
    const c = { notVisited: 0, answered: 0, notAnswered: 0, marked: 0, answeredMarked: 0 };
    for (const q of visibleQuestions) {
      const s = state.statuses[q.id] ?? "notVisited";
      c[s] = (c[s] ?? 0) + 1;
    }
    return c;
  }, [visibleQuestions, state.statuses]);

  // ── Premium gate ─────────────────────────────────────────────────────────
  if (!canAccess) {
    return (
      <main className="mx-auto max-w-2xl px-4 py-16 sm:px-6 lg:px-10">
        <div className="official-panel p-8 text-center">
          <p className="text-sm font-semibold uppercase tracking-[0.28em] text-brand">Premium required</p>
          <h1 className="mt-4 font-[family-name:var(--font-display)] text-3xl font-semibold text-ink">
            This mock is part of the {exam.name} premium pack
          </h1>
          <p className="mt-3 text-muted">Upgrade to unlock every listed paper for this exam.</p>
          <div className="mt-8 flex flex-wrap justify-center gap-3">
            <Link href={`/pricing?exam=${exam.id}` as Route} className="inline-flex rounded-full bg-brand px-6 py-3 text-sm font-semibold text-white transition hover:opacity-90">
              View plans
            </Link>
            <Link href={`/mock-tests?exam=${exam.id}` as Route} className="inline-flex rounded-full border border-line/80 bg-panel px-6 py-3 text-sm font-medium text-ink transition hover:bg-surface">
              Back to mock tests
            </Link>
          </div>
        </div>
      </main>
    );
  }

  return (
    <div className="flex h-screen flex-col overflow-hidden bg-white text-[#222] select-none">

      {/* ── Tab-switch warning overlay ── */}
      {tabWarning && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/70">
          <div className="w-full max-w-md rounded-lg border-2 border-red-500 bg-white p-8 text-center shadow-2xl">
            <p className="text-2xl font-bold text-red-600">⚠ Warning</p>
            <p className="mt-3 text-base text-gray-700">
              You switched tabs or left the exam window. This activity has been noted.
              Please stay on this page for the duration of the test.
            </p>
            <button
              type="button"
              onClick={() => setTabWarning(false)}
              className="mt-6 rounded bg-red-600 px-8 py-2 font-semibold text-white hover:bg-red-700"
            >
              Resume Test
            </button>
          </div>
        </div>
      )}

      {/* ── Submit confirmation overlay ── */}
      {showSubmitConfirm && (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-black/60">
          <div className="w-full max-w-sm rounded-lg border border-gray-300 bg-white p-7 shadow-2xl">
            <p className="text-lg font-bold text-gray-800">Submit Test?</p>
            <p className="mt-2 text-sm text-gray-600">
              Answered: <strong>{counts.answered + counts.answeredMarked}</strong> &nbsp;|&nbsp;
              Not Answered: <strong>{counts.notAnswered}</strong> &nbsp;|&nbsp;
              Not Visited: <strong>{counts.notVisited}</strong>
            </p>
            <p className="mt-3 text-sm text-gray-600">Are you sure you want to submit? This action cannot be undone.</p>
            <div className="mt-5 flex justify-end gap-3">
              <button type="button" onClick={() => setShowSubmitConfirm(false)} className="rounded border border-gray-300 px-5 py-2 text-sm font-medium text-gray-700 hover:bg-gray-100">
                Cancel
              </button>
              <button type="button" onClick={submitExam} className="rounded bg-[#27ae60] px-5 py-2 text-sm font-semibold text-white hover:bg-[#1e8449]">
                Submit
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ══════════════════════════════════════════════════════════════════
          TOP BAR
      ══════════════════════════════════════════════════════════════════ */}
      <header className="flex shrink-0 items-center gap-4 border-b border-gray-300 bg-[#f5f5f5] px-4 py-2">
        {/* Avatar + candidate info */}
        <div className="flex items-center gap-3">
          <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded border border-gray-400 bg-gray-200 text-gray-500">
            <svg viewBox="0 0 24 24" className="h-8 w-8 fill-current"><path d="M12 12c2.7 0 4.8-2.1 4.8-4.8S14.7 2.4 12 2.4 7.2 4.5 7.2 7.2 9.3 12 12 12zm0 2.4c-3.2 0-9.6 1.6-9.6 4.8v2.4h19.2v-2.4c0-3.2-6.4-4.8-9.6-4.8z"/></svg>
          </div>
          <div className="text-xs leading-5">
            <div>Candidate Name : <span className="font-bold text-[#c0392b] uppercase">{user?.name ?? "Guest"}</span></div>
            <div>Exam Name : <span className="font-bold text-[#c0392b]">{exam.name}</span></div>
            <div className="flex items-center gap-2">
              Remaining Time :
              <span className="inline-block rounded bg-[#27ae60] px-2 py-0.5 font-mono font-bold text-white">
                {formatTimer(state.remainingSeconds)}
              </span>
            </div>
          </div>
        </div>
      </header>

      {/* ══════════════════════════════════════════════════════════════════
          SUBJECT NAV BAR
      ══════════════════════════════════════════════════════════════════ */}
      <nav className="shrink-0 border-b border-gray-300 bg-[#1a3a5c]">
        <div className="flex overflow-x-auto">
          {Array.from(subjectSections.entries()).map(([subject, sections]) => (
            <div key={subject} className="flex shrink-0 items-stretch">
              {sections.map((section) => {
                const isActive = activeSection === section;
                // Count answered in this section
                const sectionQs = visibleQuestions.filter((q) => q.section === section);
                const answeredInSection = sectionQs.filter(
                  (q) => state.statuses[q.id] === "answered" || state.statuses[q.id] === "answeredMarked"
                ).length;
                return (
                  <button
                    key={section}
                    type="button"
                    onClick={() => {
                      setActiveSection(section);
                      const first = visibleQuestions.find((q) => q.section === section);
                      if (first) goToQuestion(first.id);
                    }}
                    className={clsx(
                      "flex flex-col items-center justify-center border-r border-white/10 px-4 py-2 text-center transition",
                      isActive
                        ? "bg-white text-[#1a3a5c]"
                        : "text-white hover:bg-white/10",
                    )}
                  >
                    <span className="text-[11px] font-bold uppercase tracking-wide">{subject}</span>
                    <span className={clsx("text-[10px]", isActive ? "text-[#1a3a5c]/70" : "text-white/70")}>
                      {section.includes("Numerical") || section.includes("Section B") ? "Section B" : "Section A"}
                    </span>
                    <span className={clsx("mt-0.5 text-[10px] font-semibold", isActive ? "text-[#27ae60]" : "text-[#7dcea0]")}>
                      {answeredInSection}/{sectionQs.length}
                    </span>
                  </button>
                );
              })}
            </div>
          ))}
        </div>
      </nav>

      {/* ══════════════════════════════════════════════════════════════════
          BODY  (question panel  |  palette panel)
      ══════════════════════════════════════════════════════════════════ */}
      <div className="flex min-h-0 flex-1 overflow-hidden">

        {/* ── LEFT: question area ── */}
        <div className="flex min-w-0 flex-1 flex-col border-r border-gray-300">

          {/* Question header */}
          <div className="flex shrink-0 items-center justify-between border-b border-gray-300 bg-[#e8f4fd] px-4 py-2">
            <span className="font-semibold text-[#1a5276]">Question No {currentIndex + 1}</span>
            <span className="text-xs text-gray-500">{currentQuestion.section}</span>
          </div>

          {/* Question body — scrollable */}
          <div className="flex-1 overflow-y-auto px-5 py-4 text-sm leading-7">
            <p className="whitespace-pre-wrap text-[15px] leading-7 text-gray-800">{currentQuestion.text}</p>
            {currentQuestion.image && (
              <img src={currentQuestion.image} alt="" className="mt-4 max-h-56 object-contain" />
            )}

            <div className="mt-5 space-y-3">
              {currentQuestion.type === "mcq" ? (
                currentQuestion.options?.map((opt, idx) => (
                  <label
                    key={opt.text || idx}
                    className={clsx(
                      "flex cursor-pointer items-start gap-3 rounded border px-4 py-3 transition",
                      state.answers[currentQuestion.id] === opt.text
                        ? "border-[#2980b9] bg-[#d6eaf8]"
                        : "border-gray-300 bg-white hover:bg-gray-50",
                    )}
                  >
                    <input
                      type="radio"
                      name={currentQuestion.id}
                      checked={state.answers[currentQuestion.id] === opt.text}
                      onChange={() =>
                        setState((prev) => ({
                          ...prev,
                          answers: { ...prev.answers, [currentQuestion.id]: opt.text },
                          statuses: {
                            ...prev.statuses,
                            [currentQuestion.id]: getQuestionStatus(true, Boolean(prev.review[currentQuestion.id]), true),
                          },
                        }))
                      }
                      className="mt-1 h-4 w-4 shrink-0 accent-[#2980b9]"
                    />
                    <div className="flex flex-col gap-1">
                      {opt.text && <span>{`${idx + 1}) ${opt.text}`}</span>}
                      {opt.image && <img src={opt.image} alt="Option" className="max-h-28 object-contain" />}
                    </div>
                  </label>
                ))
              ) : (
                <input
                  type="number"
                  value={state.answers[currentQuestion.id] ?? ""}
                  onChange={(e) =>
                    setState((prev) => {
                      const val = e.target.value;
                      const answers = { ...prev.answers };
                      if (val) answers[currentQuestion.id] = val;
                      else delete answers[currentQuestion.id];
                      return {
                        ...prev,
                        answers,
                        statuses: {
                          ...prev.statuses,
                          [currentQuestion.id]: getQuestionStatus(Boolean(val), Boolean(prev.review[currentQuestion.id]), true),
                        },
                      };
                    })
                  }
                  placeholder="Enter numerical value"
                  className="w-48 rounded border border-gray-400 px-3 py-2 text-sm outline-none focus:border-[#2980b9]"
                />
              )}
            </div>
          </div>

          {/* Action buttons */}
          <div className="shrink-0 border-t border-gray-300 bg-[#f5f5f5] px-4 py-3 space-y-2">
            <div className="flex flex-wrap gap-2">
              <button
                type="button"
                onClick={() => saveAndNext("save")}
                className="rounded bg-[#27ae60] px-4 py-2 text-xs font-bold text-white hover:bg-[#1e8449]"
              >
                SAVE &amp; NEXT
              </button>
              <button
                type="button"
                onClick={clearResponse}
                className="rounded border border-gray-400 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100"
              >
                CLEAR
              </button>
              <button
                type="button"
                onClick={() => saveAndNext("review")}
                className="rounded bg-[#e67e22] px-4 py-2 text-xs font-bold text-white hover:bg-[#ca6f1e]"
              >
                SAVE &amp; MARK FOR REVIEW
              </button>
              <button
                type="button"
                onClick={() => {
                  setState((prev) => ({
                    ...prev,
                    review: { ...prev.review, [currentQuestion.id]: true },
                    statuses: {
                      ...prev.statuses,
                      [currentQuestion.id]: getQuestionStatus(
                        Boolean(prev.answers[currentQuestion.id]),
                        true,
                        true,
                      ),
                    },
                  }));
                  const next = visibleQuestions[currentIndex + 1];
                  if (next) goToQuestion(next.id);
                }}
                className="rounded bg-[#2980b9] px-4 py-2 text-xs font-bold text-white hover:bg-[#1f618d]"
              >
                MARK FOR REVIEW &amp; NEXT
              </button>
            </div>

            <div className="flex items-center justify-between">
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={goBack}
                  disabled={currentIndex === 0}
                  className="rounded border border-gray-400 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                >
                  &lt;&lt; BACK
                </button>
                <button
                  type="button"
                  onClick={() => {
                    const next = visibleQuestions[currentIndex + 1];
                    if (next) goToQuestion(next.id);
                  }}
                  disabled={currentIndex === visibleQuestions.length - 1}
                  className="rounded border border-gray-400 bg-white px-4 py-2 text-xs font-bold text-gray-700 hover:bg-gray-100 disabled:opacity-40"
                >
                  NEXT &gt;&gt;
                </button>
              </div>
              <button
                type="button"
                onClick={() => setShowSubmitConfirm(true)}
                className="rounded bg-[#27ae60] px-6 py-2 text-xs font-bold text-white hover:bg-[#1e8449]"
              >
                Submit
              </button>
            </div>
          </div>
        </div>

        {/* ── RIGHT: palette panel ── */}
        <div className="flex w-[260px] shrink-0 flex-col overflow-y-auto bg-white">

          {/* Legend */}
          <div className="border-b border-gray-300 p-3">
            <div className="rounded border border-dashed border-gray-400 p-2 space-y-1.5">
              {legendItems.map(({ status, label }) => (
                <div key={status} className="flex items-start gap-2 text-[11px] leading-4">
                  <span className={clsx("mt-0.5 inline-flex h-5 w-5 shrink-0 items-center justify-center rounded text-[10px] font-bold", statusStyles[status])}>
                    {counts[status]}
                  </span>
                  <span className="text-gray-700">{label}</span>
                </div>
              ))}
            </div>
          </div>

          {/* Question grid — filtered to active section */}
          <div className="flex-1 p-3">
            <p className="mb-2 text-xs font-semibold text-gray-600">
              {activeSection ?? "Questions"}
            </p>
            <div className="grid grid-cols-8 gap-1">
              {visibleQuestions
                .filter((q) => !activeSection || q.section === activeSection)
                .map((q) => {
                  const idx = visibleQuestions.indexOf(q);
                  const status = state.statuses[q.id] ?? "notVisited";
                  return (
                    <button
                      key={q.id}
                      type="button"
                      onClick={() => goToQuestion(q.id)}
                      className={clsx(
                        "flex h-7 w-7 items-center justify-center rounded text-[11px] font-semibold transition hover:opacity-80",
                        statusStyles[status],
                        state.currentQuestionId === q.id && "outline outline-2 outline-offset-1 outline-[#2980b9]",
                      )}
                    >
                      {idx + 1}
                    </button>
                  );
                })}
            </div>
          </div>

          {/* BITSAT bonus note */}
          {exam.bonusUnlock && (
            <div className="border-t border-gray-300 p-3 text-[11px] text-gray-600">
              Attempt all {exam.bonusUnlock.baseQuestionCount} base questions to unlock{" "}
              {exam.bonusUnlock.bonusQuestionCount} bonus questions.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

function formatTimer(totalSeconds: number) {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  return [h, m, s].map((u) => String(u).padStart(2, "0")).join(":");
}
