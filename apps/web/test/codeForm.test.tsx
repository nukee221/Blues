// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';

vi.mock('@/app/c/RegisterServiceWorker', () => ({ default: () => null }));
import EnterCodePage from '@/app/c/page';

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

describe('/c code form', () => {
  it('does a full navigation (location.assign) to /c/CODE, not a client-side push', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<EnterCodePage />);
    fireEvent.change(screen.getByLabelText('Group code'), { target: { value: ' k7mpq3 ' } });
    fireEvent.click(screen.getByText('Open scorecard'));
    expect(assign).toHaveBeenCalledWith('/c/K7MPQ3');
  });
  it('rejects a malformed code without navigating', () => {
    const assign = vi.fn();
    vi.stubGlobal('location', { ...window.location, assign });
    render(<EnterCodePage />);
    fireEvent.change(screen.getByLabelText('Group code'), { target: { value: 'no' } });
    fireEvent.click(screen.getByText('Open scorecard'));
    expect(assign).not.toHaveBeenCalled();
    expect(screen.getByRole('alert')).toBeTruthy();
  });
});
