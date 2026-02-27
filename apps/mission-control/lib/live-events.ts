type LiveEvent = {
  event: string;
  data: Record<string, unknown>;
};

type Listener = (event: LiveEvent) => void;

const listeners = new Set<Listener>();

export function publishLiveEvent(event: string, data: Record<string, unknown>) {
  const payload: LiveEvent = { event, data };
  listeners.forEach((listener) => listener(payload));
}

export function subscribeLiveEvents(listener: Listener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}
