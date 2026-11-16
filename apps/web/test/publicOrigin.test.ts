import { describe, expect, it } from 'vitest';
import { configuredOrigin, originFromHeaders, publicOrigin } from '@/lib/publicOrigin';

const req = (headers: Record<string, string>) => new Request('http://localhost:3000/x', { headers });

describe('publicOrigin', () => {
  it('prefers the forwarded host and proto', () => {
    expect(publicOrigin(req({ 'x-forwarded-host': 'golf.example.com, proxy', 'x-forwarded-proto': 'https' }))).toBe('https://golf.example.com');
  });
  it('uses the Host header when not forwarded', () => {
    expect(publicOrigin(req({ host: '127.0.0.1:3000' }))).toBe('http://127.0.0.1:3000');
  });
  it('falls back to request.url', () => {
    expect(publicOrigin(new Request('http://localhost:3000/x'))).toBe('http://localhost:3000');
  });
  it('originFromHeaders works from headers alone (server actions)', () => {
    expect(originFromHeaders(new Headers({ host: 'golf.example.com', 'x-forwarded-proto': 'https' }), 'http://localhost:3000')).toBe('https://golf.example.com');
    expect(originFromHeaders(new Headers(), 'http://localhost:3000/x')).toBe('http://localhost:3000');
  });
  it('APP_URL wins over forged headers when set', () => {
    const env = { APP_URL: 'https://golf.example.com/', NODE_ENV: 'production' };
    expect(publicOrigin(req({ host: 'evil.example', 'x-forwarded-host': 'evil.example' }), env)).toBe('https://golf.example.com');
    expect(originFromHeaders(new Headers({ host: 'evil.example' }), 'http://localhost:3000', env)).toBe('https://golf.example.com');
  });
  it('production without APP_URL throws; development falls back to headers', () => {
    expect(() => publicOrigin(req({ host: 'evil.example' }), { NODE_ENV: 'production' })).toThrow('APP_URL');
    expect(configuredOrigin({ NODE_ENV: 'development' })).toBeNull();
    expect(publicOrigin(req({ host: '127.0.0.1:3000' }), { NODE_ENV: 'development' })).toBe('http://127.0.0.1:3000');
  });
});
