// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';

const { saveCourse, searchCourseLookup, loadCourseLookup } = vi.hoisted(() => ({
  saveCourse: vi.fn(), searchCourseLookup: vi.fn(), loadCourseLookup: vi.fn(),
}));
vi.mock('@/actions/courses', () => ({ saveCourse }));
vi.mock('@/actions/courseLookup', () => ({ searchCourseLookup, loadCourseLookup }));
vi.mock('next/navigation', () => ({ useRouter: () => ({ replace: vi.fn(), refresh: vi.fn() }) }));

import CourseForm from '@/components/CourseForm';

const pars = [4, 4, 5, 4, 3, 5, 4, 3, 4, 5, 3, 4, 4, 5, 3, 4, 4, 4];
const sis = [18, 4, 10, 8, 16, 12, 6, 14, 2, 3, 15, 11, 7, 1, 17, 5, 13, 9];
const holes = pars.map((par, i) => ({ number: i + 1, par, strokeIndex: sis[i]! }));
const lt = (over = {}) => ({ key: 'male:Blue', name: 'Blue', rating: 71.8, slope: 140, par: 72, yards: 6410, holes, issues: [] as string[], ...over });
const found = {
  id: 'c1', clubName: 'Cherokee Ridge Country Club', courseName: 'Cherokee Ridge Country Club', city: 'Union Grove', state: 'AL',
  tees: [lt(), lt({ key: 'female:Blue', name: 'Blue (W)', rating: 77.4, slope: 139, par: 73, holes: holes.map((h, i) => (i === 0 ? { ...h, par: 5 } : h)) }),
    lt({ key: 'male:Bad', name: 'Bad', rating: 0, issues: ['Missing course rating'] })],
};
const empty = { name: '', tees: [] };
const existing = {
  id: '11111111-1111-4111-8111-111111111111', name: 'Cherokee',
  tees: [{ id: '22222222-2222-4222-8222-222222222222', name: 'Blue', rating: 71, slope: 138, par: 72, holes }],
};

beforeEach(() => {
  saveCourse.mockReset();
  searchCourseLookup.mockResolvedValue({ ok: true, data: [{ id: 'c1', clubName: 'Cherokee Ridge Country Club', courseName: 'Cherokee Ridge Country Club', city: 'Union Grove', state: 'AL' }] });
  loadCourseLookup.mockResolvedValue({ ok: true, data: found });
});
afterEach(cleanup);

async function searchAndPick() {
  fireEvent.change(screen.getByLabelText('Course search'), { target: { value: 'cherokee' } });
  fireEvent.click(screen.getByText('Search'));
  fireEvent.click(await screen.findByText('Cherokee Ridge Country Club'));
  await screen.findByLabelText('Import Blue');
}

describe('course lookup', () => {
  it('does not call the API on render and shows the scorecard reminder', () => {
    render(<CourseForm initial={empty} />);
    expect(searchCourseLookup).not.toHaveBeenCalled();
    expect(screen.getByText(/Check against the club's scorecard before saving/)).toBeTruthy();
  });

  it('search, pick, tick tees, add: fills the empty name and appends new tees; save sends them', async () => {
    saveCourse.mockResolvedValue({ ok: true, data: { id: 'x', teeIds: ['a', 'b'] } });
    render(<CourseForm initial={empty} />);
    await searchAndPick();
    expect(screen.getByText(/Needs attention: Missing course rating/)).toBeTruthy();
    fireEvent.click(screen.getByLabelText('Import Blue'));
    fireEvent.click(screen.getByLabelText('Import Blue (W)'));
    fireEvent.click(screen.getByText('Add selected tees'));
    expect((screen.getByLabelText('Course name') as HTMLInputElement).value).toBe('Cherokee Ridge Country Club');
    expect(screen.getAllByLabelText('Tee name').map((e) => (e as HTMLInputElement).value)).toEqual(['Blue', 'Blue (W)']);
    fireEvent.click(screen.getByText('Save course'));
    await waitFor(() => expect(saveCourse).toHaveBeenCalledOnce());
    const sent = saveCourse.mock.calls[0]![0];
    expect(sent.tees[0]).toMatchObject({ name: 'Blue', rating: 71.8, slope: 140, par: 72 });
    expect(sent.tees[0].holes.map((h: { par: number }) => h.par)).toEqual(pars);
    expect(sent.tees[1]).toMatchObject({ name: 'Blue (W)', par: 73 });
  });

  it('a tee with issues is added but flagged', async () => {
    render(<CourseForm initial={empty} />);
    await searchAndPick();
    fireEvent.click(screen.getByLabelText('Import Bad'));
    fireEvent.click(screen.getByText('Add selected tees'));
    expect(screen.getByText(/needs fixing before you save: Missing course rating/)).toBeTruthy();
  });

  it('never overwrites a same-named tee silently; Replace numbers does, keeping the id', async () => {
    saveCourse.mockResolvedValue({ ok: true, data: { id: existing.id, teeIds: [existing.tees[0]!.id] } });
    render(<CourseForm initial={existing} />);
    await searchAndPick();
    fireEvent.click(screen.getByLabelText('Import Blue'));
    fireEvent.click(screen.getByText('Add selected tees'));
    expect(screen.getAllByLabelText('Tee name')).toHaveLength(1);
    expect((screen.getByLabelText('Rating') as HTMLInputElement).value).toBe('71'); // untouched
    expect((screen.getByLabelText('Course name') as HTMLInputElement).value).toBe('Cherokee'); // not replaced
    fireEvent.click(screen.getByText('Replace numbers'));
    expect((screen.getByLabelText('Rating') as HTMLInputElement).value).toBe('71.8');
    fireEvent.click(screen.getByText('Save course'));
    await waitFor(() => expect(saveCourse).toHaveBeenCalledOnce());
    expect(saveCourse.mock.calls[0]![0].tees[0]).toMatchObject({ id: existing.tees[0]!.id, rating: 71.8, slope: 140 });
  });

  it('replacing numbers then hitting needs_confirm uses the existing confirm flow', async () => {
    saveCourse.mockResolvedValueOnce({ ok: false, code: 'needs_confirm', error: 'x', fields: ['Blue'] });
    render(<CourseForm initial={existing} />);
    await searchAndPick();
    fireEvent.click(screen.getByLabelText('Import Blue'));
    fireEvent.click(screen.getByText('Add selected tees'));
    fireEvent.click(screen.getByText('Replace numbers'));
    fireEvent.click(screen.getByText('Save course'));
    await screen.findByRole('alertdialog');
  });

  it('shows a lookup error (not set up) without breaking the form', async () => {
    searchCourseLookup.mockResolvedValue({ ok: false, code: 'lookup_not_configured', error: 'Course lookup is not set up.' });
    render(<CourseForm initial={empty} />);
    fireEvent.change(screen.getByLabelText('Course search'), { target: { value: 'cher' } });
    fireEvent.click(screen.getByText('Search'));
    await screen.findByText('Course lookup is not set up.');
    expect(screen.getByText('Save course')).toBeTruthy();
  });
});
