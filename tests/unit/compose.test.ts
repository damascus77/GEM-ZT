import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { parse } from 'yaml';

const compose = parse(readFileSync('docker-compose.yml', 'utf8'));

describe('docker-compose topology', () => {
  it('runs the official zerotier-one image with persistent volume and UDP 9993', () => {
    const c = compose.services['zerotier-controller'];
    expect(c.image).toMatch(/^zerotier\/zerotier:1\./);
    expect(c.volumes).toContain('controller_data:/var/lib/zerotier-one');
    expect(c.ports).toContain('9993:9993/udp');
    expect(c.restart).toBe('unless-stopped');
  });

  it('does not publish the controller HTTP API to the host', () => {
    const c = compose.services['zerotier-controller'];
    expect(c.ports).toHaveLength(1); // UDP only
  });

  it('allows management API access from the internal docker network', () => {
    const c = compose.services['zerotier-controller'];
    expect(c.environment).toContain('ZT_OVERRIDE_LOCAL_CONF=true');
    expect(c.environment).toContain('ZT_ALLOW_MANAGEMENT_FROM=0.0.0.0/0');
  });

  it('mounts controller_data read-only into the app for authtoken.secret', () => {
    const app = compose.services.app;
    expect(app.volumes).toContain('controller_data:/controller:ro');
    expect(app.volumes).toContain('app_data:/data');
  });

  it('wires the app to the controller over the internal network', () => {
    const app = compose.services.app;
    expect(app.environment).toContain('ZT_CONTROLLER_URL=http://zerotier-controller:9993');
    expect(app.environment).toContain('ZT_TOKEN_PATH=/controller/authtoken.secret');
    expect(app.environment).toContain('DATABASE_URL=file:/data/gemzt.db');
    expect(app.ports).toContain('3000:3000');
    expect(app.depends_on).toContain('zerotier-controller');
  });

  it('declares both named volumes', () => {
    expect(compose.volumes).toHaveProperty('controller_data');
    expect(compose.volumes).toHaveProperty('app_data');
  });
});
