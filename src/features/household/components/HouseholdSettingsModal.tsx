"use client";

import { ContextHelpButton } from "@/shared/components/ui/ContextHelpButton";
import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Download, Link2, Loader2, Settings, ShieldCheck, Upload, Users } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from "@/shared/components/ui/dialog";
import { copyTextLazy } from "@/shared/lib/clipboard";
import { cn } from "@/shared/lib/utils";
import { exportBackup, importBackup } from "../server/backup.actions";
import { createInvite } from "../server/household.actions";
import type { Member, RestoreSummary } from "../schemas/household.schema";

const SECTION = "space-y-3 rounded-2xl bg-slate-50/60 p-4 dark:bg-zinc-800/60";
const SECTION_TITLE = "flex items-center gap-2 text-sm font-semibold text-slate-800 dark:text-zinc-200";
const HINT = "text-xs font-normal text-slate-500 dark:text-zinc-400";
const PILL =
  "inline-flex items-center gap-1.5 rounded-full bg-white px-3.5 py-1.5 text-xs font-medium text-slate-700 transition-colors hover:bg-slate-200 disabled:opacity-50 dark:bg-zinc-900 dark:text-zinc-200 dark:hover:bg-zinc-800";
const PRIMARY_PILL =
  "inline-flex items-center gap-1.5 rounded-full bg-sky-600 px-3.5 py-1.5 text-xs font-medium text-white transition-colors hover:bg-sky-700 disabled:opacity-50 dark:bg-sky-500 dark:text-white dark:hover:bg-sky-400";

type Message = { text: string; tone: "ok" | "error" };

function summaryText(s: RestoreSummary) {
  const f = (label: string, c: { inserted: number; total: number }) => `${label} ${c.inserted}/${c.total}`;
  return `복구 완료 — ${f("자산", s.assets)} · ${f("규칙", s.task_rules)} · ${f("과업", s.tasks)} · ${f("이력", s.event_logs)} (이미 있는 항목은 건너뛰었어요)`;
}

export function HouseholdSettingsModal({
  members,
  role,
  householdName,
}: {
  members: Member[];
  role: "ADMIN" | "MEMBER";
  householdName: string;
}) {
  const router = useRouter();
  const isAdmin = role === "ADMIN";
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState<Message | null>(null);
  const [busy, setBusy] = useState<"invite" | "export" | "import" | null>(null);
  const [pendingFile, setPendingFile] = useState<File | null>(null);
  const [, startTransition] = useTransition();
  const fileInput = useRef<HTMLInputElement>(null);

  async function onInvite() {
    setBusy("invite");
    setMessage(null);
    try {
      const result = await copyTextLazy(async () => {
        const res = await createInvite();
        if (!res.ok) throw new Error(res.error);
        return res.url;
      });
      setMessage(
        result.ok
          ? { text: "초대 링크가 복사되었습니다! 7일 동안 한 번만 사용할 수 있어요.", tone: "ok" }
          : { text: "링크는 만들었지만 복사하지 못했어요. 클립보드 권한을 확인해 주세요.", tone: "error" },
      );
    } catch (e) {
      setMessage({ text: e instanceof Error && e.message ? e.message : "초대 링크를 만들지 못했어요.", tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  async function onExport() {
    setBusy("export");
    setMessage(null);
    try {
      const res = await exportBackup();
      if (!res.ok) return setMessage({ text: res.error, tone: "error" });
      const url = URL.createObjectURL(new Blob([res.json], { type: "application/json" }));
      const a = document.createElement("a");
      a.href = url;
      a.download = res.filename;
      a.click();
      URL.revokeObjectURL(url);
      const c = res.counts;
      setMessage({
        text: `내보내기 완료 — 자산 ${c.assets} · 규칙 ${c.task_rules} · 과업 ${c.tasks} · 이력 ${c.event_logs}${res.truncated ? " (일부 잘림)" : ""}`,
        tone: "ok",
      });
    } catch {
      setMessage({ text: "내보내기 중 오류가 발생했어요.", tone: "error" });
    } finally {
      setBusy(null);
    }
  }

  function onRestore() {
    const file = pendingFile;
    if (!file) return;
    setBusy("import");
    setMessage(null);
    startTransition(async () => {
      try {
        const res = await importBackup(await file.text());
        if (res.ok) {
          setMessage({ text: summaryText(res.summary), tone: "ok" });
          setPendingFile(null);
          if (fileInput.current) fileInput.current.value = "";
          router.refresh();
        } else {
          setMessage({ text: res.error, tone: "error" });
        }
      } catch {
        setMessage({ text: "복구 중 오류가 발생했어요. (아무것도 변경되지 않았어요)", tone: "error" });
      } finally {
        setBusy(null);
      }
    });
  }

  return (
    <Dialog
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (!v) {
          setMessage(null);
          setPendingFile(null);
        }
      }}
    >
      <DialogTrigger asChild>
        <button
          type="button"
          aria-label="가구 설정"
          title="가구 설정"
          className="flex h-8 w-8 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-100 hover:text-slate-900 dark:text-zinc-400 dark:hover:bg-zinc-800 dark:hover:text-zinc-50"
        >
          <Settings className="h-4 w-4" />
        </button>
      </DialogTrigger>

      <DialogContent className="max-h-[90vh] max-w-lg overflow-y-auto rounded-3xl bg-white dark:bg-zinc-900">
        <DialogHeader>
          <div className="flex items-center gap-1 pr-6">
            <DialogTitle className="text-base font-semibold text-slate-800 dark:text-zinc-200">{householdName} 설정</DialogTitle>
            <ContextHelpButton topic="household_sync" />
          </div>
          <DialogDescription className={HINT}>구성원을 확인하고 가구 데이터를 백업·복구해요.</DialogDescription>
        </DialogHeader>

        <section className={SECTION} aria-label="구성원">
          <h3 className={SECTION_TITLE}>
            <Users className="h-4 w-4" />
            구성원 <span className={HINT}>{members.length}</span>
          </h3>
          <ul className="space-y-2">
            {members.map((m) => (
              <li key={m.id} className="flex items-center gap-3">
                <span className="flex h-8 w-8 items-center justify-center rounded-full bg-slate-100 text-xs font-semibold text-slate-600 ring-1 ring-inset ring-slate-200/70 dark:bg-zinc-800 dark:text-zinc-300 dark:ring-zinc-700/60">
                  {m.display_name.trim().charAt(0).toUpperCase()}
                </span>
                <span className="flex-1 truncate text-sm font-medium text-slate-900 dark:text-zinc-50">{m.display_name}</span>
                <span
                  className={cn(
                    "rounded-full border px-2 py-0.5 text-[11px] font-semibold",
                    m.role === "ADMIN"
                      ? "border-sky-200 bg-sky-50 text-sky-600 dark:border-sky-900 dark:bg-sky-950/40 dark:text-sky-400"
                      : "border-slate-200 bg-white text-slate-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400",
                  )}
                >
                  {m.role === "ADMIN" ? "관리자" : "구성원"}
                </span>
              </li>
            ))}
          </ul>
        </section>

        {isAdmin ? (
          <>
            <section className={SECTION} aria-label="구성원 초대">
              <h3 className={SECTION_TITLE}>
                <Link2 className="h-4 w-4" />
                구성원 초대
              </h3>
              <p className={HINT}>링크를 받은 사람이 가입(또는 로그인)하면 구성원으로 참여해요. 7일 동안, 한 번만 사용할 수 있어요.</p>
              <button type="button" onClick={onInvite} disabled={busy !== null} className={PRIMARY_PILL}>
                {busy === "invite" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Link2 className="h-3.5 w-3.5" />}
                초대 링크 만들기
              </button>
            </section>

            <section className={SECTION} aria-label="백업과 복구">
              <h3 className={SECTION_TITLE}>
                <ShieldCheck className="h-4 w-4" />
                백업 · 복구
              </h3>
              <p className={HINT}>
                자산, 관리 규칙, 과업(완료 이력 포함)을 JSON 파일로 저장하고 되돌려요. 복구는 기존 데이터를 지우지 않고, 없는 항목만
                추가해요. 첨부 파일 원본과 다른 구성원의 개인(PRIVATE) 데이터는 포함되지 않아요.
              </p>
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={onExport} disabled={busy !== null} className={PILL}>
                  {busy === "export" ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Download className="h-3.5 w-3.5" />}
                  JSON 내보내기
                </button>
                <button type="button" onClick={() => fileInput.current?.click()} disabled={busy !== null} className={PILL}>
                  <Upload className="h-3.5 w-3.5" />
                  JSON 복구
                </button>
                <input
                  ref={fileInput}
                  type="file"
                  accept="application/json,.json"
                  aria-label="백업 JSON 파일 선택"
                  className="sr-only"
                  onChange={(e) => {
                    setMessage(null);
                    setPendingFile(e.target.files?.[0] ?? null);
                  }}
                />
              </div>
              {pendingFile && (
                <div className="flex flex-wrap items-center gap-2 rounded-lg bg-amber-50 p-3 text-xs dark:bg-amber-950/30">
                  <span className="min-w-0 flex-1 truncate font-medium text-amber-700 dark:text-amber-400">
                    {pendingFile.name} 을(를) 복구할까요?
                  </span>
                  <button type="button" onClick={onRestore} disabled={busy !== null} className={PRIMARY_PILL}>
                    {busy === "import" && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                    복구 실행
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      setPendingFile(null);
                      if (fileInput.current) fileInput.current.value = "";
                    }}
                    disabled={busy !== null}
                    className={PILL}
                  >
                    취소
                  </button>
                </div>
              )}
            </section>
          </>
        ) : (
          <p className={HINT}>초대와 백업·복구는 관리자만 할 수 있어요.</p>
        )}

        {message && (
          <p
            role="status"
            className={cn(
              "rounded-lg border px-3 py-2 text-xs font-medium",
              message.tone === "ok"
                ? "border-emerald-200 bg-emerald-50 text-emerald-700 dark:border-emerald-900 dark:bg-emerald-950/40 dark:text-emerald-400"
                : "border-rose-200 bg-rose-50 text-rose-600 dark:border-rose-900 dark:bg-rose-950/40 dark:text-rose-400",
            )}
          >
            {message.text}
          </p>
        )}

        <p data-testid="household-privacy-note" className="rounded-2xl bg-slate-50 px-3.5 py-2.5 text-xs leading-relaxed text-slate-500 dark:bg-zinc-800/60 dark:text-zinc-400">
          <span aria-hidden>🛡️ </span>우리 가구의 데이터는 가구 단위로 격리(RLS)되어, 다른 가구는 볼 수 없어요. 개인(PRIVATE) 항목은 본인에게만 보여요.
        </p>
      </DialogContent>
    </Dialog>
  );
}
