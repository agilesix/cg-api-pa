import type { OpenAPIHono } from '@hono/zod-openapi';
import { createRoute, z } from '@hono/zod-openapi';
import {
  ErrorSchema,
  FilteredSchema,
  NotFoundSchema,
  OppFiltersSchema,
  OppSortingSchema,
  PaginatedBodyParamsSchema,
  PaginatedSchema,
} from '@common-grants/sdk/schemas';
import { PaOpportunitySchema } from '../adapter';
import type { OpportunityService } from '../services';

const PaginatedOpportunitiesSchema = PaginatedSchema(PaOpportunitySchema);
const FilteredOpportunitiesSchema = FilteredSchema(PaOpportunitySchema, OppFiltersSchema);

/** Request body for POST /common-grants/opportunities/search. */
const OppSearchRequestSchema = z
  .object({
    search: z.string().optional().openapi({ example: 'agriculture' }),
    filters: OppFiltersSchema.optional(),
    sorting: OppSortingSchema.optional(),
    pagination: PaginatedBodyParamsSchema.optional(),
  })
  .openapi('OppSearchRequest');

const ListQuerySchema = z.object({
  page: z.coerce.number().int().min(1).optional().default(1).openapi({ example: 1 }),
  pageSize: z.coerce.number().int().min(1).max(100).optional().default(20).openapi({ example: 20 }),
});

const OpportunityIdParamSchema = z.object({
  id: z.string().uuid().openapi({ example: '00000000-0000-5000-8000-000000000001' }),
});

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
      content: {
        'application/json': { schema: PaginatedOpportunitiesSchema },
      },
    },
    500: {
      description: 'Internal server error',
      content: { 'application/json': { schema: ErrorSchema } },
    },
  },
});

const getOneRoute = createRoute({
  method: 'get',
  path: '/common-grants/opportunities/{id}',
  tags: ['Opportunities'],
  summary: 'Get an opportunity by id',
  description: 'Returns a single opportunity by its CommonGrants UUID, or 404.',
  request: { params: OpportunityIdParamSchema },
  responses: {
    200: {
      description: 'Opportunity found',
      content: { 'application/json': { schema: PaOpportunitySchema } },
    },
    404: {
      description: 'Opportunity not found',
      content: { 'application/json': { schema: NotFoundSchema } },
    },
  },
});

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

/**
 * Register the `/common-grants/opportunities{,/:id}` routes on the given
 * OpenAPIHono app. The service is injected rather than created so the
 * same routes work for every deployment tier.
 */
export function registerOpportunityRoutes(
  app: OpenAPIHono,
  service: OpportunityService,
): OpenAPIHono {
  app.openapi(listRoute, async (c) => {
    const { page, pageSize } = c.req.valid('query');
    const result = await service.list({ page, pageSize });

    const lastSync = await service.getLastSyncedAt();
    if (lastSync) c.header('X-Data-As-Of', lastSync);

    // Response body type from zod-openapi uses the parsed (output) shape;
    // our service returns the input shape. Both serialize to the same JSON,
    // so cast to keep Hono's type machinery happy without an extra parse.
    return c.json(
      {
        status: 200,
        message: 'OK',
        items: result.items,
        paginationInfo: result.paginationInfo,
      } as never,
      200,
    );
  });

  app.openapi(getOneRoute, async (c) => {
    const { id } = c.req.valid('param');
    const opp = await service.getById(id);

    const lastSync = await service.getLastSyncedAt();
    if (lastSync) c.header('X-Data-As-Of', lastSync);

    if (!opp) {
      return c.json(
        {
          status: 404 as const,
          message: 'Opportunity not found',
          errors: [],
        },
        404,
      );
    }
    return c.json(opp as never, 200);
  });

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

    return c.json(
      {
        status: 200,
        message: 'OK',
        items: result.items,
        paginationInfo: result.paginationInfo,
        filterInfo: result.filterInfo,
        sortInfo: result.sortInfo,
      } as never,
      200,
    );
  });

  return app;
}
