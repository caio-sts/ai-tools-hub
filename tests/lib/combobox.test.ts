import { describe, it, expect } from 'vitest';
import {
  INITIAL_COMBOBOX_STATE, activeDescendantId, comboboxReducer, type ComboboxState,
} from '../../src/lib/combobox.ts';

const withOptions = (count: number): ComboboxState =>
  comboboxReducer(INITIAL_COMBOBOX_STATE, { type: 'results', optionCount: count }).state;

describe('comboboxReducer', () => {
  it('opens when results arrive and closes when they do not', () => {
    expect(withOptions(3)).toEqual({ open: true, activeIndex: -1, optionCount: 3 });
    expect(withOptions(0)).toEqual({ open: false, activeIndex: -1, optionCount: 0 });
  });

  it('ArrowDown walks forward and wraps to the first option', () => {
    let state = withOptions(3);
    state = comboboxReducer(state, { type: 'key', key: 'ArrowDown' }).state;
    expect(state.activeIndex).toBe(0);
    state = comboboxReducer(state, { type: 'key', key: 'ArrowDown' }).state;
    state = comboboxReducer(state, { type: 'key', key: 'ArrowDown' }).state;
    expect(state.activeIndex).toBe(2);
    state = comboboxReducer(state, { type: 'key', key: 'ArrowDown' }).state;
    expect(state.activeIndex).toBe(0);
  });

  it('ArrowUp from nothing selected picks the last option', () => {
    expect(comboboxReducer(withOptions(4), { type: 'key', key: 'ArrowUp' }).state.activeIndex).toBe(3);
  });

  it('ArrowUp walks backward and wraps', () => {
    let state = comboboxReducer(withOptions(3), { type: 'key', key: 'ArrowDown' }).state;
    state = comboboxReducer(state, { type: 'key', key: 'ArrowUp' }).state;
    expect(state.activeIndex).toBe(2);
  });

  it('reopens a closed listbox on ArrowDown when options exist', () => {
    const closed: ComboboxState = { open: false, activeIndex: -1, optionCount: 5 };
    const next = comboboxReducer(closed, { type: 'key', key: 'ArrowDown' });
    expect(next.state.open).toBe(true);
    expect(next.state.activeIndex).toBe(0);
  });

  it('does nothing on arrows when there are no options', () => {
    const empty = withOptions(0);
    expect(comboboxReducer(empty, { type: 'key', key: 'ArrowDown' }).state).toEqual(empty);
    expect(comboboxReducer(empty, { type: 'key', key: 'ArrowUp' }).state).toEqual(empty);
  });

  it('Enter on an active option activates it and reports the index', () => {
    const state = comboboxReducer(withOptions(3), { type: 'key', key: 'ArrowDown' }).state;
    const next = comboboxReducer(state, { type: 'key', key: 'Enter' });
    expect(next.action).toBe('activate');
    expect(next.index).toBe(0);
    expect(next.state.open).toBe(false);
  });

  it('Enter with nothing active submits the raw query', () => {
    const next = comboboxReducer(withOptions(3), { type: 'key', key: 'Enter' });
    expect(next.action).toBe('submit');
    expect(next.index).toBe(-1);
  });

  it('Escape closes an open listbox, then dismisses', () => {
    const first = comboboxReducer(withOptions(3), { type: 'key', key: 'Escape' });
    expect(first.action).toBe('none');
    expect(first.state.open).toBe(false);
    expect(comboboxReducer(first.state, { type: 'key', key: 'Escape' }).action).toBe('dismiss');
  });

  it('select activates the clicked index', () => {
    const next = comboboxReducer(withOptions(3), { type: 'select', index: 2 });
    expect(next.action).toBe('activate');
    expect(next.index).toBe(2);
    expect(next.state.open).toBe(false);
  });

  it('blur closes without acting', () => {
    const next = comboboxReducer(withOptions(3), { type: 'blur' });
    expect(next.action).toBe('none');
    expect(next.state.open).toBe(false);
  });

  it('ignores keys it does not own', () => {
    const state = withOptions(3);
    expect(comboboxReducer(state, { type: 'key', key: 'a' }).state).toEqual(state);
  });
});

describe('activeDescendantId', () => {
  it('is null when nothing is active', () => {
    expect(activeDescendantId('sug', INITIAL_COMBOBOX_STATE)).toBeNull();
  });

  it('names the active option element', () => {
    const state = comboboxReducer(withOptions(3), { type: 'key', key: 'ArrowDown' }).state;
    expect(activeDescendantId('sug', state)).toBe('sug-opt-0');
  });
});
