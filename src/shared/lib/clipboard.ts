export type CopyResult = { ok: true; text: string } | { ok: false; text: string };

/**
 * Copies text that is produced asynchronously (e.g. after a server action) without losing the
 * user-gesture permission: ClipboardItem accepts a promise, so Safari/Chrome accept the write
 * even though the text arrives later. Falls back to navigator.clipboard.writeText.
 * Rejects only if `getText` itself rejects.
 */
export async function copyTextLazy(getText: () => Promise<string>): Promise<CopyResult> {
  const textPromise = getText();
  textPromise.catch(() => undefined); // avoid an unhandled rejection while the clipboard path runs

  if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write) {
    try {
      await navigator.clipboard.write([
        new ClipboardItem({ "text/plain": textPromise.then((t) => new Blob([t], { type: "text/plain" })) }),
      ]);
      return { ok: true, text: await textPromise };
    } catch {
      // fall through to writeText (also covers getText rejecting: awaited again below)
    }
  }

  const text = await textPromise;
  try {
    await navigator.clipboard.writeText(text);
    return { ok: true, text };
  } catch {
    return { ok: false, text };
  }
}
