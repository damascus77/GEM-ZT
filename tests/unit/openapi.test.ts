import { describe, it, expect } from 'vitest';
import { openApiSpec } from '@/lib/api/openapi';
import { GET as openapiGet } from '@/app/api/v1/openapi.json/route';

const expected: Array<[string, string]> = [
  ['/setup/status', 'get'],
  ['/setup', 'post'],
  ['/auth/login', 'post'],
  ['/auth/logout', 'post'],
  ['/auth/totp/enroll', 'post'],
  ['/auth/totp/enable', 'post'],
  ['/me', 'get'],
  ['/apikeys', 'get'],
  ['/apikeys', 'post'],
  ['/apikeys/{id}', 'delete'],
  ['/controller/status', 'get'],
  ['/networks', 'get'],
  ['/networks', 'post'],
  ['/networks/{nwid}', 'get'],
  ['/networks/{nwid}', 'patch'],
  ['/networks/{nwid}', 'delete'],
  ['/networks/{nwid}/members', 'get'],
  ['/networks/{nwid}/members/{memberId}', 'get'],
  ['/networks/{nwid}/members/{memberId}', 'patch'],
  ['/networks/{nwid}/members/{memberId}', 'delete'],
  ['/networks/{nwid}/presence', 'get'],
  ['/networks/{nwid}/rules', 'get'],
  ['/networks/{nwid}/rules', 'put'],
  ['/networks/{nwid}/clone', 'post'],
  ['/audit', 'get'],
  ['/templates', 'get'],
  ['/templates', 'post'],
  ['/templates/{id}', 'delete'],
  ['/templates/{id}/apply', 'post'],
  ['/metrics', 'get'],
  ['/pending', 'get'],
  ['/backup', 'get'],
  ['/backup/restore', 'post'],
  ['/settings/webhook', 'get'],
  ['/settings/webhook', 'put'],
  ['/openapi.json', 'get'],
];

describe('openApiSpec', () => {
  it('is OpenAPI 3.0.3 served under /api/v1', () => {
    expect(openApiSpec.openapi).toBe('3.0.3');
    expect(openApiSpec.servers[0].url).toBe('/api/v1');
  });

  it('documents every implemented endpoint', () => {
    for (const [path, method] of expected) {
      const entry = (openApiSpec.paths as Record<string, Record<string, unknown>>)[path];
      expect(entry, `missing path ${path}`).toBeDefined();
      expect(entry[method], `missing ${method.toUpperCase()} ${path}`).toBeDefined();
    }
  });

  it('declares bearer + cookie security and the error envelope', () => {
    expect(openApiSpec.components.securitySchemes.apiKey.scheme).toBe('bearer');
    expect(openApiSpec.components.securitySchemes.session.name).toBe('gemzt_session');
    const err = openApiSpec.components.schemas.Error;
    expect(err.properties.error.properties.code.type).toBe('string');
    expect(err.properties.error.properties.message.type).toBe('string');
  });

  it('is served by GET /api/v1/openapi.json without auth', async () => {
    const res = await openapiGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.info.title).toBe('GEM-ZT API');
  });
});
