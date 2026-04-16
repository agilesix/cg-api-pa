import type { IOppRepo, OpportunitySearchParams, OppFilters, OppSorting } from '../core';
import type { PaOpportunityInput } from '../adapter';

export interface PaginationInfo {
  page: number;
  pageSize: number;
  totalItems: number;
  totalPages: number;
}

export interface SearchResult {
  items: PaOpportunityInput[];
  paginationInfo: PaginationInfo;
  filterInfo: { filters: OppFilters | undefined };
  sortInfo: { sortBy: string; sortOrder: 'asc' | 'desc' };
}

const DEFAULT_PAGE = 1;
const DEFAULT_PAGE_SIZE = 20;
const MAX_PAGE_SIZE = 100;

/**
 * The service layer sits between HTTP routes and the repository.
 *
 * Responsibilities:
 *   - Enforce pagination defaults and limits.
 *   - Pass SDK-native filters and sorting through to the repository as-is.
 *   - Deserialize `rawJson` back into the typed `PaOpportunityInput` shape.
 *   - Package results into CG-protocol response envelopes.
 */
export class OpportunityService {
  constructor(private readonly repo: IOppRepo) {}

  private normalizePagination(page?: number | null, pageSize?: number | null) {
    return {
      page: Math.max(1, Math.floor(page ?? DEFAULT_PAGE)),
      pageSize: Math.min(MAX_PAGE_SIZE, Math.max(1, Math.floor(pageSize ?? DEFAULT_PAGE_SIZE))),
    };
  }

  private toItems(rows: { rawJson: string }[]): PaOpportunityInput[] {
    return rows.map((row) => JSON.parse(row.rawJson) as PaOpportunityInput);
  }

  /**
   * GET /common-grants/opportunities — simple paginated list, no filters.
   */
  async list(params: { page?: number; pageSize?: number }) {
    const pagination = this.normalizePagination(params.page, params.pageSize);
    const { items, total } = await this.repo.search({ pagination });
    return {
      items: this.toItems(items),
      paginationInfo: {
        ...pagination,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
      },
    };
  }

  /**
   * POST /common-grants/opportunities/search — structured CG search body.
   * Passes SDK-native filters and sorting straight through to the repo.
   */
  async search(body: {
    search?: string;
    filters?: OppFilters;
    sorting?: OppSorting;
    pagination?: { page?: number | null; pageSize?: number | null } | null;
  }): Promise<SearchResult> {
    const pagination = this.normalizePagination(body.pagination?.page, body.pagination?.pageSize);
    const searchParams: OpportunitySearchParams = {
      pagination,
      query: body.search,
      filters: body.filters,
      sorting: body.sorting,
    };
    const { items, total } = await this.repo.search(searchParams);
    return {
      items: this.toItems(items),
      paginationInfo: {
        ...pagination,
        totalItems: total,
        totalPages: Math.max(1, Math.ceil(total / pagination.pageSize)),
      },
      filterInfo: { filters: body.filters },
      sortInfo: {
        sortBy: body.sorting?.sortBy ?? 'keyDates.closeDate',
        sortOrder: body.sorting?.sortOrder ?? 'asc',
      },
    };
  }

  async getById(id: string): Promise<PaOpportunityInput | null> {
    const row = await this.repo.findById(id);
    if (!row) return null;
    return JSON.parse(row.rawJson) as PaOpportunityInput;
  }

  async getLastSyncedAt(): Promise<string | null> {
    return this.repo.getLastSyncedAt();
  }
}
