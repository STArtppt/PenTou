import { useEffect, useRef, useState } from "react";

const DEFAULT_IDLE_MS = 700;

export function useScrollActivity(idleMs = DEFAULT_IDLE_MS) {
  const [isScrolling, setIsScrolling] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, []);

  const markScrollActive = () => {
    setIsScrolling(true);
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => setIsScrolling(false), idleMs);
  };

  return { isScrolling, markScrollActive };
}
