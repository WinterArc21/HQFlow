import { Moon, Sun } from "@phosphor-icons/react";
import { IconButton } from "../primitives";
import { useCodeHQStore } from "../../store/useCodeHQStore";

/** Flips between the dark and light scene families; `Backdrop` applies the result to the document. */
export function ThemeToggle() {
  const theme = useCodeHQStore((state) => state.theme);
  const setTheme = useCodeHQStore((state) => state.setTheme);

  const nextTheme = theme === "dark" ? "light" : "dark";

  return (
    <IconButton
      label={`Switch to ${nextTheme} theme`}
      icon={theme === "dark" ? <Sun size={16} /> : <Moon size={16} />}
      onClick={() => setTheme(nextTheme)}
    />
  );
}
