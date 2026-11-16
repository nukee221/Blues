import { expect, it } from 'vitest';
import * as scoring from '../src';

it('exports a module', () => {
  expect(typeof scoring).toBe('object');
});
