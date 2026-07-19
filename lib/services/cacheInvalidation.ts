import { bustCache } from '@/lib/util/cache';

export const METRICS_CACHE_KEY = 'controller:metrics';

export function bustMetricsCache(): void {
  bustCache(METRICS_CACHE_KEY);
}
