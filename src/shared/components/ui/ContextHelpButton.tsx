"use client";

import { useState } from "react";
import { HelpCircle } from "lucide-react";
import { SlideTutorialModal } from "@/shared/components/help/SlideTutorialModal";
import { HELP_CONTENT, type HelpEntry, type HelpTopicKey } from "@/shared/constants/help-content";
import { cn } from "@/shared/lib/utils";

type Props = ({ topic: HelpTopicKey } | ({ topic?: undefined } & HelpEntry)) & { className?: string };

/** 섹션 제목 옆 "사용 가이드" 캡슐 뱃지. 누르면 3단계 슬라이드 튜토리얼이 열린다. */
export function ContextHelpButton(props: Props) {
  const [open, setOpen] = useState(false);
  const entry: HelpEntry = props.topic ? HELP_CONTENT[props.topic] : { title: props.title, label: props.label, steps: props.steps };

  return (
    <>
      <button
        type="button"
        data-testid="help-btn"
        data-help-topic={props.topic ?? "custom"}
        aria-label={`${entry.title} ${entry.label}`}
        onClick={() => setOpen(true)}
        // min-h-8 = 터치 영역 32px. shrink-0 + whitespace-nowrap: 라벨이 줄바꿈으로 깨지지 않고, 자리가 모자라면 부모 flex-wrap이 통째로 내린다.
        className={cn("inline-flex min-h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-full border border-sky-200/80 bg-sky-50 px-2.5 py-1 text-xs font-semibold text-sky-600 shadow-sm transition-all hover:bg-sky-100 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:border-sky-900/70 dark:bg-sky-950/40 dark:text-sky-300 dark:hover:bg-sky-950/70", props.className)}
      >
        <HelpCircle size={13} strokeWidth={2.5} aria-hidden />
        {entry.label}
      </button>
      <SlideTutorialModal open={open} onOpenChange={setOpen} entry={entry} />
    </>
  );
}
