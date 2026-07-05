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
  ['/auth/totp/disable', 'post'],
  ['/auth/password', 'patch'],
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
  ['/orgs', 'get'],
  ['/orgs', 'post'],
  ['/orgs/{orgId}', 'get'],
  ['/orgs/{orgId}', 'patch'],
  ['/orgs/{orgId}', 'delete'],
  ['/orgs/{orgId}/active', 'post'],
  ['/orgs/{orgId}/members', 'get'],
  ['/orgs/{orgId}/members', 'post'],
  ['/orgs/{orgId}/members/{userId}', 'patch'],
  ['/orgs/{orgId}/members/{userId}', 'delete'],
  ['/orgs/{orgId}/invitations', 'get'],
  ['/orgs/{orgId}/invitations', 'post'],
  ['/orgs/{orgId}/invitations/{id}', 'delete'],
  ['/invitations/{token}', 'get'],
  ['/invitations/{token}/accept', 'post'],
];

// Operations that require a resolved auth session/apikey but no per-request
// role check (requireAuth/resolveAuth only) — FORBIDDEN can never be
// returned, so only 401 is documented.
const authOnlyOps = new Set<string>([
  '/me get',
  '/auth/password patch',
  '/auth/totp/enroll post',
  '/auth/totp/enable post',
  '/auth/totp/disable post',
  '/orgs get',
]);

// Operations with no authentication at all (setup bootstrap, login/logout,
// public invitation preview/accept, the spec document itself).
const publicOps = new Set<string>([
  '/setup/status get',
  '/setup post',
  '/auth/login post',
  '/auth/logout post',
  '/invitations/{token} get',
  '/invitations/{token}/accept post',
  '/openapi.json get',
]);

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

  it('documents 401 and 403 on every non-public, role-checked path', () => {
    const paths = openApiSpec.paths as Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    for (const [path, method] of expected) {
      if (publicOps.has(`${path} ${method}`) || authOnlyOps.has(`${path} ${method}`)) continue;
      const op = paths[path][method];
      const responses = op.responses ?? {};
      expect(responses['401'], `missing 401 on ${method.toUpperCase()} ${path}`).toBeDefined();
      expect(responses['403'], `missing 403 on ${method.toUpperCase()} ${path}`).toBeDefined();
    }
  });

  it('documents 401 (but not a fabricated 403) on auth-only, non-role-checked paths', () => {
    const paths = openApiSpec.paths as Record<string, Record<string, { responses?: Record<string, unknown> }>>;
    for (const [path, method] of expected) {
      if (!authOnlyOps.has(`${path} ${method}`)) continue;
      const responses = paths[path][method].responses ?? {};
      expect(responses['401'], `missing 401 on ${method.toUpperCase()} ${path}`).toBeDefined();
    }
  });

  it('spot-checks the new org/member/invitation paths', () => {
    const spotChecks: Array<[string, string]> = [
      ['/orgs', 'get'],
      ['/orgs', 'post'],
      ['/orgs/{orgId}/members', 'get'],
      ['/orgs/{orgId}/members', 'post'],
      ['/orgs/{orgId}/invitations', 'post'],
      ['/invitations/{token}', 'get'],
      ['/invitations/{token}/accept', 'post'],
    ];
    for (const [path, method] of spotChecks) {
      const entry = (openApiSpec.paths as Record<string, Record<string, unknown>>)[path];
      expect(entry, `missing path ${path}`).toBeDefined();
      expect(entry[method], `missing ${method.toUpperCase()} ${path}`).toBeDefined();
    }
  });

  it('documents the OrgRole enum on the API-key create schema', () => {
    const createKey = openApiSpec.paths['/apikeys'].post as {
      requestBody?: { content: { 'application/json': { schema: { properties: Record<string, { enum?: readonly string[] }> } } } };
    };
    const roleProp = createKey.requestBody?.content['application/json'].schema.properties.role;
    expect(roleProp, 'apikey create schema missing role property').toBeDefined();
    expect(roleProp?.enum).toEqual(['owner', 'admin', 'editor', 'viewer']);
  });

  it('is served by GET /api/v1/openapi.json without auth', async () => {
    const res = await openapiGet();
    expect(res.status).toBe(200);
    const body = await res.json();
    expect(body.info.title).toBe('GEM-ZT API');
  });
});
