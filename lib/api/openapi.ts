const errorResponse = {
  description: 'Error envelope',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};

const ok = (description: string) => ({ '200': { description }, '502': errorResponse });

export const openApiSpec = {
  openapi: '3.0.3',
  info: {
    title: 'GEM-ZT API',
    version: '1.0.0',
    description:
      'Self-hosted ZeroTier network controller API. Authenticate with the gemzt_session ' +
      'cookie (browser) or `Authorization: Bearer ztk_...` (API keys). All errors use the ' +
      'envelope `{ "error": { "code", "message" } }`. The ZeroTier controller is the source ' +
      'of truth; GEM-ZT metadata (names, notes) augments it.',
  },
  servers: [{ url: '/api/v1' }],
  security: [{ apiKey: [] }, { session: [] }],
  components: {
    securitySchemes: {
      apiKey: { type: 'http', scheme: 'bearer', bearerFormat: 'ztk_<48 hex chars>' },
      session: { type: 'apiKey', in: 'cookie', name: 'gemzt_session' },
    },
    schemas: {
      Error: {
        type: 'object',
        required: ['error'],
        properties: {
          error: {
            type: 'object',
            required: ['code', 'message'],
            properties: {
              code: { type: 'string' },
              message: { type: 'string' },
            },
          },
        },
      },
    },
  },
  paths: {
    '/setup/status': {
      get: {
        tags: ['setup'],
        summary: 'Whether first-run setup is needed',
        security: [],
        responses: { '200': { description: '{ needsSetup: boolean }' } },
      },
    },
    '/setup': {
      post: {
        tags: ['setup'],
        summary: 'Create the initial admin account (only while no users exist)',
        security: [],
        responses: {
          '201': { description: 'Admin created; session cookie set' },
          '400': errorResponse,
          '409': errorResponse,
        },
      },
    },
    '/auth/login': {
      post: {
        tags: ['auth'],
        summary: 'Log in with username + password; sets the session cookie',
        security: [],
        responses: { '200': { description: 'Logged in' }, '401': errorResponse },
      },
    },
    '/auth/logout': {
      post: {
        tags: ['auth'],
        summary: 'Log out and clear the session cookie',
        responses: { '204': { description: 'Logged out' } },
      },
    },
    '/me': {
      get: {
        tags: ['auth'],
        summary: 'Current authenticated user',
        responses: { '200': { description: '{ user }' }, '401': errorResponse },
      },
    },
    '/apikeys': {
      get: {
        tags: ['apikeys'],
        summary: 'List API keys (prefix only; never the full key)',
        responses: { '200': { description: '{ apiKeys[] }' } },
      },
      post: {
        tags: ['apikeys'],
        summary: 'Create an API key; the full ztk_ key is returned exactly once',
        responses: { '201': { description: '{ apiKey, fullKey }' }, '400': errorResponse },
      },
    },
    '/apikeys/{id}': {
      delete: {
        tags: ['apikeys'],
        summary: 'Revoke an API key',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Revoked' }, '404': errorResponse },
      },
    },
    '/controller/status': {
      get: {
        tags: ['controller'],
        summary: 'Controller node id, version, online state (502 when degraded)',
        responses: ok('{ address, online, version }'),
      },
    },
    '/networks': {
      get: {
        tags: ['networks'],
        summary: 'List networks (controller state joined with metadata)',
        responses: ok('{ networks[] }'),
      },
      post: {
        tags: ['networks'],
        summary: 'Create a network on the controller, then store metadata',
        responses: { '201': { description: '{ network, metaWarning }' }, '400': errorResponse, '502': errorResponse },
      },
    },
    '/networks/{nwid}': {
      get: {
        tags: ['networks'],
        summary: 'Network detail (live controller config + metadata)',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { ...ok('{ network }'), '404': errorResponse },
      },
      patch: {
        tags: ['networks'],
        summary:
          'Update name/description/tags (metadata) and private, enableBroadcast, mtu, ' +
          'multicast limit, routes, ipAssignmentPools, v4AssignMode, v6AssignMode, dns ' +
          '(controller, written first)',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { ...ok('{ network, metaWarning }'), '400': errorResponse },
      },
      delete: {
        tags: ['networks'],
        summary: 'Delete a network from the controller (metadata cleaned up best-effort)',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Deleted' }, '502': errorResponse },
      },
    },
    '/networks/{nwid}/members': {
      get: {
        tags: ['members'],
        summary: 'List members with live presence (joined from /peer; unknown when absent)',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: ok('{ members[] }'),
      },
    },
    '/networks/{nwid}/members/{memberId}': {
      get: {
        tags: ['members'],
        summary: 'Member detail',
        parameters: [
          { name: 'nwid', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'memberId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { ...ok('{ member }'), '404': errorResponse },
      },
      patch: {
        tags: ['members'],
        summary:
          'Authorize/deauthorize, set ipAssignments, activeBridge, capabilities, tags ' +
          '(controller, written first) and name/notes (metadata)',
        parameters: [
          { name: 'nwid', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'memberId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { ...ok('{ member, metaWarning }'), '400': errorResponse },
      },
      delete: {
        tags: ['members'],
        summary: 'Remove a member from the network',
        parameters: [
          { name: 'nwid', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'memberId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '204': { description: 'Removed' }, '502': errorResponse },
      },
    },
    '/networks/{nwid}/rules': {
      get: {
        tags: ['rules'],
        summary: 'Rules source (stored by GEM-ZT) + compiled rules (live from the controller)',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: ok('{ source, rules }'),
      },
      put: {
        tags: ['rules'],
        summary: 'Compile rules source and push to the controller; 422 on compile errors',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          ...ok('{ source, rules, metaWarning }'),
          '400': errorResponse,
          '422': errorResponse,
        },
      },
    },
    '/audit': {
      get: {
        tags: ['audit'],
        summary: 'Audit log entries, newest first (?limit=, max 500)',
        parameters: [
          { name: 'limit', in: 'query', required: false, schema: { type: 'integer', maximum: 500 } },
        ],
        responses: { '200': { description: '{ entries[] }' } },
      },
    },
    '/networks/{nwid}/clone': {
      post: {
        tags: ['networks'],
        summary: 'Create a new network from an existing one (config + rules source)',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '201': { description: '{ network, metaWarning }' }, '404': errorResponse, '502': errorResponse },
      },
    },
    '/metrics': {
      get: {
        tags: ['meta'],
        summary: 'Prometheus text-exposition metrics: controller liveness + inventory counts',
        responses: { '200': { description: 'text/plain metrics' }, '502': errorResponse },
      },
    },
    '/openapi.json': {
      get: {
        tags: ['meta'],
        summary: 'This OpenAPI document',
        security: [],
        responses: { '200': { description: 'OpenAPI 3.0.3 spec' } },
      },
    },
  },
} as const;
