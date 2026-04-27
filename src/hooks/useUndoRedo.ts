import { useCallback, useRef, useState } from 'react';

const MAX_HISTORY = 50;

export function useUndoRedo<T>(initial: T, isEqual?: (a: T, b: T) => boolean) {
  const [state, setState] = useState(initial);
  const pastRef = useRef<T[]>([]);
  const futureRef = useRef<T[]>([]);

  const set = useCallback(
    (next: T) => {
      setState((current) => {
        if (isEqual ? isEqual(current, next) : current === next) return current;
        pastRef.current = [...pastRef.current.slice(-(MAX_HISTORY - 1)), current];
        futureRef.current = [];
        return next;
      });
    },
    [isEqual]
  );

  const undo = useCallback(() => {
    setState((current) => {
      const past = pastRef.current;
      if (past.length === 0) return current;
      const prev = past[past.length - 1];
      pastRef.current = past.slice(0, -1);
      futureRef.current = [current, ...futureRef.current];
      return prev;
    });
  }, []);

  const redo = useCallback(() => {
    setState((current) => {
      const future = futureRef.current;
      if (future.length === 0) return current;
      const next = future[0];
      futureRef.current = future.slice(1);
      pastRef.current = [...pastRef.current, current];
      return next;
    });
  }, []);

  const canUndo = pastRef.current.length > 0;
  const canRedo = futureRef.current.length > 0;

  return { state, set, undo, redo, canUndo, canRedo };
}
