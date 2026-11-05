import {useCallback, useRef, useSyncExternalStore} from 'react';
import type {ChatController, Snapshot} from './controller';
import {reuseValue} from './state';

// Each widget observes only the fields it displays, with a stable result for
// message deltas or draft changes that do not affect those fields.
export function useChatState<T>(controller: ChatController, select: (state: Snapshot) => T): T {
  const cached = useRef<T | undefined>(undefined);
  const read = useCallback(() => {
    const next = select(controller.getSnapshot());
    cached.current = reuseValue(cached.current, next);
    return cached.current as T;
  }, [controller, select]);
  return useSyncExternalStore(controller.subscribe, read);
}
