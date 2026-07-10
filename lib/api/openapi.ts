const errorResponse = {
  description: 'Error envelope',
  content: { 'application/json': { schema: { $ref: '#/components/schemas/Error' } } },
};

const ok = (description: string) => ({ '200': { description }, '502': errorResponse });

// Every endpoint that resolves an org role (requireOrgRole/requireSuperAdmin)
// can fail auth (no/invalid credentials) or authorization (authenticated but
// lacking the role/membership needed) — 401 and 403 respectively.
const authz = { '401': errorResponse, '403': errorResponse };

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
    '/auth/totp/enroll': {
      post: {
        tags: ['auth'],
        summary:
          'Generate a new TOTP secret for the current user (overwrites any prior ' +
          'unconfirmed secret); totpEnabled stays false until confirmed via /auth/totp/enable',
        responses: { '200': { description: '{ secret, otpauthUri }' }, '401': errorResponse },
      },
    },
    '/auth/totp/enable': {
      post: {
        tags: ['auth'],
        summary: 'Confirm TOTP enrollment with a current code; sets totpEnabled=true',
        responses: {
          '200': { description: '{ enabled: true }' },
          '400': errorResponse,
          '401': errorResponse,
        },
      },
    },
    '/auth/totp/disable': {
      post: {
        tags: ['auth'],
        summary: 'Disable TOTP with the current password; clears the stored secret',
        responses: {
          '200': { description: '{ enabled: false }' },
          '400': errorResponse,
          '401': errorResponse,
          '409': errorResponse,
        },
      },
    },
    '/auth/password': {
      patch: {
        tags: ['auth'],
        summary: "Change the current user's password; invalidates every other session",
        responses: {
          '204': { description: 'Password changed' },
          '400': errorResponse,
          '401': errorResponse,
        },
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
        summary: "List API keys for the caller's active org (prefix only; never the full key)",
        responses: { '200': { description: '{ apiKeys[] }' }, ...authz },
      },
      post: {
        tags: ['apikeys'],
        summary:
          'Create an org-scoped API key; the full ztk_ key is returned exactly once. The key ' +
          "inherits the given role (capped at the creator's own role) and is bound to the " +
          "caller's active org",
        requestBody: {
          required: true,
          content: {
            'application/json': {
              schema: {
                type: 'object',
                required: ['name', 'role'],
                properties: {
                  name: { type: 'string', minLength: 1, maxLength: 64 },
                  role: { type: 'string', enum: ['owner', 'admin', 'editor', 'viewer'] },
                  expiresAt: { type: 'string', format: 'date-time' },
                },
              },
            },
          },
        },
        responses: {
          '201': { description: '{ apiKey, fullKey }' },
          '400': errorResponse,
          ...authz,
        },
      },
    },
    '/apikeys/{id}': {
      delete: {
        tags: ['apikeys'],
        summary: 'Revoke an API key (must belong to the caller in their active org)',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Revoked' }, '404': errorResponse, ...authz },
      },
    },
    '/controller/status': {
      get: {
        tags: ['controller'],
        summary: 'Controller node id, version, online state (502 when degraded); super-admin only',
        responses: { ...ok('{ address, online, version }'), ...authz },
      },
    },
    '/networks': {
      get: {
        tags: ['networks'],
        summary: 'List networks (controller state joined with metadata)',
        responses: { ...ok('{ networks[] }'), ...authz },
      },
      post: {
        tags: ['networks'],
        summary: 'Create a network on the controller, then store metadata',
        responses: {
          '201': { description: '{ network, metaWarning }' },
          '400': errorResponse,
          '502': errorResponse,
          ...authz,
        },
      },
    },
    '/networks/{nwid}': {
      get: {
        tags: ['networks'],
        summary: 'Network detail (live controller config + metadata)',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { ...ok('{ network }'), '404': errorResponse, ...authz },
      },
      patch: {
        tags: ['networks'],
        summary:
          'Update name/description/tags (metadata) and private, enableBroadcast, mtu, ' +
          'multicast limit, routes, ipAssignmentPools, v4AssignMode, v6AssignMode, dns ' +
          '(controller, written first)',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { ...ok('{ network, metaWarning }'), '400': errorResponse, ...authz },
      },
      delete: {
        tags: ['networks'],
        summary: 'Delete a network from the controller (metadata cleaned up best-effort)',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Deleted' }, '502': errorResponse, ...authz },
      },
    },
    '/networks/{nwid}/members': {
      get: {
        tags: ['members'],
        summary: 'List members with live presence (joined from /peer; unknown when absent)',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { ...ok('{ members[] }'), ...authz },
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
        responses: { ...ok('{ member }'), '404': errorResponse, ...authz },
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
        responses: { ...ok('{ member, metaWarning }'), '400': errorResponse, ...authz },
      },
      delete: {
        tags: ['members'],
        summary: 'Remove a member from the network',
        parameters: [
          { name: 'nwid', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'memberId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '204': { description: 'Removed' }, '502': errorResponse, ...authz },
      },
    },
    '/networks/{nwid}/presence': {
      get: {
        tags: ['members'],
        summary:
          'Presence history for members with recorded samples: last-seen timestamp + recent ' +
          'online/offline samples (oldest first), sampled opportunistically while the members ' +
          'list is viewed',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { ...ok('{ presence }'), ...authz },
      },
    },
    '/networks/{nwid}/rules': {
      get: {
        tags: ['rules'],
        summary: 'Rules source (stored by GEM-ZT) + compiled rules (live from the controller)',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { ...ok('{ source, rules }'), ...authz },
      },
      put: {
        tags: ['rules'],
        summary: 'Compile rules source and push to the controller; 422 on compile errors',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          ...ok('{ source, rules, metaWarning }'),
          '400': errorResponse,
          '422': errorResponse,
          ...authz,
        },
      },
    },
    '/audit': {
      get: {
        tags: ['audit'],
        summary: "Audit log entries for the caller's active org, newest first (?limit=, max 500)",
        parameters: [
          {
            name: 'limit',
            in: 'query',
            required: false,
            schema: { type: 'integer', maximum: 500 },
          },
        ],
        responses: { '200': { description: '{ entries[] }' }, ...authz },
      },
    },
    '/networks/{nwid}/clone': {
      post: {
        tags: ['networks'],
        summary: 'Create a new network from an existing one (config + rules source)',
        parameters: [{ name: 'nwid', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '201': { description: '{ network, metaWarning }' },
          '404': errorResponse,
          '502': errorResponse,
          ...authz,
        },
      },
    },
    '/templates': {
      get: {
        tags: ['templates'],
        summary: 'List saved network templates',
        responses: { '200': { description: '{ templates[] }' }, ...authz },
      },
      post: {
        tags: ['templates'],
        summary: 'Save a network as a named template ({ nwid, name })',
        responses: {
          '201': { description: '{ template }' },
          '400': errorResponse,
          '404': errorResponse,
          ...authz,
        },
      },
    },
    '/templates/{id}': {
      delete: {
        tags: ['templates'],
        summary: 'Delete a template',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Deleted' }, '404': errorResponse, ...authz },
      },
    },
    '/templates/{id}/apply': {
      post: {
        tags: ['templates'],
        summary: 'Create a new network from a template',
        parameters: [{ name: 'id', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '201': { description: '{ network, metaWarning }' },
          '404': errorResponse,
          '502': errorResponse,
          ...authz,
        },
      },
    },
    '/metrics': {
      get: {
        tags: ['meta'],
        summary:
          'Prometheus text-exposition metrics: controller liveness + inventory counts; ' +
          'super-admin only',
        responses: { '200': { description: 'text/plain metrics' }, '502': errorResponse, ...authz },
      },
    },
    '/pending': {
      get: {
        tags: ['members'],
        summary: 'Devices awaiting authorization across all networks',
        responses: { ...ok('{ pending[] }'), ...authz },
      },
    },
    '/backup': {
      get: {
        tags: ['backup'],
        summary:
          'Export a JSON backup of all networks (config + rules), members, and GEM-ZT ' +
          'metadata; super-admin only',
        responses: { ...ok('BackupData JSON, served as a file attachment'), ...authz },
      },
    },
    '/backup/restore': {
      post: {
        tags: ['backup'],
        summary:
          'Replay a backup against the live controller: updates networks that still exist, ' +
          're-creates ones that do not (new nwid), restores joined members, skips the rest; ' +
          'super-admin only',
        responses: {
          '200': { description: 'RestoreSummary JSON' },
          '400': errorResponse,
          ...authz,
        },
      },
    },
    '/settings/webhook': {
      get: {
        tags: ['settings'],
        summary:
          "Get the caller's org-scoped webhook config (outbound URL for " +
          'new-unauthorized-member alerts); requires webhook:manage (admin+)',
        responses: { '200': { description: '{ newMemberUrl: string | null }' }, ...authz },
      },
      put: {
        tags: ['settings'],
        summary:
          'Set (or clear, with null) the org-scoped outbound webhook URL for ' +
          'new-unauthorized-member alerts; must be a valid http/https URL; requires ' +
          'webhook:manage (admin+)',
        responses: {
          '200': { description: '{ newMemberUrl: string | null }' },
          '400': errorResponse,
          ...authz,
        },
      },
    },
    '/orgs': {
      get: {
        tags: ['orgs'],
        summary:
          'List organizations the caller belongs to (super-admins see every org, with ' +
          'role: null where they hold no membership)',
        responses: { '200': { description: '{ orgs[] }' }, '401': errorResponse },
      },
      post: {
        tags: ['orgs'],
        summary: 'Create a new organization; super-admin only',
        responses: { '201': { description: '{ org }' }, '400': errorResponse, ...authz },
      },
    },
    '/orgs/{orgId}': {
      get: {
        tags: ['orgs'],
        summary: "Organization detail, including the caller's role in it",
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '{ org }' }, '404': errorResponse, ...authz },
      },
      patch: {
        tags: ['orgs'],
        summary: 'Rename an organization; requires org:manage',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '{ org }' }, '400': errorResponse, ...authz },
      },
      delete: {
        tags: ['orgs'],
        summary: 'Delete an organization; requires org:delete',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '204': { description: 'Deleted' }, ...authz },
      },
    },
    '/orgs/{orgId}/active': {
      post: {
        tags: ['orgs'],
        summary:
          "Switch the caller's active org for the current session (session auth only; " +
          'API keys are bound to one org and cannot switch)',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '204': { description: 'Active org switched' },
          '400': errorResponse,
          '404': errorResponse,
          ...authz,
        },
      },
    },
    '/orgs/{orgId}/members': {
      get: {
        tags: ['orgs'],
        summary:
          'List members of an org; owners/admins/super-admins also see super-admin users ' +
          'with implicit (non-membership) access, requires org:read',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '{ members[] }' }, ...authz },
      },
      post: {
        tags: ['orgs'],
        summary:
          'Create a new user and add them to the org with the given role; requires ' +
          'org:manage-members (only an owner or super-admin may grant the owner role)',
        responses: {
          '201': { description: '{ member }' },
          '400': errorResponse,
          '409': errorResponse,
          ...authz,
        },
      },
    },
    '/orgs/{orgId}/members/{userId}': {
      patch: {
        tags: ['orgs'],
        summary:
          "Change a member's role; requires org:manage-members (only an owner or " +
          'super-admin may grant or change the owner role; 409 if it would leave the org ' +
          'without an owner)',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: {
          '200': { description: '{ member }' },
          '400': errorResponse,
          '409': errorResponse,
          ...authz,
        },
      },
      delete: {
        tags: ['orgs'],
        summary:
          'Remove a member from the org; requires org:manage-members (409 if it would ' +
          'leave the org without an owner)',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'userId', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '204': { description: 'Removed' }, '409': errorResponse, ...authz },
      },
    },
    '/orgs/{orgId}/invitations': {
      get: {
        tags: ['invitations'],
        summary: 'List pending/past invitations for an org; requires org:manage-members',
        parameters: [{ name: 'orgId', in: 'path', required: true, schema: { type: 'string' } }],
        responses: { '200': { description: '{ invitations[] }' }, ...authz },
      },
      post: {
        tags: ['invitations'],
        summary:
          'Create an invitation for a role, optionally scoped to an email, with a TTL ' +
          '(default 7 days, max 30); requires org:manage-members (only an owner or ' +
          'super-admin may grant the owner role); the raw token is returned exactly once',
        responses: {
          '201': { description: '{ invitation, token }' },
          '400': errorResponse,
          ...authz,
        },
      },
    },
    '/orgs/{orgId}/invitations/{id}': {
      delete: {
        tags: ['invitations'],
        summary: 'Revoke a pending invitation; requires org:manage-members',
        parameters: [
          { name: 'orgId', in: 'path', required: true, schema: { type: 'string' } },
          { name: 'id', in: 'path', required: true, schema: { type: 'string' } },
        ],
        responses: { '204': { description: 'Revoked' }, '404': errorResponse, ...authz },
      },
    },
    '/invitations/{token}': {
      get: {
        tags: ['invitations'],
        summary:
          'Preview an invitation before accepting it (org name + role); public, ' +
          'IP-rate-limited to deter token probing',
        security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '200': { description: '{ org: { name }, role }' },
          '404': errorResponse,
          '409': errorResponse,
          '410': errorResponse,
          '429': errorResponse,
        },
      },
    },
    '/invitations/{token}/accept': {
      post: {
        tags: ['invitations'],
        summary:
          'Accept an invitation by creating a new user account and joining the org with ' +
          'the invited role; sets the session cookie; public, IP-rate-limited',
        security: [],
        parameters: [{ name: 'token', in: 'path', required: true, schema: { type: 'string' } }],
        responses: {
          '201': { description: '{ user }' },
          '404': errorResponse,
          '409': errorResponse,
          '410': errorResponse,
          '429': errorResponse,
        },
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
