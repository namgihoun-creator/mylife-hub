"use client";

import { useState } from "react";
import { HelpCircle, Lightbulb } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { HELP_CONTENT, type HelpEntry, type HelpTopicKey } from "@/shared/constants/help-content";
import { cn } from "@/shared/lib/utils";

type Props = ({ topic: HelpTopicKey } | ({ topic?: undefined } & HelpEntry)) & { className?: string };

/** 섹션 제목 옆 작은 ? 버튼. 누르면 컴팩트 도움말 모달(설명 + 꿀팁)이 열린다. */
export function ContextHelpButton(props: Props) {
  const [open, setOpen] = useState(false);
  const entry: HelpEntry = props.topic ? HELP_CONTENT[props.topic] : { title: props.title, content: props.content, tips: props.tips };

  return (
    <>
      <button
        type="button"
        data-testid="help-btn"
        data-help-topic={props.topic ?? "custom"}
        aria-label={`${entry.title} 도움말`}
        onClick={() => setOpen(true)}
        // 터치 영역 32px 이상 (아이콘은 15px)
        className={cn("inline-flex min-h-[32px] min-w-[32px] shrink-0 items-center justify-center rounded-full text-slate-400 transition-colors hover:bg-sky-50 hover:text-sky-600 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:text-zinc-500 dark:hover:bg-sky-950/40 dark:hover:text-sky-300", props.className)}
      >
        <HelpCircle size={15} strokeWidth={2.2} aria-hidden />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent data-testid="help-dialog" className="w-[calc(100%-2rem)] max-w-sm gap-4 rounded-3xl bg-slate-50 p-5 dark:bg-zinc-900">
          <DialogHeader className="space-y-2 pr-6 text-left">
            <span className="inline-flex w-fit items-center gap-1 rounded-full bg-sky-100 px-2.5 py-0.5 text-[11px] font-bold text-sky-700 dark:bg-sky-950/50 dark:text-sky-300">
              <HelpCircle size={12} strokeWidth={2.4} aria-hidden /> 도움말
            </span>
            <DialogTitle className="text-base font-extrabold text-slate-900 dark:text-zinc-50">{entry.title}</DialogTitle>
            <DialogDescription className="text-sm font-medium leading-relaxed text-slate-600 dark:text-zinc-300">{entry.content}</DialogDescription>
          </DialogHeader>
          {entry.tips.length > 0 && (
            <ul className="space-y-2 rounded-2xl bg-white p-3.5 shadow-sm dark:bg-zinc-800">
              {entry.tips.map((t) => (
                <li key={t} className="flex gap-2 text-xs font-medium leading-relaxed text-slate-600 dark:text-zinc-300">
                  <Lightbulb className="mt-0.5 h-3.5 w-3.5 shrink-0 text-amber-500 dark:text-amber-300" aria-hidden />
                  <span>{t}</span>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => setOpen(false)}
            className="inline-flex min-h-11 w-full items-center justify-center rounded-2xl bg-sky-600 px-4 text-sm font-bold text-white transition-colors hover:bg-sky-700 dark:bg-sky-500 dark:hover:bg-sky-400"
          >
            확인했어요
          </button>
        </DialogContent>
      </Dialog>
    </>
  );
}
