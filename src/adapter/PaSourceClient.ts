import type { ISourceClient } from '../core';
import { PaGrantSchema, PaGrantsListResponseSchema, type PaGrant } from './paSource';

/**
 * Typed error thrown by `PaSourceClient` when the upstream returns a non-OK
 * status code. Exposes both the HTTP status and the raw response body so
 * callers can distinguish between transient (5xx) and permanent (4xx)
 * failures.
 */
export class PaApiError extends Error {
  readonly status: number;
  readonly body: string;

  constructor(status: number, body: string) {
    super(`PA API returned ${status}: ${body.slice(0, 200)}`);
    this.name = 'PaApiError';
    this.status = status;
    this.body = body;
  }
}

/**
 * HTTP client for the Pennsylvania eGrants Beta API.
 *
 * The upstream shape (as of 2026-04):
 *
 *   - `GET /` returns `{ grants: PaGrant[] }` — the **entire** dataset in a
 *     single ~1 MB JSON response. No pagination, no filtering, no search.
 *     We rely on the local repository to provide those semantics.
 *   - `GET /{slug}` returns a single PaGrant or 404.
 *   - No auth, no rate limiting observed.
 *
 * Implements {@link ISourceClient} so the ETL and the proxy repository can
 * consume it without knowing it's PA-specific.
 */
export class PaSourceClient implements ISourceClient<PaGrant> {
  private readonly baseUrl: string;

  constructor(baseUrl: string) {
    // Normalize to no trailing slash so we can uniformly append `/{slug}`.
    this.baseUrl = baseUrl.replace(/\/+$/, '');
  }

  async getGrant(slug: string): Promise<PaGrant | null> {
    const url = `${this.baseUrl}/${encodeURIComponent(slug)}`;
    const res = await fetch(url, { headers: { accept: 'application/json' } });
    if (res.status === 404) return null;
    if (!res.ok) throw new PaApiError(res.status, await res.text());
    const json = (await res.json()) as unknown;
    return PaGrantSchema.parse(json);
  }

  async *listAll(): AsyncGenerator<PaGrant> {
    const res = await fetch(`${this.baseUrl}/`, { headers: { accept: 'application/json' } });
    if (!res.ok) throw new PaApiError(res.status, await res.text());
    const json = (await res.json()) as unknown;
    const body = PaGrantsListResponseSchema.parse(json);
    for (const grant of body.grants) yield grant;
  }
}
