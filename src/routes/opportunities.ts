import type { OpenAPIHono } from '@hono/zod-openapi';
import { createRoute, z } from '@hono/zod-openapi';
import {
  ErrorSchema,
  FilteredSchema,
  NotFoundSchema,
  OkSchema,
  OppFiltersSchema,
  OppSortingSchema,
  PaginatedBodyParamsSchema,
  PaginatedSchema,
} from '@common-grants/sdk/schemas';
import { PaOpportunitySchema } from '../adapter';
import type { OpportunityService } from '../services';

// =========================================================================
// List opportunities - GET /common-grants/opportunities
// =========================================================================

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1).openapi({ example: 1 }),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20).openapi({ example: 20 }),
});

const PaginatedOpportunitiesSchema = PaginatedSchema(PaOpportunitySchema);

const listRoute = createRoute({
  method: 'get',
  path: '/common-grants/opportunities',
  tags: ['Opportunities'],
  summary: 'List opportunities',
  description: 'Returns a paginated list of CommonGrants opportunities.',
  request: { query: ListQuerySchema },
  responses: {
    200: {
      description: 'Paginated list of opportunities',
      content: { 'application/json': { schema: PaginatedOpportunitiesSchema } },
    },
    500: {
      description: 'Internal server error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

function registerListRoute(app: OpenAPIHono, service: OpportunityService): void {
  app.openapi(listRoute, async (c) => {
    const { page, pageSize } = c.req.valid('query');
    const result = await service.list({ page, pageSize });

    const lastSync = await service.getLastSyncedAt();
    if (lastSync) c.header('X-Data-As-Of', lastSync);

    // `as never` on c.json is required because the SDK schemas use
    // `ZodEffects<string, unknown>` on a few fields, so z.output (what
    // zod-openapi's c.json signature infers) ≠ z.input (what the service
    // produces). The `satisfies` assertion above gives us compile-time
    // checking of the envelope shape, which is what we actually care about.
    const body = {
      status: 200 as const,
      message: 'OK',
      items: result.items,
      paginationInfo: result.paginationInfo,
    } satisfies z.input<typeof PaginatedOpportunitiesSchema>;
    return c.json(body as never, 200);
  });
}

// =========================================================================
// View opportunity details - GET /common-grants/opportunities/{oppId}
// =========================================================================

const OpportunityIdParamSchema = z.object({
  oppId: z.string().uuid().openapi({ example: '00000000-0000-5000-8000-000000000001' }),
});

const GetOneOkSchema = OkSchema(PaOpportunitySchema);

const getOneRoute = createRoute({
  method: 'get',
  path: '/common-grants/opportunities/{oppId}',
  tags: ['Opportunities'],
  summary: 'Get an opportunity by id',
  description: 'Returns a single opportunity by its CommonGrants UUID, or 404.',
  request: { params: OpportunityIdParamSchema },
  responses: {
    200: {
      description: 'Opportunity found',
      content: { 'application/json': { schema: GetOneOkSchema } },
    },
    404: {
      description: 'Opportunity not found',
      content: { 'application/json': { schema: NotFoundSchema } },
    },
  },
});

function registerGetOneRoute(app: OpenAPIHono, service: OpportunityService): void {
  app.openapi(getOneRoute, async (c) => {
    const { oppId } = c.req.valid('param');
    const opp = await service.getById(oppId);

    const lastSync = await service.getLastSyncedAt();
    if (lastSync) c.header('X-Data-As-Of', lastSync);

    if (!opp) {
      const notFound = {
        status: 404 as const,
        message: 'Opportunity not found',
        errors: [],
      } satisfies z.input<typeof NotFoundSchema>;
      return c.json(notFound, 404);
    }
    const body = {
      status: 200 as const,
      message: 'OK',
      data: opp,
    } satisfies z.input<typeof GetOneOkSchema>;
    return c.json(body as never, 200);
  });
}

// =========================================================================
// Search opportunities - POST /common-grants/opportunities/search
// =========================================================================

/** Request body for POST /common-grants/opportunities/search. */
const OppSearchRequestSchema = z
  .object({
    search: z.string().optional().openapi({ example: 'agriculture' }),
    filters: OppFiltersSchema.optional(),
    sorting: OppSortingSchema.optional(),
    pagination: PaginatedBodyParamsSchema.optional(),
  })
  .openapi('OppSearchRequest');

const FilteredOpportunitiesSchema = FilteredSchema(PaOpportunitySchema, OppFiltersSchema);

const searchRoute = createRoute({
  method: 'post',
  path: '/common-grants/opportunities/search',
  tags: ['Opportunities'],
  summary: 'Search opportunities',
  description:
    'Search opportunities with full-text query, structured filters (status, closeDateRange, etc.), sorting, and pagination. Follows the CommonGrants `OppSearchRequest` shape.',
  request: {
    body: {
      required: true,
      content: { 'application/json': { schema: OppSearchRequestSchema } },
    },
  },
  responses: {
    200: {
      description: 'Filtered, sorted, paginated list of opportunities',
      content: { 'application/json': { schema: FilteredOpportunitiesSchema } },
    },
    400: {
      description: 'Bad request — invalid filters or pagination',
      content: { 'application/json': { schema: ErrorSchema } },
    },
    500: {
      description: 'Internal server error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

function registerSearchRoute(app: OpenAPIHono, service: OpportunityService): void {
  app.openapi(searchRoute, async (c) => {
    // SDK types from zod-openapi include nullable sortOrder; the service
    // accepts this shape directly. Cast only to bridge the zod-output vs
    // service-input type mismatch (nullable vs undefined).
    const body = c.req.valid('json');
    const result = await service.search({
      search: body.search,
      filters: body.filters,
      sorting: body.sorting ?? undefined,
      pagination: body.pagination,
    });

    const lastSync = await service.getLastSyncedAt();
    if (lastSync) c.header('X-Data-As-Of', lastSync);

    const responseBody = {
      status: 200 as const,
      message: 'OK',
      items: result.items,
      paginationInfo: result.paginationInfo,
      filterInfo: result.filterInfo,
      sortInfo: result.sortInfo,
    } satisfies z.input<typeof FilteredOpportunitiesSchema>;
    return c.json(responseBody as never, 200);
  });
}

// =========================================================================
// Public entry point
// =========================================================================

/**
 * Register the `/common-grants/opportunities{,/:oppId,/search}` routes on the
 * given OpenAPIHono app. The service is injected rather than created so the
 * same routes work for every deployment tier.
 */
export function registerOpportunityRoutes(
  app: OpenAPIHono,
  service: OpportunityService,
): OpenAPIHono {
  registerListRoute(app, service);
  registerGetOneRoute(app, service);
  registerSearchRoute(app, service);
  return app;
}
