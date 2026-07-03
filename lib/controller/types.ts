export interface ControllerStatus {
  address: string;
  online: boolean;
  version: string;
}

export interface Route {
  target: string;
  via?: string | null;
}

export interface IpPool {
  ipRangeStart: string;
  ipRangeEnd: string;
}

export interface DnsConfig {
  domain: string;
  servers: string[];
}

export interface ControllerNetwork {
  id: string;
  nwid: string;
  name: string;
  private: boolean;
  enableBroadcast: boolean;
  mtu: number;
  multicastLimit: number;
  routes: Route[];
  ipAssignmentPools: IpPool[];
  v4AssignMode: { zt: boolean };
  v6AssignMode: { zt: boolean; '6plane': boolean; rfc4193: boolean };
  dns: DnsConfig;
  rules: unknown[];
  capabilities: unknown[];
  tags: unknown[];
  creationTime: number;
  revision: number;
}

export interface ControllerMember {
  id: string;
  nwid: string;
  authorized: boolean;
  activeBridge: boolean;
  ipAssignments: string[];
  noAutoAssignIps: boolean;
  capabilities: number[];
  tags: [number, number][];
  lastAuthorizedTime: number;
  creationTime: number;
  revision: number;
  vMajor: number;
  vMinor: number;
  vRev: number;
}

export interface PeerPath {
  address: string;
  active: boolean;
  preferred: boolean;
  lastReceive: number;
  lastSend: number;
}

export interface ControllerPeer {
  address: string;
  latency: number;
  version: string;
  role: string;
  paths: PeerPath[];
}
