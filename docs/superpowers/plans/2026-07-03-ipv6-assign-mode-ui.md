# IPv6 Assign-Mode UI Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the already-shipped "IPv6 from pools" checkbox in `RoutesEditor` actually usable by extending `cidrToPool()` to accept IPv6 CIDRs, and stop `validateRoutesAndPools()` from misreporting well-formed IPv6 pools as malformed.

**Architecture:** No new components, no backend/schema changes. Two pure-function utilities gain IPv6 support: `cidrToPool()` in `lib/util/cidr.ts` (add a `BigInt`-based 128-bit path alongside the existing `uint32` IPv4 path) and `validateRoutesAndPools()` in `lib/util/networkValidation.ts` (skip IPv4-only arithmetic for pools that look like IPv6, reusing the existing `looksLikeIpv6` helper). `RoutesEditor.tsx`'s "Add pool from CIDR" input already accepts free text, so no UI code changes beyond the placeholder hint.

**Tech Stack:** TypeScript, `BigInt` for 128-bit IPv6 arithmetic (no new dependencies), Vitest for unit tests.

## Global Constraints

- No backend/schema changes — `z.string().ip()` in `lib/services/networks.ts` already accepts IPv6 addresses.
- Stay IPv4-only for route/gateway overlap and containment math — do not add 128-bit overlap/containment logic for IPv6 routes. Only fix the pools malformed-address false positive.
- `cidrToPool()`'s existing IPv4 behavior and error cases must not change (existing tests must keep passing unmodified except the one test asserting IPv6 throws, which is now stale and must be corrected).
- Full reference: `docs/superpowers/specs/2026-07-03-ipv6-assign-mode-ui-design.md`

---

### Task 1: Extend `cidrToPool()` to accept IPv6 CIDRs

**Files:**

- Modify: `lib/util/cidr.ts`
- Test: `tests/unit/cidr.test.ts`

**Interfaces:**

- Consumes: nothing new — reuses the existing `IPV4_RE`/`isIpv6` structural checks already in the file (via `isValidCidr`, unchanged).
- Produces: `cidrToPool(cidr: string): { ipRangeStart: string; ipRangeEnd: string }` — same signature and return shape as before, now also accepting IPv6 input instead of throwing. This is consumed by `components/networks/RoutesEditor.tsx` (`RoutesEditor.tsx:94`, unchanged call site) and by `tests/unit/cidr.test.ts`.

- [ ] **Step 1: Update the existing "throws on IPv6" test to reflect the new behavior, and add new IPv6 test cases**

Replace the `throws on invalid or IPv6 input` test block in `tests/unit/cidr.test.ts` (currently the last block in the `describe('cidrToPool', ...)` section) with:

```typescript
it('throws on invalid input', () => {
  expect(() => cidrToPool('nope')).toThrow('Invalid CIDR');
  expect(() => cidrToPool('300.1.1.1/24')).toThrow('Invalid CIDR');
});

it('converts an IPv6 /112 to a usable start/end range', () => {
  expect(cidrToPool('fd00::/112')).toEqual({
    ipRangeStart: 'fd00::',
    ipRangeEnd: 'fd00::ffff',
  });
});

it('converts an IPv6 /32', () => {
  expect(cidrToPool('2001:db8::/32')).toEqual({
    ipRangeStart: '2001:db8::',
    ipRangeEnd: '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff',
  });
});

it('handles IPv6 /127 and /128 without offsets (unlike IPv4, no address is excluded)', () => {
  expect(cidrToPool('fd00::/127')).toEqual({
    ipRangeStart: 'fd00::',
    ipRangeEnd: 'fd00::1',
  });
  expect(cidrToPool('fd00::1/128')).toEqual({
    ipRangeStart: 'fd00::1',
    ipRangeEnd: 'fd00::1',
  });
});
```

The full `describe('cidrToPool', ...)` block should now read:

```typescript
describe('cidrToPool', () => {
  it('converts a /24 to a usable start/end range', () => {
    expect(cidrToPool('10.147.17.0/24')).toEqual({
      ipRangeStart: '10.147.17.1',
      ipRangeEnd: '10.147.17.254',
    });
  });

  it('converts a /16', () => {
    expect(cidrToPool('10.10.0.0/16')).toEqual({
      ipRangeStart: '10.10.0.1',
      ipRangeEnd: '10.10.255.254',
    });
  });

  it('handles /31 and /32 without offsets', () => {
    expect(cidrToPool('10.0.0.0/31')).toEqual({
      ipRangeStart: '10.0.0.0',
      ipRangeEnd: '10.0.0.1',
    });
    expect(cidrToPool('10.0.0.5/32')).toEqual({
      ipRangeStart: '10.0.0.5',
      ipRangeEnd: '10.0.0.5',
    });
  });

  it('throws on invalid input', () => {
    expect(() => cidrToPool('nope')).toThrow('Invalid CIDR');
    expect(() => cidrToPool('300.1.1.1/24')).toThrow('Invalid CIDR');
  });

  it('converts an IPv6 /112 to a usable start/end range', () => {
    expect(cidrToPool('fd00::/112')).toEqual({
      ipRangeStart: 'fd00::',
      ipRangeEnd: 'fd00::ffff',
    });
  });

  it('converts an IPv6 /32', () => {
    expect(cidrToPool('2001:db8::/32')).toEqual({
      ipRangeStart: '2001:db8::',
      ipRangeEnd: '2001:db8:ffff:ffff:ffff:ffff:ffff:ffff',
    });
  });

  it('handles IPv6 /127 and /128 without offsets (unlike IPv4, no address is excluded)', () => {
    expect(cidrToPool('fd00::/127')).toEqual({
      ipRangeStart: 'fd00::',
      ipRangeEnd: 'fd00::1',
    });
    expect(cidrToPool('fd00::1/128')).toEqual({
      ipRangeStart: 'fd00::1',
      ipRangeEnd: 'fd00::1',
    });
  });
});
```

- [ ] **Step 2: Run the tests to see the new/changed ones fail**

Run: `npx vitest run tests/unit/cidr.test.ts`
Expected: FAIL — the "throws on invalid input" test fails because the current code throws `'Invalid IPv4 CIDR: nope'` (message text differs), and the three new IPv6 tests fail because `cidrToPool` currently throws `Invalid IPv4 CIDR: fd00::/112` etc.

- [ ] **Step 3: Implement IPv6 support in `lib/util/cidr.ts`**

Replace the full contents of `lib/util/cidr.ts`:

```typescript
const IPV4_RE =
  /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\/(3[0-2]|[12]?\d)$/;
const IPV6_PREFIX_RE = /^(12[0-8]|1[01]\d|\d{1,2})$/; // 0..128

/**
 * Structural IPv6 validation. A pure implementation (no node:net) because this
 * module is also imported by client components (RoutesEditor → cidrToPool), and
 * bundling a `node:` builtin for the browser breaks the Next.js build. Rejects
 * >8 groups, multiple '::', non-hex/over-long groups, and stray colons —
 * exactly the structurally-invalid inputs the old check let through.
 */
function isIpv6(addr: string): boolean {
  const parseGroups = (str: string): string[] | null => {
    if (str === '') return [];
    const groups = str.split(':');
    return groups.every(g => /^[0-9a-fA-F]{1,4}$/.test(g)) ? groups : null;
  };
  const parts = addr.split('::');
  if (parts.length > 2) return false; // more than one '::'
  if (parts.length === 2) {
    const left = parseGroups(parts[0]);
    const right = parseGroups(parts[1]);
    // '::' stands for >=1 all-zero group, so the explicit groups must total < 8.
    return left !== null && right !== null && left.length + right.length <= 7;
  }
  const groups = parseGroups(addr);
  return groups !== null && groups.length === 8;
}

export function isValidCidr(cidr: string): boolean {
  if (IPV4_RE.test(cidr)) return true;
  // Split on the LAST '/' so the address (which contains ':') isn't mangled.
  const slash = cidr.lastIndexOf('/');
  if (slash === -1) return false;
  const addr = cidr.slice(0, slash);
  const prefix = cidr.slice(slash + 1);
  if (!IPV6_PREFIX_RE.test(prefix)) return false;
  return isIpv6(addr);
}

function ipv4ToInt(ip: string): number {
  return ip.split('.').reduce((acc, octet) => acc * 256 + Number(octet), 0);
}

const IPV4_ADDR_RE = /^((25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)\.){3}(25[0-5]|2[0-4]\d|1\d\d|[1-9]?\d)$/;

/** Parse a dotted-quad IPv4 address to a uint32, or null if malformed. */
export function ipv4ToIntChecked(ip: string): number | null {
  return IPV4_ADDR_RE.test(ip) ? ipv4ToInt(ip) >>> 0 : null;
}

/** Inclusive [network, broadcast] uint32 range of an IPv4 CIDR, or null if not IPv4. */
export function ipv4CidrRange(cidr: string): [number, number] | null {
  if (!IPV4_RE.test(cidr)) return null;
  const [addr, prefixStr] = cidr.split('/');
  const prefix = Number(prefixStr);
  const base = ipv4ToInt(addr) >>> 0;
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
  const network = (base & mask) >>> 0;
  const broadcast = (network | (~mask >>> 0)) >>> 0;
  return [network, broadcast];
}

function intToIpv4(n: number): string {
  return [24, 16, 8, 0].map(shift => (n >>> shift) & 0xff).join('.');
}

const IPV6_GROUP_COUNT = 8;
const IPV6_BITS = 128n;
const IPV6_ALL_ONES = (1n << IPV6_BITS) - 1n;

/** Expand a (possibly '::'-compressed) IPv6 address into its 8 groups as bigints. */
function expandIpv6Groups(addr: string): bigint[] {
  const parseGroups = (s: string): bigint[] =>
    s === '' ? [] : s.split(':').map(g => BigInt(parseInt(g, 16)));
  const parts = addr.split('::');
  if (parts.length === 2) {
    const left = parseGroups(parts[0]);
    const right = parseGroups(parts[1]);
    const middle = new Array(IPV6_GROUP_COUNT - left.length - right.length).fill(0n);
    return [...left, ...middle, ...right];
  }
  return parseGroups(addr);
}

function ipv6ToBigInt(addr: string): bigint {
  return expandIpv6Groups(addr).reduce((acc, g) => (acc << 16n) | g, 0n);
}

/** Render a 128-bit value back to IPv6 text, compressing the longest run of zero groups. */
function bigIntToIpv6(n: bigint): string {
  const groups: string[] = [];
  for (let shift = 112n; shift >= 0n; shift -= 16n) {
    groups.push(((n >> shift) & 0xffffn).toString(16));
  }
  let bestStart = -1;
  let bestLen = 0;
  let curStart = -1;
  let curLen = 0;
  for (let i = 0; i < groups.length; i++) {
    if (groups[i] === '0') {
      if (curStart === -1) curStart = i;
      curLen++;
      if (curLen > bestLen) {
        bestLen = curLen;
        bestStart = curStart;
      }
    } else {
      curStart = -1;
      curLen = 0;
    }
  }
  if (bestLen > 1) {
    const head = groups.slice(0, bestStart);
    const tail = groups.slice(bestStart + bestLen);
    return `${head.join(':')}::${tail.join(':')}`;
  }
  return groups.join(':');
}

/**
 * First/last address of an IPv6 CIDR block. Unlike the IPv4 path below, no
 * addresses are excluded at the edges — IPv6 has no "network"/"broadcast"
 * address convention, so a /127 or /128 legitimately uses every address in
 * its range.
 */
function cidrToPoolV6(cidr: string): { ipRangeStart: string; ipRangeEnd: string } {
  const slash = cidr.lastIndexOf('/');
  const addr = cidr.slice(0, slash);
  const prefix = Number(cidr.slice(slash + 1));
  const base = ipv6ToBigInt(addr);
  const hostBits = IPV6_BITS - BigInt(prefix);
  const mask = (IPV6_ALL_ONES << hostBits) & IPV6_ALL_ONES;
  const network = base & mask;
  const broadcast = network | (~mask & IPV6_ALL_ONES);
  return { ipRangeStart: bigIntToIpv6(network), ipRangeEnd: bigIntToIpv6(broadcast) };
}

export function cidrToPool(cidr: string): { ipRangeStart: string; ipRangeEnd: string } {
  if (IPV4_RE.test(cidr)) {
    const [addr, prefixStr] = cidr.split('/');
    const prefix = Number(prefixStr);
    const base = ipv4ToInt(addr);
    const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0;
    const network = (base & mask) >>> 0;
    const broadcast = (network | (~mask >>> 0)) >>> 0;
    if (prefix >= 31) {
      return { ipRangeStart: intToIpv4(network), ipRangeEnd: intToIpv4(broadcast) };
    }
    return { ipRangeStart: intToIpv4(network + 1), ipRangeEnd: intToIpv4(broadcast - 1) };
  }
  if (isValidCidr(cidr)) {
    return cidrToPoolV6(cidr);
  }
  throw new Error(`Invalid CIDR: ${cidr}`);
}
```

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run tests/unit/cidr.test.ts`
Expected: PASS, all tests in the file including the four new/changed ones.

- [ ] **Step 5: Commit**

```bash
git add lib/util/cidr.ts tests/unit/cidr.test.ts
git commit -m "feat: support IPv6 CIDRs in cidrToPool"
```

---

### Task 2: Stop `validateRoutesAndPools` from flagging IPv6 pools as malformed

**Files:**

- Modify: `lib/util/networkValidation.ts`
- Test: `tests/unit/network-validation.test.ts`

**Interfaces:**

- Consumes: the existing module-private `looksLikeIpv6(s: string): boolean` function declared later in the same file (function declarations are hoisted, so this is safe to call earlier in the module) — no import changes needed.
- Produces: `validateRoutesAndPools()` keeps its existing signature and return type (`string[]`); consumed by `components/networks/RoutesEditor.tsx:249` (unchanged call site).

- [ ] **Step 1: Add failing tests for IPv6 pools**

In `tests/unit/network-validation.test.ts`, add these two cases inside the existing `describe('validateRoutesAndPools', ...)` block, after the `'returns no warnings for a clean, consistent config'` test:

```typescript
it('does not flag a well-formed IPv6 pool as malformed', () => {
  const w = validateRoutesAndPools({
    routes: [],
    pools: [{ ipRangeStart: 'fd00::', ipRangeEnd: 'fd00::ffff' }],
  });
  expect(w.some(m => /malformed/i.test(m))).toBe(false);
});

it('still flags a pool that is neither valid IPv4 nor IPv6-shaped', () => {
  const w = validateRoutesAndPools({
    routes: [],
    pools: [{ ipRangeStart: 'not-an-address', ipRangeEnd: 'also-not-one' }],
  });
  expect(w.some(m => /malformed/i.test(m))).toBe(true);
});
```

- [ ] **Step 2: Run the tests to see the new ones fail**

Run: `npx vitest run tests/unit/network-validation.test.ts`
Expected: FAIL on `'does not flag a well-formed IPv6 pool as malformed'` — the current code runs `ipv4ToIntChecked` on `'fd00::'`, gets `null`, and pushes a "malformed address" warning.

- [ ] **Step 3: Fix the pools loop in `lib/util/networkValidation.ts`**

Replace the "Pools should fall within a managed route" block (the last `for (const p of pools)` loop in `validateRoutesAndPools`) with:

```typescript
// Pools should fall within a managed route. IPv6 pools are format-checked
// only (see file-level comment) — skip the IPv4 containment math for them
// rather than misreporting them as malformed.
for (const p of pools) {
  const startIsV6 = looksLikeIpv6(p.ipRangeStart);
  const endIsV6 = looksLikeIpv6(p.ipRangeEnd);
  if (startIsV6 || endIsV6) {
    if (!startIsV6 || !endIsV6) {
      warnings.push(`Pool ${p.ipRangeStart}–${p.ipRangeEnd} mixes address families.`);
    }
    continue;
  }
  const start = ipv4ToIntChecked(p.ipRangeStart);
  const end = ipv4ToIntChecked(p.ipRangeEnd);
  if (start === null || end === null) {
    warnings.push(`Pool ${p.ipRangeStart}–${p.ipRangeEnd} has a malformed address.`);
    continue;
  }
  const covered = v4.some(({ range: [lo, hi] }) => start >= lo && end <= hi);
  if (!covered) {
    warnings.push(`Pool ${p.ipRangeStart}–${p.ipRangeEnd} is outside every managed route.`);
  }
}
```

This is a direct in-place replacement of the existing loop body — the surrounding function (`validateRoutesAndPools`), the `v4` route-range computation above it, and the `looksLikeIpv6`/`ipv4ToIntChecked` helpers elsewhere in the file are unchanged.

- [ ] **Step 4: Run the tests to confirm they pass**

Run: `npx vitest run tests/unit/network-validation.test.ts`
Expected: PASS, all tests in the file including the two new ones. Confirm the pre-existing `'flags a pool that falls outside every managed route'` test (which uses an IPv4 pool) still passes unchanged — it exercises the untouched IPv4 branch of the same loop.

- [ ] **Step 5: Commit**

```bash
git add lib/util/networkValidation.ts tests/unit/network-validation.test.ts
git commit -m "fix: stop flagging well-formed IPv6 pools as malformed"
```

---

### Task 3: Update the RoutesEditor hint text and manually verify end-to-end

**Files:**

- Modify: `components/networks/RoutesEditor.tsx`
- Modify: `TODO.md`
- Modify: `Completed_TODO.md`

**Interfaces:** None — this task changes a placeholder string and does bookkeeping; `cidrToPool` and `validateRoutesAndPools` are consumed exactly as before (no signature changes from Tasks 1-2).

- [ ] **Step 1: Update the CIDR input placeholder**

In `components/networks/RoutesEditor.tsx`, find this block (currently around line 210-219):

```typescript
        <div className="flex gap-2 items-center">
          <Input
            placeholder="10.10.0.0/16"
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
            className="mt-0 font-mono w-48"
          />
          <Button variant="outline" className="px-3 py-2 text-sm" onClick={addFromCidr}>
            Add pool from CIDR
          </Button>
        </div>
```

Change the `placeholder` and widen the input slightly so the longer hint isn't clipped:

```typescript
        <div className="flex gap-2 items-center">
          <Input
            placeholder="10.10.0.0/16 or fd00::/112"
            value={cidr}
            onChange={(e) => setCidr(e.target.value)}
            className="mt-0 font-mono w-64"
          />
          <Button variant="outline" className="px-3 py-2 text-sm" onClick={addFromCidr}>
            Add pool from CIDR
          </Button>
        </div>
```

- [ ] **Step 2: Run the full test suite**

Run: `npm run typecheck && npm run test`
Expected: both exit 0.

- [ ] **Step 3: Manual smoke test in the dev server**

Run: `npm run dev` (in the background or a separate terminal)

- Open a network's detail page, scroll to "Routes & IP pools."
- Check "IPv6 from pools" under "Auto-assign."
- In the CIDR input, type `fd00::/112` and click "Add pool from CIDR" — confirm a new pool row appears showing `fd00::` / `fd00::ffff` (or equivalent compressed form) and no "malformed address" warning appears below.
- Click "Save routes & pools" and confirm the request succeeds (no error banner) against a real/dev controller.
- Reload the page and confirm the IPv6 pool and the "IPv6 from pools" checkbox both persisted.

Stop the dev server when done.

- [ ] **Step 4: Update `TODO.md`**

Remove the "IPv4/IPv6 assign-mode toggles + full per-member controls" line from the "P1 — high value, do next" section in `TODO.md` (it's now fully resolved — the toggles were already shipped, and this plan closed the remaining IPv6-pool gap). Renumber the remaining items.

- [ ] **Step 5: Add the completed item to `Completed_TODO.md`**

Append to the "ZTNET-parity features" section in `Completed_TODO.md`:

```markdown
- ✅ **[DONE] [P1] IPv4/IPv6 assign-mode UI — IPv6 pools.** _(Fixed 2026-07-03: the
  `v4AssignMode`/`v6AssignMode` checkboxes and per-member `activeBridge`/`noAutoAssignIps`
  toggles were already shipped; this closed the remaining gap where "IPv6 from pools" had no
  way to actually create an IPv6 pool. `cidrToPool()` now supports IPv6 CIDRs, and
  `validateRoutesAndPools()` no longer misreports IPv6 pools as malformed. See
  `docs/superpowers/specs/2026-07-03-ipv6-assign-mode-ui-design.md`.)_
```

- [ ] **Step 6: Commit**

```bash
git add components/networks/RoutesEditor.tsx TODO.md Completed_TODO.md
git commit -m "feat: hint IPv6 CIDR support in routes editor; mark assign-mode UI complete"
```
