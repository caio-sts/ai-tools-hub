export interface ComboboxState {
  open: boolean;
  /** -1 means no option is active. */
  activeIndex: number;
  optionCount: number;
}

export type ComboboxAction = 'none' | 'submit' | 'activate' | 'dismiss';

export interface ComboboxTransition {
  state: ComboboxState;
  action: ComboboxAction;
  /** Option index for 'activate'; -1 otherwise. */
  index: number;
}

export type ComboboxEvent =
  | { type: 'results'; optionCount: number }
  | { type: 'key'; key: string }
  | { type: 'select'; index: number }
  | { type: 'blur' };

export const INITIAL_COMBOBOX_STATE: ComboboxState = Object.freeze({
  open: false, activeIndex: -1, optionCount: 0,
});

const closed = (state: ComboboxState): ComboboxState => ({ ...state, open: false, activeIndex: -1 });

export function comboboxReducer(state: ComboboxState, event: ComboboxEvent): ComboboxTransition {
  switch (event.type) {
    case 'results': {
      const optionCount = Math.max(0, event.optionCount);
      return {
        state: { open: optionCount > 0, activeIndex: -1, optionCount },
        action: 'none',
        index: -1,
      };
    }

    case 'select':
      return { state: closed(state), action: 'activate', index: event.index };

    case 'blur':
      return { state: closed(state), action: 'none', index: -1 };

    case 'key': {
      if (event.key === 'ArrowDown') {
        if (state.optionCount === 0) return { state, action: 'none', index: -1 };
        if (!state.open) {
          return { state: { ...state, open: true, activeIndex: 0 }, action: 'none', index: -1 };
        }
        const next = (state.activeIndex + 1) % state.optionCount;
        return { state: { ...state, activeIndex: next }, action: 'none', index: -1 };
      }

      if (event.key === 'ArrowUp') {
        if (state.optionCount === 0) return { state, action: 'none', index: -1 };
        if (!state.open) {
          return {
            state: { ...state, open: true, activeIndex: state.optionCount - 1 },
            action: 'none',
            index: -1,
          };
        }
        const next = state.activeIndex <= 0 ? state.optionCount - 1 : state.activeIndex - 1;
        return { state: { ...state, activeIndex: next }, action: 'none', index: -1 };
      }

      if (event.key === 'Enter') {
        if (state.open && state.activeIndex >= 0) {
          return { state: closed(state), action: 'activate', index: state.activeIndex };
        }
        return { state: closed(state), action: 'submit', index: -1 };
      }

      if (event.key === 'Escape') {
        if (state.open) return { state: closed(state), action: 'none', index: -1 };
        return { state: closed(state), action: 'dismiss', index: -1 };
      }

      return { state, action: 'none', index: -1 };
    }
  }
}

export function activeDescendantId(listboxId: string, state: ComboboxState): string | null {
  if (!state.open || state.activeIndex < 0) return null;
  return `${listboxId}-opt-${state.activeIndex}`;
}
