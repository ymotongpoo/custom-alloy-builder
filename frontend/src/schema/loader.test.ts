import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearSchemaCacheForTests, loadComponentSchema, loadSchemaIndex } from './loader'

afterEach(() => {
  vi.restoreAllMocks()
  clearSchemaCacheForTests()
})

describe('schema loader', () => {
  it('loads index and component schemas from BASE_URL schema paths', async () => {
    const fetchMock = vi.fn((url: string) =>
      Promise.resolve({
        ok: true,
        json: () =>
          Promise.resolve(
            url.endsWith('index.json')
              ? { version: 'v1.17.1', components: [] }
              : { name: 'prometheus.scrape', arguments: {} },
          ),
      }),
    )
    vi.stubGlobal('fetch', fetchMock)

    await expect(loadSchemaIndex()).resolves.toMatchObject({ version: 'v1.17.1' })
    await expect(loadComponentSchema('prometheus.scrape')).resolves.toMatchObject({ name: 'prometheus.scrape' })
    await loadComponentSchema('prometheus.scrape')

    expect(fetchMock).toHaveBeenCalledTimes(2)
    expect(fetchMock.mock.calls[0]?.[0]).toContain('/schemas/v1.17.1/index.json')
    expect(fetchMock.mock.calls[1]?.[0]).toContain('/schemas/v1.17.1/components/prometheus.scrape.json')
  })
})
