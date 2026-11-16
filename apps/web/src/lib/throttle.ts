/** Leading + trailing throttle: runs `fn` at most once per `ms`; a call inside the window schedules one run at its end. */
export function throttle(fn: () => void, ms: number): { call: () => void; cancel: () => void } {
  let last = -Infinity;
  let timer: ReturnType<typeof setTimeout> | null = null;
  const run = () => {
    timer = null;
    last = Date.now();
    fn();
  };
  return {
    call() {
      if (timer) return;
      const wait = last + ms - Date.now();
      if (wait <= 0) run();
      else timer = setTimeout(run, wait);
    },
    cancel() {
      if (timer) clearTimeout(timer);
      timer = null;
    },
  };
}
