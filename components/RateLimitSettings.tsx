'use client';

import { useEffect, useState } from 'react';
import { useMutation, useQuery } from '@tanstack/react-query';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { Input } from '@/components/ui/Input';

interface RateLimitValues {
  loginMaxAttempts: number;
  loginIpMaxAttempts: number;
  loginWindowMs: number;
  selfAuthorizeMaxAttempts: number;
  selfAuthorizeWindowMs: number;
}

interface RateLimitResponse {
  defaults: RateLimitValues;
  effective: RateLimitValues;
  overrides: Partial<RateLimitValues>;
}

const emptyValues: RateLimitValues = {
  loginMaxAttempts: 5,
  loginIpMaxAttempts: 20,
  loginWindowMs: 900_000,
  selfAuthorizeMaxAttempts: 10,
  selfAuthorizeWindowMs: 900_000,
};

export function RateLimitSettings() {
  const [values, setValues] = useState<RateLimitValues>(emptyValues);

  const settingsQuery = useQuery<RateLimitResponse>({
    queryKey: ['admin-rate-limits'],
    queryFn: async () => {
      const res = await fetch('/api/v1/admin/rate-limits');
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Failed to load rate limits.');
      }
      return res.json();
    },
  });

  useEffect(() => {
    if (settingsQuery.data) setValues(settingsQuery.data.effective);
  }, [settingsQuery.data]);

  const save = useMutation({
    mutationFn: async () => {
      const res = await fetch('/api/v1/admin/rate-limits', {
        method: 'PUT',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(values),
      });
      if (!res.ok) {
        const parsed = await res.json().catch(() => null);
        throw new Error(parsed?.error?.message ?? 'Failed to save rate limits.');
      }
      return (await res.json()) as RateLimitResponse;
    },
    onSuccess: data => {
      setValues(data.effective);
      settingsQuery.refetch();
    },
  });

  function setNumber(key: keyof RateLimitValues, value: string) {
    setValues(current => ({ ...current, [key]: Number(value) }));
  }

  return (
    <Card>
      <h2 className="wght-540 mb-4 text-[20px] tracking-[-0.4px]">Rate limits</h2>
      {settingsQuery.isLoading && <p className="text-sm text-ink-mute">Loading...</p>}
      {settingsQuery.isError && (
        <p role="alert" className="text-sm text-ink">
          {(settingsQuery.error as Error).message}
        </p>
      )}
      {settingsQuery.data && (
        <form
          className="grid gap-4"
          onSubmit={e => {
            e.preventDefault();
            save.mutate();
          }}
        >
          <div className="grid gap-3 md:grid-cols-3">
            <NumberField
              label="Login attempts per username"
              value={values.loginMaxAttempts}
              defaultValue={settingsQuery.data.defaults.loginMaxAttempts}
              min={1}
              onChange={value => setNumber('loginMaxAttempts', value)}
            />
            <NumberField
              label="Login attempts per IP"
              value={values.loginIpMaxAttempts}
              defaultValue={settingsQuery.data.defaults.loginIpMaxAttempts}
              min={1}
              onChange={value => setNumber('loginIpMaxAttempts', value)}
            />
            <NumberField
              label="Login window"
              value={values.loginWindowMs}
              defaultValue={settingsQuery.data.defaults.loginWindowMs}
              min={1000}
              onChange={value => setNumber('loginWindowMs', value)}
            />
            <NumberField
              label="Self-authorize attempts"
              value={values.selfAuthorizeMaxAttempts}
              defaultValue={settingsQuery.data.defaults.selfAuthorizeMaxAttempts}
              min={1}
              onChange={value => setNumber('selfAuthorizeMaxAttempts', value)}
            />
            <NumberField
              label="Self-authorize window"
              value={values.selfAuthorizeWindowMs}
              defaultValue={settingsQuery.data.defaults.selfAuthorizeWindowMs}
              min={1000}
              onChange={value => setNumber('selfAuthorizeWindowMs', value)}
            />
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Button type="submit" disabled={save.isPending}>
              Save rate limits
            </Button>
            {save.isSuccess && <p className="text-sm text-ink-mute">Saved.</p>}
            {save.isError && (
              <p role="alert" className="text-sm text-ink">
                {(save.error as Error).message}
              </p>
            )}
          </div>
        </form>
      )}
    </Card>
  );
}

function NumberField({
  label,
  value,
  defaultValue,
  min,
  onChange,
}: {
  label: string;
  value: number;
  defaultValue: number;
  min: number;
  onChange: (value: string) => void;
}) {
  return (
    <label className="text-sm text-ink-mute">
      {label}
      <Input
        type="number"
        min={min}
        step={1}
        value={Number.isFinite(value) ? value : ''}
        onChange={e => onChange(e.target.value)}
      />
      <span className="mt-1 block text-xs text-ink-faint">
        Env default: {defaultValue.toLocaleString()}
      </span>
    </label>
  );
}
