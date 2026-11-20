import { describe, expect, it } from 'vitest';
import { renderToStaticMarkup } from 'react-dom/server';
import { Avatar, initials } from '@/components/Avatar';
import { photoUrl } from '@/lib/photo';

describe('Avatar', () => {
  it('initials: first and last name', () => {
    expect([initials('Casey Reynolds'), initials('Cher'), initials(' Mary Ann  Smith '), initials('')]).toEqual(['CR', 'C', 'MS', '?']);
  });
  it('photo when the player has one, initials otherwise', () => {
    expect(renderToStaticMarkup(<Avatar playerId="p1" name="Casey Reynolds" photoVersion={7} />)).toContain('src="/photo/p1?v=7"');
    const none = renderToStaticMarkup(<Avatar playerId="p1" name="Casey Reynolds" photoVersion={0} />);
    expect(none).not.toContain('<img');
    expect(none).toContain('CR');
  });
  it('photoUrl', () => {
    expect(photoUrl('p1', 0)).toBeNull();
    expect(photoUrl('p1', null)).toBeNull();
    expect(photoUrl('p1', 3)).toBe('/photo/p1?v=3');
  });
});
