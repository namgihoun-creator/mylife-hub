"use client";

import { useEffect, useState } from "react";
import { checkWebXrArSupport, type WebXrArSupport } from "../utils/webxr-ar";

/** 'checking' on the server and first paint, then 'supported' | 'unsupported'. Render AR UI only on 'supported'. */
export function useWebXrArSupport(): WebXrArSupport {
  const [state, setState] = useState<WebXrArSupport>("checking");
  useEffect(() => {
    let alive = true;
    void checkWebXrArSupport().then((s) => {
      if (alive) setState(s);
    });
    return () => {
      alive = false;
    };
  }, []);
  return state;
}
