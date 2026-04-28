import { describe, it, expect } from 'vitest';
import { createApp } from '../src/app';
import { OpportunityService } from '../src/services';
import type {
  AppConfig,
  // re-export not available; use local type from deps module instead.
} from '../src/cg.config';
import type {
  IOppRepo,
  OpportunitySearchParams,
  PaginatedResult,
  StoredOpportunity,
  SyncStats,
} from '../src/core';
import { paGrantToOpportunity, buildStoredOpportunity } from '../src/adapter';
import { pdA1Fixture } from './adapter/fixtures';

// -------------------------------------------------------------------------
// Fake repository — minimal, adapter-agnostic, reused across route tests.
// -------------------------------------------------------------------------

class FakeRepo implements IOppRepo {
  readonly rows = new Map<string, StoredOpportunity>();
  private lastSync: string | null = null;

  constructor(rows: StoredOpportunity[] = []) {
    for (const r of rows) this.rows.set(r.id, r);
  }

  async findById(id: string) {
    return this.rows.get(id) ?? null;
  }
  async findBySourceId(sourceId: string) {
    for (const row of this.rows.values()) if (row.sourceId === sourceId) return row;
    return null;
  }
  async search(params: OpportunitySearchParams): Promise<PaginatedResult<StoredOpportunity>> {
    const all = [...this.rows.values()];
    const start = (params.pagination.page - 1) * params.pagination.pageSize;
    return {
      items: all.slice(start, start + params.pagination.pageSize),
      total: all.length,
    };
  }
  async upsert(record: StoredOpportunity) {
    this.rows.set(record.id, record);
  }
  async getLastSyncedAt() {
    return this.lastSync;
  }
  async logSyncStart() {
    return 0;
  }
  async logSyncComplete(_id: number, stats: SyncStats) {
    this.lastSync = stats.completedAt;
  }
}

function buildDeps(overrides: Partial<AppConfig> = {}): AppConfig {
  const opp = paGrantToOpportunity(pdA1Fixture, '2026-04-15T00:00:00Z');
  const row = buildStoredOpportunity(pdA1Fixture, opp, 'hash-1');
  const repo = overrides.repo ?? new FakeRepo([row]);
  return {
    repo,
    snapshots: { put: async () => {} },
    service: new OpportunityService(repo),
    sync: overrides.sync,
    syncSecret: overrides.syncSecret ?? 'test-secret',
    logger: { info: () => {}, warn: () => {}, error: () => {} },
    version: '0.1.0-test',
    ...overrides,
  };
}

// -------------------------------------------------------------------------
// Tests
// -------------------------------------------------------------------------

describe('GET /health', () => {
  it('returns service status and the last-sync timestamp', async () => {
    const deps = buildDeps();
    const res = await createApp(deps).request('/health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { status: string; service: string; version: string };
    expect(body.status).toBe('ok');
    expect(body.service).toBe('pa-commongrants-api');
    expect(body.version).toBe('0.1.0-test');
  });
});

describe('GET /common-grants/opportunities', () => {
  it('returns a paginated envelope', async () => {
    const deps = buildDeps();
    const res = await createApp(deps).request('/common-grants/opportunities?page=1&pageSize=10');
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: unknown[];
      paginationInfo: { page: number; pageSize: number; totalItems: number; totalPages: number };
    };
    expect(body.items).toHaveLength(1);
    expect(body.paginationInfo).toEqual({
      page: 1,
      pageSize: 10,
      totalItems: 1,
      totalPages: 1,
    });
  });

  it('rejects a pageSize above the documented max', async () => {
    const deps = buildDeps();
    const res = await createApp(deps).request('/common-grants/opportunities?pageSize=200');
    expect(res.status).toBe(400);
  });
});

describe('GET /common-grants/opportunities/:id', () => {
  it('returns the opportunity when it exists', async () => {
    const deps = buildDeps();
    const row = [...(deps.repo as FakeRepo).rows.values()][0]!;
    const res = await createApp(deps).request(`/common-grants/opportunities/${row.id}`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      status: number;
      message: string;
      data: { id: string; title: string };
    };
    expect(body.status).toBe(200);
    expect(body.data.id).toBe(row.id);
    expect(body.data.title).toBe('4-H Reimbursement');
  });

  it('returns 404 when not found', async () => {
    const deps = buildDeps();
    const res = await createApp(deps).request(
      '/common-grants/opportunities/00000000-0000-5000-8000-000000000099',
    );
    expect(res.status).toBe(404);
    const body = (await res.json()) as { status: number; message: string };
    expect(body.status).toBe(404);
  });

  it('rejects a malformed id', async () => {
    const deps = buildDeps();
    const res = await createApp(deps).request('/common-grants/opportunities/not-a-uuid');
    expect(res.status).toBe(400);
  });
});

describe('POST /common-grants/opportunities/search', () => {
  it('accepts a structured OppSearchRequest body and returns a filtered envelope', async () => {
    const deps = buildDeps();
    const res = await createApp(deps).request('/common-grants/opportunities/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        search: 'reimbursement',
        filters: { status: { operator: 'in', value: ['open'] } },
        pagination: { page: 1, pageSize: 10 },
        sorting: { sortBy: 'keyDates.closeDate', sortOrder: 'asc' },
      }),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      items: unknown[];
      paginationInfo: { totalItems: number };
      filterInfo: { filters: { status: { operator: string; value: string[] } } };
      sortInfo: { sortBy: string; sortOrder: string };
    };
    // The fake repo ignores filters, so it returns the only seeded row.
    expect(body.items).toHaveLength(1);
    expect(body.filterInfo.filters.status.value).toEqual(['open']);
    expect(body.sortInfo.sortBy).toBe('keyDates.closeDate');
  });

  it('accepts an empty body and falls back to defaults', async () => {
    const deps = buildDeps();
    const res = await createApp(deps).request('/common-grants/opportunities/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({}),
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as {
      paginationInfo: { page: number; pageSize: number };
    };
    expect(body.paginationInfo.page).toBe(1);
    expect(body.paginationInfo.pageSize).toBe(20);
  });

  it('rejects a malformed filters shape', async () => {
    const deps = buildDeps();
    const res = await createApp(deps).request('/common-grants/opportunities/search', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        filters: { status: { operator: 'in', value: 'not-an-array' } },
      }),
    });
    expect(res.status).toBe(400);
  });
});

describe('POST /admin/sync', () => {
  it('returns 401 without a Bearer token', async () => {
    const deps = buildDeps({ sync: async () => fakeStats() });
    const res = await createApp(deps).request('/admin/sync', { method: 'POST' });
    expect(res.status).toBe(401);
  });

  it('returns 401 with a wrong Bearer token', async () => {
    const deps = buildDeps({ sync: async () => fakeStats() });
    const res = await createApp(deps).request('/admin/sync', {
      method: 'POST',
      headers: { authorization: 'Bearer wrong' },
    });
    expect(res.status).toBe(401);
  });

  it('runs sync and returns stats with the correct Bearer token', async () => {
    const deps = buildDeps({ sync: async () => fakeStats() });
    const res = await createApp(deps).request('/admin/sync', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
    });
    expect(res.status).toBe(200);
    const body = (await res.json()) as SyncStats;
    expect(body.recordsInserted).toBe(42);
  });

  it('is not registered at all when deps.sync is undefined (proxy tier)', async () => {
    const deps = buildDeps({ sync: undefined });
    const res = await createApp(deps).request('/admin/sync', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
    });
    expect(res.status).toBe(404);
  });

  it('forwards ?force=true to the bound sync function', async () => {
    let captured: { force?: boolean } | undefined;
    const deps = buildDeps({
      sync: async (opts) => {
        captured = opts;
        return fakeStats();
      },
    });
    const res = await createApp(deps).request('/admin/sync?force=true', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
    });
    expect(res.status).toBe(200);
    expect(captured).toEqual({ force: true });
  });

  it('defaults to force=false when no query param is present', async () => {
    let captured: { force?: boolean } | undefined;
    const deps = buildDeps({
      sync: async (opts) => {
        captured = opts;
        return fakeStats();
      },
    });
    const res = await createApp(deps).request('/admin/sync', {
      method: 'POST',
      headers: { authorization: 'Bearer test-secret' },
    });
    expect(res.status).toBe(200);
    expect(captured).toEqual({ force: false });
  });
});

describe('GET /openapi.json', () => {
  it('serves an auto-generated OpenAPI 3.1 spec with the registered routes', async () => {
    const deps = buildDeps({ sync: async () => fakeStats() });
    const res = await createApp(deps).request('/openapi.json');
    expect(res.status).toBe(200);
    const spec = (await res.json()) as {
      openapi: string;
      info: { title: string; version: string };
      paths: Record<string, unknown>;
    };
    expect(spec.openapi).toMatch(/^3\.1/);
    expect(spec.info.title).toBe('PA CommonGrants API');
    expect(spec.paths['/common-grants/opportunities']).toBeDefined();
    expect(spec.paths['/common-grants/opportunities/{oppId}']).toBeDefined();
    expect(spec.paths['/admin/sync']).toBeDefined();
    expect(spec.paths['/health']).toBeDefined();
  });
});

describe('GET /docs', () => {
  it('serves HTML that loads the Scalar reference UI', async () => {
    const deps = buildDeps();
    const res = await createApp(deps).request('/docs');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type') ?? '').toMatch(/html/);
    const html = await res.text();
    expect(html).toContain('api-reference');
    expect(html).toContain('/openapi.json');
  });
});

// -------------------------------------------------------------------------
// Helpers
// -------------------------------------------------------------------------

function fakeStats(): SyncStats {
  return {
    startedAt: '2026-04-15T00:00:00Z',
    completedAt: '2026-04-15T00:00:05Z',
    recordsFetched: 42,
    recordsInserted: 42,
    recordsUpdated: 0,
    recordsSkipped: 0,
    errorMessage: null,
  };
}
