"use client";

import { useState } from "react";
import { Mic, MessageSquareText, Square } from "lucide-react";
import { Input } from "@/shared/components/ui/input";
import { cn } from "@/shared/lib/utils";
import { useSpeechRecognition } from "../hooks/use-speech-recognition";

/**
 * One-line "말로 정리" bar: type (or speak, where the browser has the Web Speech API) what happened to the groceries —
 * "대파 1대 쓰고 삼겹살은 냉동실로 보냈어, 치킨 22000원 배달" — and hand the sentence to the confirmation dialog.
 */
export function SmartCheckoutBar({ onSubmit }: { onSubmit: (text: string) => void }) {
  const [text, setText] = useState("");
  const speech = useSpeechRecognition(setText);

  function go(e: React.FormEvent) {
    e.preventDefault();
    const t = text.trim();
    if (!t) return;
    speech.stop();
    onSubmit(t);
  }

  return (
    <form onSubmit={go} data-testid="checkout-bar" role="search" aria-label="말로 정리" className="space-y-1.5">
      <div className="flex items-center gap-2">
        <div className="relative min-w-0 flex-1">
          <Input
            data-testid="checkout-input"
            value={text}
            onChange={(e) => setText(e.target.value)}
            maxLength={500}
            placeholder="예: 대파 1대 쓰고 삼겹살은 냉동실로 보냈어"
            aria-label="냉장고에 일어난 일을 한 줄로 적기"
            className={cn("h-10 pr-10", speech.listening && "border-rose-400 ring-1 ring-rose-400 dark:border-rose-500 dark:ring-rose-500")}
          />
          {speech.supported && (
            <button
              type="button"
              data-testid="checkout-mic"
              aria-label={speech.listening ? "음성 입력 멈추기" : "음성으로 말하기"}
              aria-pressed={speech.listening}
              onClick={speech.listening ? speech.stop : speech.start}
              className={cn(
                "absolute right-1 top-1 inline-flex h-8 w-8 items-center justify-center rounded-md transition-colors",
                speech.listening ? "bg-rose-600 text-white dark:bg-rose-500 dark:text-black" : "text-zinc-500 hover:bg-zinc-100 hover:text-zinc-900 dark:text-zinc-400 dark:hover:bg-zinc-900 dark:hover:text-zinc-50",
              )}
            >
              {speech.listening ? <Square className="h-3.5 w-3.5 fill-current" aria-hidden /> : <Mic className="h-4 w-4" aria-hidden />}
            </button>
          )}
        </div>
        <button
          type="submit"
          data-testid="checkout-submit"
          disabled={!text.trim()}
          className="inline-flex h-10 shrink-0 items-center gap-1.5 rounded-lg border border-zinc-200 px-3.5 text-sm font-medium text-zinc-900 transition-colors hover:bg-zinc-100 disabled:opacity-50 dark:border-zinc-800 dark:text-zinc-100 dark:hover:bg-zinc-900"
        >
          <MessageSquareText className="h-4 w-4" aria-hidden /> 말로 정리
        </button>
      </div>
      {speech.listening && (
        <p role="status" data-testid="checkout-listening" className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
          듣고 있어요… 말씀하세요.
        </p>
      )}
      {speech.error && (
        <p role="alert" className="text-[11px] font-medium text-rose-600 dark:text-rose-400">
          {speech.error}
        </p>
      )}
    </form>
  );
}
