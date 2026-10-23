import { useEffect, useState } from "react";
import { usePrefersReducedMotion } from "../../lib/usePrefersReducedMotion";
import { useCodeHQStore } from "../../store/useCodeHQStore";
import styles from "./TypedPrompt.module.css";

/** Characters per tick; the whole agent prompt types out in about three seconds. */
const STEP = 9;
const TICK_MS = 40;

/**
 * The prompt the user will paste, typing itself out like an agent at work. Screen readers get
 * the full text at once; reduced motion and the Still level show it already typed.
 */
export function TypedPrompt({ text }: { text: string }) {
  const reducedMotion = usePrefersReducedMotion();
  const still = useCodeHQStore((state) => state.motion === "still");
  const animate = !reducedMotion && !still;
  const [shown, setShown] = useState(animate ? 0 : text.length);

  useEffect(() => {
    if (!animate) {
      return;
    }
    const timer = window.setInterval(() => {
      setShown((count) => {
        if (count >= text.length) {
          window.clearInterval(timer);
          return count;
        }
        return Math.min(text.length, count + STEP);
      });
    }, TICK_MS);
    return () => window.clearInterval(timer);
  }, [animate, text]);

  const visible = animate ? shown : text.length;
  return (
    <p className={styles.prompt}>
      <span className={styles.srOnly}>{text}</span>
      <span aria-hidden="true">
        {text.slice(0, visible)}
        <span className={`${styles.caret} ${visible >= text.length ? styles.done : ""}`} />
      </span>
    </p>
  );
}
