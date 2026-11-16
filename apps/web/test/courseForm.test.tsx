// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { saveCourse } = vi.hoisted(() => ({ saveCourse: vi.fn() }));
vi.mock('@/actions/courses', () => ({ saveCourse }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import CourseForm from '@/components/CourseForm';

const pars = [4, 4, 5, 4, 3, 5, 4, 3, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4];
const sis = [18, 4, 10, 8, 16, 12, 6, 14, 2, 3, 15, 11, 7, 1, 17, 5, 13, 9];
const initial = {
  id: '11111111-1111-4111-8111-111111111111',
  name: 'Cherokee Ridge',
  tees: [{
    id: '22222222-2222-4222-8222-222222222222', name: 'Blue', rating: 71, slope: 140, par: 72,
    holes: pars.map((par, i) => ({ number: i + 1, par, strokeIndex: sis[i]! })),
  }],
};

beforeEach(() => {
  saveCourse.mockReset();
});
afterEach(cleanup);

describe('CourseForm', () => {
  it('allows typing a decimal rating', async () => {
    saveCourse.mockResolvedValue({ ok: true, data: { id: initial.id, teeIds: [initial.tees[0]!.id] } });
    render(<CourseForm initial={initial} />);
    const rating = screen.getByLabelText('Rating') as HTMLInputElement;
    for (const v of ['7', '71', '71.', '71.8']) {
      fireEvent.change(rating, { target: { value: v } });
      expect(rating.value).toBe(v); // the dot is not eaten mid-typing
    }
    fireEvent.click(screen.getByText('Save course'));
    await waitFor(() => expect(saveCourse).toHaveBeenCalledOnce());
    expect(saveCourse.mock.calls[0]![0].tees[0].rating).toBe(71.8);
  });

  it('second save reuses the new tee id instead of inserting a duplicate', async () => {
    saveCourse.mockResolvedValue({ ok: true, data: { id: initial.id, teeIds: [initial.tees[0]!.id, '33333333-3333-4333-8333-333333333333'] } });
    render(<CourseForm initial={initial} />);
    fireEvent.click(screen.getByText('Add tee'));
    fireEvent.change(screen.getAllByLabelText('Tee name')[1]!, { target: { value: 'White' } });
    fireEvent.click(screen.getByText('Save course'));
    await waitFor(() => expect(saveCourse).toHaveBeenCalledTimes(1));
    expect(saveCourse.mock.calls[0]![0].tees[1].id).toBeUndefined();
    await waitFor(() => expect((screen.getByText('Save course') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Save course'));
    await waitFor(() => expect(saveCourse).toHaveBeenCalledTimes(2));
    expect(saveCourse.mock.calls[1]![0].tees[1].id).toBe('33333333-3333-4333-8333-333333333333');
  });

  it('shows the returned error and does not navigate when the action fails', async () => {
    saveCourse.mockResolvedValue({ ok: false, code: 'tee_not_in_course', error: 'Tee does not belong to this course' });
    render(<CourseForm initial={initial} />);
    fireEvent.click(screen.getByText('Save course'));
    await screen.findByText('Tee does not belong to this course');
  });
  it('keeps every field editable and shows the confirm step on needs_confirm; Continue resends confirmed', async () => {
    saveCourse.mockResolvedValueOnce({ ok: false, code: 'needs_confirm', error: 'x', fields: ['Blue'] });
    saveCourse.mockResolvedValueOnce({ ok: true, data: { id: initial.id, teeIds: [initial.tees[0]!.id] } });
    render(<CourseForm initial={initial} />);
    expect((screen.getByLabelText('Slope') as HTMLInputElement).disabled).toBe(false);
    expect((screen.getByLabelText('Hole 1 stroke index') as HTMLInputElement).disabled).toBe(false);
    fireEvent.click(screen.getByText('Save course'));
    const dlg = await screen.findByRole('alertdialog');
    expect(dlg.textContent).toContain('This changes results already recorded');
    expect(dlg.textContent).toContain('Blue');
    expect(saveCourse.mock.calls[0]![0].confirmResultsChange).toBeUndefined();
    await waitFor(() => expect((screen.getByText('Continue') as HTMLButtonElement).disabled).toBe(false));
    fireEvent.click(screen.getByText('Continue'));
    await waitFor(() => expect(saveCourse).toHaveBeenCalledTimes(2));
    expect(saveCourse.mock.calls[1]![0].confirmResultsChange).toBe(true);
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
  });
  it('Cancel closes the confirm step without saving', async () => {
    saveCourse.mockResolvedValue({ ok: false, code: 'needs_confirm', error: 'x', fields: ['Blue'] });
    render(<CourseForm initial={initial} />);
    fireEvent.click(screen.getByText('Save course'));
    await screen.findByRole('alertdialog');
    fireEvent.click(screen.getByText('Cancel'));
    expect(screen.queryByRole('alertdialog')).toBeNull();
    expect(saveCourse).toHaveBeenCalledTimes(1);
  });
});
