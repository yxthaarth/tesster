import type { Route } from "next";
import { AdminLoginForm } from "@/components/admin-login-form";
import { getAllCustomExamsAdmin } from "@/lib/custom-exams";
import Link from "next/link";
import { logoutEmployee, verifyAdminSession } from "./actions";
import { DeleteTestButton } from "@/components/delete-test-button";
import { PublishToggleButton } from "@/components/publish-toggle-button";
import { prisma } from "@/lib/db";

export default async function AdminPage() {
  const isAuthenticated = await verifyAdminSession();

  if (!isAuthenticated) {
    return <AdminLoginForm />;
  }

  const [customExams, users] = await Promise.all([
    getAllCustomExamsAdmin(),
    prisma.user.findMany({
      orderBy: { createdAt: "desc" },
      select: { id: true, name: true, email: true, phone: true, createdAt: true, allAccess: true },
    }),
  ]);

  return (
    <div className="mx-auto max-w-5xl">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-2xl font-bold text-white">Exam Database</h2>
          <div className="mt-1 flex items-center gap-4">
            <p className="text-slate-400">Manage internal custom exams pushed to the platform.</p>
            <Link href={"/admin/layout" as Route} className="rounded-full bg-white/10 px-3 py-1 text-xs font-medium text-white transition hover:bg-white/20">
              Manage Layout
            </Link>
          </div>
        </div>
        <div className="flex items-center gap-3">
          <Link
            href={"/admin/tests/new" as Route}
            className="rounded-full bg-brand px-4 py-2 text-sm font-medium text-slate-950 transition hover:opacity-90"
          >
            + New Test
          </Link>
          <form action={logoutEmployee}>
            <button type="submit" className="rounded-full border border-white/10 px-4 py-2 text-sm text-slate-300 hover:bg-white/5">
              Log out
            </button>
          </form>
        </div>
      </div>

      <div className="mt-8 rounded-2xl border border-white/10 bg-[#171e29]">
        {customExams.length === 0 ? (
          <div className="p-8 text-center text-slate-400">
            No custom exams found.{" "}
            <Link href={"/admin/tests/new" as Route} className="text-brand">
              Create one
            </Link>.
          </div>
        ) : (
          <table className="w-full text-left text-sm">
            <thead className="border-b border-white/10 bg-white/5 text-slate-300">
              <tr>
                <th className="px-6 py-4 font-medium">Exam Name</th>
                <th className="px-6 py-4 font-medium">Duration</th>
                <th className="px-6 py-4 font-medium">Questions</th>
                <th className="px-6 py-4 font-medium">Status</th>
                <th className="px-6 py-4 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/10">
              {customExams.map((exam: any) => (
                <tr key={exam.id} className="text-slate-200">
                  <td className="px-6 py-4 font-medium">{exam.name}</td>
                  <td className="px-6 py-4">{exam.durationMinutes} mins</td>
                  <td className="px-6 py-4">{exam.questions.length}</td>
                  <td className="px-6 py-4">
                    <span className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-semibold ${
                      (exam as any).published
                        ? "bg-emerald-500/15 text-emerald-400"
                        : "bg-amber-500/15 text-amber-400"
                    }`}>
                      {(exam as any).published ? "Published" : "Draft"}
                    </span>
                  </td>
                  <td className="px-6 py-4">
                    <div className="flex items-center gap-3">
                      <Link
                        href={`/admin/tests/${exam.id}/edit` as Route}
                        className="text-blue-400 hover:underline"
                      >
                        Edit
                      </Link>
                      <Link
                        href={(exam.baseExamId ? `/exam/${exam.baseExamId}?testId=${exam.id}` : `/exam/${exam.id}`) as Route}
                        className="text-brand hover:underline"
                      >
                        Preview
                      </Link>
                      <PublishToggleButton
                        examId={exam.id}
                        published={(exam as any).published}
                      />
                      <DeleteTestButton examId={exam.id} />
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Users ── */}
      <div className="mt-12">
        <h2 className="text-xl font-bold text-white">Registered Users <span className="ml-2 text-sm font-normal text-slate-400">({users.length})</span></h2>
        <div className="mt-4 rounded-2xl border border-white/10 bg-[#171e29]">
          {users.length === 0 ? (
            <div className="p-8 text-center text-slate-400">No users registered yet.</div>
          ) : (
            <table className="w-full text-left text-sm">
              <thead className="border-b border-white/10 bg-white/5 text-slate-300">
                <tr>
                  <th className="px-6 py-4 font-medium">Name</th>
                  <th className="px-6 py-4 font-medium">Email</th>
                  <th className="px-6 py-4 font-medium">Phone</th>
                  <th className="px-6 py-4 font-medium">Joined</th>
                  <th className="px-6 py-4 font-medium">Access</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-white/10">
                {users.map((u) => (
                  <tr key={u.id} className="text-slate-200">
                    <td className="px-6 py-4 font-medium">{u.name}</td>
                    <td className="px-6 py-4 text-slate-400">{u.email}</td>
                    <td className="px-6 py-4 text-slate-400">{u.phone ?? <span className="text-slate-600">—</span>}</td>
                    <td className="px-6 py-4 text-slate-500 text-xs">{new Date(u.createdAt).toLocaleDateString()}</td>
                    <td className="px-6 py-4">
                      {u.allAccess
                        ? <span className="rounded-full bg-emerald-500/15 px-2 py-0.5 text-xs font-semibold text-emerald-400">All Access</span>
                        : <span className="rounded-full bg-white/5 px-2 py-0.5 text-xs text-slate-500">Free</span>}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
