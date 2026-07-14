import type {
  ControllerMember,
  ControllerNetwork,
  ControllerPeer,
  ControllerStatus,
} from './types';

export class ControllerUnreachableError extends Error {
  readonly code = 'CONTROLLER_UNREACHABLE';
}

export class ControllerApiError extends Error {
  constructor(
    public readonly status: number,
    message: string
  ) {
    super(message);
  }
}

/**
 * Thrown when an nwid/node/member id fails format validation before it would be
 * interpolated into a controller URL. Guards against steering requests at
 * arbitrary controller API paths and against minting junk controller entries.
 */
export class InvalidControllerIdError extends Error {
  readonly code = 'INVALID_CONTROLLER_ID';
}

const NWID_RE = /^[0-9a-f]{16}$/;
const NODE_ID_RE = /^[0-9a-f]{10}$/;

function assertNwid(nwid: string): void {
  if (!NWID_RE.test(nwid)) {
    throw new InvalidControllerIdError(`Invalid network id: expected 16 hex chars, got "${nwid}".`);
  }
}

function assertNodeId(id: string, kind: 'member' | 'node'): void {
  if (!NODE_ID_RE.test(id)) {
    throw new InvalidControllerIdError(`Invalid ${kind} id: expected 10 hex chars, got "${id}".`);
  }
}

// Fail a controller request after this long instead of hanging indefinitely.
// Node's fetch has no default total timeout, so without this a slow or
// unreachable controller would stall the entire members-list fan-out (one GET
// per member) and leave the UI stuck on "Loading…" for minutes.
const DEFAULT_TIMEOUT_MS = 8000;

export interface ControllerClientOptions {
  baseUrl: string;
  token: string;
  fetchFn?: typeof globalThis.fetch;
  timeoutMs?: number;
}

export class ControllerClient {
  private readonly fetchFn: typeof globalThis.fetch;
  private readonly timeoutMs: number;

  constructor(private readonly opts: ControllerClientOptions) {
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
    this.timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown
  ): Promise<T> {
    const abort = new AbortController();
    const timer = setTimeout(() => abort.abort(), this.timeoutMs);
    let res: Response;
    try {
      res = await this.fetchFn(`${this.opts.baseUrl}${path}`, {
        method,
        headers: {
          'X-ZT1-AUTH': this.opts.token,
          ...(body !== undefined ? { 'Content-Type': 'application/json' } : {}),
        },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        cache: 'no-store',
        signal: abort.signal,
      });
    } catch (e) {
      // A timeout surfaces as an AbortError; report it as unreachable (with the
      // reason) so callers degrade gracefully instead of hanging.
      const reason =
        (e as Error).name === 'AbortError'
          ? `timed out after ${this.timeoutMs}ms`
          : (e as Error).message;
      throw new ControllerUnreachableError(
        `Controller request failed: ${method} ${path}: ${reason}`
      );
    } finally {
      clearTimeout(timer);
    }
    if (!res.ok) {
      throw new ControllerApiError(
        res.status,
        `Controller returned ${res.status} for ${method} ${path}`
      );
    }
    return (await res.json()) as T;
  }

  getStatus(): Promise<ControllerStatus> {
    return this.request<ControllerStatus>('GET', '/status');
  }

  listNetworkIds(): Promise<string[]> {
    return this.request<string[]>('GET', '/controller/network');
  }

  async getNetwork(nwid: string): Promise<ControllerNetwork> {
    assertNwid(nwid);
    return this.request<ControllerNetwork>('GET', `/controller/network/${nwid}`);
  }

  async createNetwork(
    nodeId: string,
    config: Partial<ControllerNetwork> = {}
  ): Promise<ControllerNetwork> {
    assertNodeId(nodeId, 'node');
    return this.request<ControllerNetwork>('POST', `/controller/network/${nodeId}______`, config);
  }

  async updateNetwork(
    nwid: string,
    config: Partial<ControllerNetwork>
  ): Promise<ControllerNetwork> {
    assertNwid(nwid);
    return this.request<ControllerNetwork>('POST', `/controller/network/${nwid}`, config);
  }

  async deleteNetwork(nwid: string): Promise<void> {
    assertNwid(nwid);
    await this.request<unknown>('DELETE', `/controller/network/${nwid}`);
  }

  async listMemberIds(nwid: string): Promise<Record<string, number>> {
    assertNwid(nwid);
    return this.request<Record<string, number>>('GET', `/controller/network/${nwid}/member`);
  }

  async getMember(nwid: string, memberId: string): Promise<ControllerMember> {
    assertNwid(nwid);
    assertNodeId(memberId, 'member');
    return this.request<ControllerMember>('GET', `/controller/network/${nwid}/member/${memberId}`);
  }

  async updateMember(
    nwid: string,
    memberId: string,
    config: Partial<ControllerMember>
  ): Promise<ControllerMember> {
    assertNwid(nwid);
    assertNodeId(memberId, 'member');
    return this.request<ControllerMember>(
      'POST',
      `/controller/network/${nwid}/member/${memberId}`,
      config
    );
  }

  async deleteMember(nwid: string, memberId: string): Promise<void> {
    assertNwid(nwid);
    assertNodeId(memberId, 'member');
    await this.request<unknown>('DELETE', `/controller/network/${nwid}/member/${memberId}`);
  }

  listPeers(): Promise<ControllerPeer[]> {
    return this.request<ControllerPeer[]>('GET', '/peer');
  }
}
