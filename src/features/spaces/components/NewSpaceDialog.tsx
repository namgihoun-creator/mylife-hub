"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { Camera, Image as ImageIcon, Loader2, Plus } from "lucide-react";
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from "@/shared/components/ui/dialog";
import { GRADIENT_CTA } from "@/shared/components/ui/gradient-cta";
import { createSpace, setSpacePhoto } from "../server/space.actions";
import { uploadSpacePhoto } from "../utils/space-photo";
import { ROOM_OPTIONS, STYLE_OPTIONS, type RoomType } from "../schemas/space-constants";
import { cn } from "@/shared/lib/utils";

const pill = (on: boolean) =>
  cn(
    "min-h-9 shrink-0 whitespace-nowrap rounded-full px-3.5 text-xs font-bold transition-all active:scale-95",
    on ? "bg-sky-600 text-white shadow-sm dark:bg-sky-500" : "bg-slate-100 text-slate-600 hover:bg-slate-200 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700",
  );
const outlineBtn =
  "inline-flex min-h-11 items-center gap-1.5 rounded-2xl bg-white px-4 py-2 text-sm font-bold text-slate-700 shadow-sm hover:bg-slate-100 active:scale-95 dark:bg-zinc-800 dark:text-zinc-100";

/** "+ 새 공간 등록": name, purpose, style and (optionally) the photo; then straight to the new space's page. */
export function NewSpaceDialog({ householdId }: { householdId: string }) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [room, setRoom] = useState<RoomType>("living");
  const [style, setStyle] = useState<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const camera = useRef<HTMLInputElement>(null);
  const gallery = useRef<HTMLInputElement>(null);

  const reset = () => {
    setName("");
    setRoom("living");
    setStyle(null);
    setFile(null);
    setError(null);
  };

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const created = await createSpace({ name, roomType: room, style });
    if (!created.ok) {
      setBusy(false);
      return setError(created.error);
    }
    if (file) {
      try {
        const path = await uploadSpacePhoto(householdId, created.id, file);
        await setSpacePhoto(created.id, path);
      } catch {
        /* the space exists; its page asks for the photo again */
      }
    }
    setBusy(false);
    setOpen(false);
    reset();
    router.push(`/spaces/${created.id}`);
  };

  return (
    <>
      <button type="button" data-testid="space-new" onClick={() => setOpen(true)} className={GRADIENT_CTA}>
        <Plus size={18} strokeWidth={2.5} aria-hidden /> 새 공간 등록
      </button>
      <Dialog
        open={open}
        onOpenChange={(o) => {
          if (busy) return;
          setOpen(o);
          if (!o) reset();
        }}
      >
        <DialogContent data-testid="space-new-dialog" className="max-w-md rounded-3xl border-0 bg-slate-50 shadow-xl dark:bg-zinc-900">
          <DialogHeader>
            <DialogTitle className="text-xl font-extrabold tracking-tight">새 공간 등록</DialogTitle>
            <DialogDescription>가구를 놓고 싶은 공간 한 곳을 등록해요. 사진은 나중에 올려도 돼요.</DialogDescription>
          </DialogHeader>
          <form onSubmit={submit} className="space-y-4">
            <label className="block space-y-1">
              <span className="text-xs font-bold text-slate-500 dark:text-zinc-400">공간 이름</span>
              <input
                data-testid="space-name"
                required
                maxLength={60}
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="예: 거실 소파 자리, 안방 창가"
                className="flex min-h-11 w-full rounded-2xl bg-white px-4 py-2 text-sm font-medium text-slate-900 shadow-sm placeholder:text-slate-400 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sky-400 dark:bg-zinc-800 dark:text-zinc-50"
              />
            </label>
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-slate-500 dark:text-zinc-400">공간 용도</p>
              <div role="radiogroup" aria-label="공간 용도" className="flex flex-wrap gap-1.5">
                {ROOM_OPTIONS.map((o) => (
                  <button key={o.value} type="button" role="radio" aria-checked={room === o.value} onClick={() => setRoom(o.value)} className={pill(room === o.value)}>
                    {o.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-slate-500 dark:text-zinc-400">선호 스타일 (선택)</p>
              <div role="radiogroup" aria-label="선호 스타일" className="flex flex-wrap gap-1.5">
                {STYLE_OPTIONS.map((s) => (
                  <button key={s} type="button" role="radio" aria-checked={style === s} onClick={() => setStyle(style === s ? null : s)} className={pill(style === s)}>
                    {s}
                  </button>
                ))}
              </div>
            </div>
            <div className="space-y-1.5">
              <p className="text-xs font-bold text-slate-500 dark:text-zinc-400">공간 사진 (선택)</p>
              <input ref={camera} data-testid="new-photo-camera" type="file" accept="image/*" capture="environment" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <input ref={gallery} data-testid="new-photo-gallery" type="file" accept="image/jpeg,image/png,image/webp" hidden onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
              <div className="flex flex-wrap items-center gap-2">
                <button type="button" onClick={() => camera.current?.click()} className={outlineBtn}>
                  <Camera size={16} strokeWidth={2.5} aria-hidden /> 카메라
                </button>
                <button type="button" onClick={() => gallery.current?.click()} className={outlineBtn}>
                  <ImageIcon size={16} strokeWidth={2.5} aria-hidden /> 갤러리
                </button>
                {file && (
                  <span data-testid="new-photo-name" className="min-w-0 max-w-full truncate text-xs font-bold text-teal-700 dark:text-teal-300">
                    {file.name}
                  </span>
                )}
              </div>
            </div>
            {error && (
              <p role="alert" className="rounded-2xl bg-rose-50 px-3 py-2 text-xs font-bold text-rose-700 dark:bg-rose-950/40 dark:text-rose-300">
                {error}
              </p>
            )}
            <button type="submit" data-testid="space-create" disabled={busy || !name.trim()} className={cn(GRADIENT_CTA, "w-full disabled:cursor-not-allowed disabled:opacity-60")}>
              {busy && <Loader2 size={18} className="animate-spin" aria-hidden />} {busy ? "만드는 중…" : "공간 만들기"}
            </button>
          </form>
        </DialogContent>
      </Dialog>
    </>
  );
}
