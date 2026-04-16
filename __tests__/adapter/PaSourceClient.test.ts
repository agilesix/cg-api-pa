import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PaApiError, PaSourceClient } from '../../src/adapter';
import { pdA1Fixture } from './fixtures';

describe('PaSourceClient', () => {
  const baseUrl = 'https://egrants-apibeta.azurewebsites.net/api/grants/';

  beforeEach(() => {
    vi.stubGlobal('fetch', vi.fn());
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  describe('getGrant', () => {
    it('fetches a single record by slug and parses it', async () => {
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch.mockResolvedValueOnce(
        new Response(JSON.stringify(pdA1Fixture), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        }),
      );

      const client = new PaSourceClient(baseUrl);
      const result = await client.getGrant('pda1');

      expect(result).toEqual(pdA1Fixture);
      expect(mockFetch).toHaveBeenCalledWith(
        'https://egrants-apibeta.azurewebsites.net/api/grants/pda1',
        expect.objectContaining({
          headers: expect.objectContaining({ accept: 'application/json' }),
        }),
      );
    });

    it('returns null on 404', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response('{"error":"not found"}', { status: 404 }),
      );
      const client = new PaSourceClient(baseUrl);
      expect(await client.getGrant('missing')).toBeNull();
    });

    it('throws PaApiError on other non-2xx responses', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response('server exploded', { status: 500 }),
      );
      const client = new PaSourceClient(baseUrl);
      await expect(client.getGrant('pda1')).rejects.toBeInstanceOf(PaApiError);
    });

    it('URL-encodes the slug', async () => {
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(pdA1Fixture), { status: 200 }));
      const client = new PaSourceClient('https://example.org/api/grants');
      await client.getGrant('weird slug/with slashes');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.org/api/grants/weird%20slug%2Fwith%20slashes',
        expect.any(Object),
      );
    });

    it('normalizes trailing slashes on the base URL', async () => {
      const mockFetch = vi.mocked(globalThis.fetch);
      mockFetch.mockResolvedValueOnce(new Response(JSON.stringify(pdA1Fixture), { status: 200 }));
      const client = new PaSourceClient('https://example.org/api/grants///');
      await client.getGrant('pda1');
      expect(mockFetch).toHaveBeenCalledWith(
        'https://example.org/api/grants/pda1',
        expect.any(Object),
      );
    });
  });

  describe('listAll', () => {
    it('yields every grant from the list-envelope response', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(
        new Response(JSON.stringify({ grants: [pdA1Fixture, { ...pdA1Fixture, slug: 'pda2' }] }), {
          status: 200,
        }),
      );

      const client = new PaSourceClient(baseUrl);
      const collected = [];
      for await (const g of client.listAll()) collected.push(g);

      expect(collected).toHaveLength(2);
      expect(collected[0]?.slug).toBe('pda1');
      expect(collected[1]?.slug).toBe('pda2');
    });

    it('throws PaApiError on non-2xx response', async () => {
      vi.mocked(globalThis.fetch).mockResolvedValueOnce(new Response('boom', { status: 503 }));
      const client = new PaSourceClient(baseUrl);
      const iter = client.listAll();
      await expect(iter.next()).rejects.toBeInstanceOf(PaApiError);
    });
  });
});
