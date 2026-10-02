import { useRef } from "react";

// Controlled dialogs can be opened from several places without a DialogTrigger.
export function useDialogFocus() {
  const trigger = useRef(document.activeElement as HTMLElement | null);
  return (event: Event) => {
    event.preventDefault();
    if (trigger.current?.isConnected) trigger.current.focus();
  };
}
