// Lets the bottom bar's plus button open the capture sheet owned by Library.
type Listener = () => void;
const listeners = new Set<Listener>();

export function onCaptureRequested(listener: Listener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

export function requestCapture(): void {
  for (const l of listeners) l();
}
