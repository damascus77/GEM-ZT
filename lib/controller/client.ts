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
    message: string,
  ) {
    super(message);
  }
}

export interface ControllerClientOptions {
  baseUrl: string;
  token: string;
  fetchFn?: typeof globalThis.fetch;
}

export class ControllerClient {
  private readonly fetchFn: typeof globalThis.fetch;

  constructor(private readonly opts: ControllerClientOptions) {
    this.fetchFn = opts.fetchFn ?? globalThis.fetch;
  }

  private async request<T>(
    method: 'GET' | 'POST' | 'DELETE',
    path: string,
    body?: unknown,
  ): Promise<T> {
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
      });
    } catch (e) {
      throw new ControllerUnreachableError(
        `Controller request failed: ${method} ${path}: ${(e as Error).message}`,
      );
    }
    if (!res.ok) {
      throw new ControllerApiError(
        res.status,
        `Controller returned ${res.status} for ${method} ${path}`,
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

  getNetwork(nwid: string): Promise<ControllerNetwork> {
    return this.request<ControllerNetwork>('GET', `/controller/network/${nwid}`);
  }

  createNetwork(
    nodeId: string,
    config: Partial<ControllerNetwork> = {},
  ): Promise<ControllerNetwork> {
    return this.request<ControllerNetwork>('POST', `/controller/network/${nodeId}______`, config);
  }

  updateNetwork(nwid: string, config: Partial<ControllerNetwork>): Promise<ControllerNetwork> {
    return this.request<ControllerNetwork>('POST', `/controller/network/${nwid}`, config);
  }

  async deleteNetwork(nwid: string): Promise<void> {
    await this.request<unknown>('DELETE', `/controller/network/${nwid}`);
  }

  listMemberIds(nwid: string): Promise<Record<string, number>> {
    return this.request<Record<string, number>>('GET', `/controller/network/${nwid}/member`);
  }

  getMember(nwid: string, memberId: string): Promise<ControllerMember> {
    return this.request<ControllerMember>(
      'GET',
      `/controller/network/${nwid}/member/${memberId}`,
    );
  }

  updateMember(
    nwid: string,
    memberId: string,
    config: Partial<ControllerMember>,
  ): Promise<ControllerMember> {
    return this.request<ControllerMember>(
      'POST',
      `/controller/network/${nwid}/member/${memberId}`,
      config,
    );
  }

  async deleteMember(nwid: string, memberId: string): Promise<void> {
    await this.request<unknown>('DELETE', `/controller/network/${nwid}/member/${memberId}`);
  }

  listPeers(): Promise<ControllerPeer[]> {
    return this.request<ControllerPeer[]>('GET', '/peer');
  }
}
