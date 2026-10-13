import { create } from 'zustand';

/**
 * A deliberately small iOS-style stack navigator.
 *
 * Why not react-router: the app has five screens, no deep links, and needs
 * real push/pop semantics plus a swipe-from-edge back gesture. A 40-line store
 * does that in ~1 KB instead of ~16 KB gz — which matters against the 200 KB
 * budget, and it gives us full control over the transition timing.
 *
 * Each tab owns its own stack (standard iOS behaviour): switching tabs never
 * pops another tab's history.
 */

export type TabId = 'chat' | 'voice' | 'approvals' | 'settings';

export type Route =
  | { name: 'chat-list' }
  | { name: 'conversation'; chatId: string; title?: string }
  | { name: 'voice' }
  | { name: 'approvals' }
  | { name: 'settings' }
  | { name: 'pairing' };

const HOME: Record<TabId, Route> = {
  chat: { name: 'chat-list' },
  voice: { name: 'voice' },
  approvals: { name: 'approvals' },
  settings: { name: 'settings' },
};

interface NavState {
  tab: TabId;
  stacks: Record<TabId, Route[]>;
  /** Direction of the last transition so the animation knows which way to slide. */
  direction: 1 | -1;
  setTab: (tab: TabId) => void;
  push: (route: Route, tab?: TabId) => void;
  pop: () => boolean;
  popToRoot: () => void;
  replace: (route: Route) => void;
  reset: (tab: TabId) => void;
}

export const useNav = create<NavState>((set, get) => ({
  tab: 'chat',
  direction: 1,
  stacks: {
    chat: [HOME.chat],
    voice: [HOME.voice],
    approvals: [HOME.approvals],
    settings: [HOME.settings],
  },

  setTab: (tab) => {
    const state = get();
    if (state.tab === tab) {
      // Tapping the active tab pops to its root, like iOS.
      set({ stacks: { ...state.stacks, [tab]: [HOME[tab]] }, direction: -1 });
      return;
    }
    set({ tab, direction: 1 });
  },

  push: (route, tab) => {
    const state = get();
    const target = tab ?? state.tab;
    const stack = state.stacks[target];
    set({
      tab: target,
      direction: 1,
      stacks: { ...state.stacks, [target]: [...stack, route] },
    });
  },

  pop: () => {
    const state = get();
    const stack = state.stacks[state.tab];
    if (stack.length <= 1) return false;
    set({ direction: -1, stacks: { ...state.stacks, [state.tab]: stack.slice(0, -1) } });
    return true;
  },

  popToRoot: () => {
    const state = get();
    set({ direction: -1, stacks: { ...state.stacks, [state.tab]: [HOME[state.tab]] } });
  },

  replace: (route) => {
    const state = get();
    const stack = state.stacks[state.tab];
    set({
      stacks: { ...state.stacks, [state.tab]: [...stack.slice(0, -1), route] },
    });
  },

  reset: (tab) =>
    set({
      tab,
      direction: -1,
      stacks: { ...get().stacks, [tab]: [HOME[tab]] },
    }),
}));

export function currentRoute(state: NavState): Route {
  const stack = state.stacks[state.tab];
  return stack[stack.length - 1] ?? HOME[state.tab];
}

export function stackDepth(state: NavState): number {
  return state.stacks[state.tab].length;
}
