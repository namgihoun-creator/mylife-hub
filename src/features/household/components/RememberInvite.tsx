"use client";

import { useEffect } from "react";
import { rememberInvite } from "../utils/pending-invite";

/** Renders nothing: stores the opened (still valid) invite code in this browser for the sign-in screen to offer later. */
export function RememberInvite({ code }: { code: string }) {
  useEffect(() => rememberInvite(code), [code]);
  return null;
}
