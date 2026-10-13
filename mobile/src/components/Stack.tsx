import { type ReactNode, useRef } from 'react';
import { AnimatePresence, motion, useDragControls } from 'framer-motion';
import { useNav, type Route } from '../stores/nav';
import { haptic } from '../lib/haptics';

interface StackProps {
  render: (route: Route, depth: number) => ReactNode;
}

/**
 * iOS-style stack: push slides in from the right, pop slides out to the right,
 * and a swipe from the left edge pops. Root screens cross-fade instead of
 * sliding, so switching tabs never feels like it's "going somewhere".
 */
export function Stack({ render }: StackProps) {
  const tab = useNav((s) => s.tab);
  const stacks = useNav((s) => s.stacks);
  const pop = useNav((s) => s.pop);
  const routes = stacks[tab];
  const top = routes[routes.length - 1];

  if (!top) return null;

  return (
    <div className="relative h-full min-h-0 overflow-hidden">
      <AnimatePresence initial={false} mode="popLayout">
        <motion.div
          key={`${tab}:${routeKey(top)}`}
          className="absolute inset-0"
          initial={{ x: routes.length > 1 ? '100%' : 0, opacity: routes.length > 1 ? 1 : 0 }}
          animate={{ x: 0, opacity: 1 }}
          exit={{ x: '100%', opacity: 1 }}
          transition={{ type: 'spring', stiffness: 380, damping: 36, mass: 0.9 }}
        >
          <SwipeToPop enabled={routes.length > 1} onPop={pop}>
            {render(top, routes.length)}
          </SwipeToPop>
        </motion.div>
      </AnimatePresence>
    </div>
  );
}

function SwipeToPop({
  children,
  enabled,
  onPop,
}: {
  children: ReactNode;
  enabled: boolean;
  onPop: () => void;
}) {
  const controls = useDragControls();
  const armed = useRef(false);

  return (
    <motion.div
      className="h-full min-h-0"
      drag={enabled ? 'x' : false}
      dragListener={false}
      dragControls={controls}
      dragDirectionLock
      dragConstraints={{ left: 0, right: 0 }}
      dragElastic={{ left: 0.28, right: 0 }}
      onDragEnd={(_, info) => {
        if (info.offset.x > 88 || info.velocity.x > 520) {
          haptic('light');
          onPop();
        }
      }}
      onPointerDownCapture={(event) => {
        // Only arm the gesture when it starts at the very left edge.
        armed.current = enabled && event.clientX <= 26;
        if (armed.current) controls.start(event);
      }}
    >
      {children}
    </motion.div>
  );
}

function routeKey(route: Route): string {
  return 'chatId' in route ? `${route.name}:${route.chatId}` : route.name;
}
