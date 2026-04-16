import { vi } from 'vitest'

/**
 * Returns a chainable, awaitable mock for Drizzle ORM query builders.
 * The chain resolves to `data` when awaited.
 */
export function makeChain<T = unknown[]>(data: T = [] as unknown as T) {
  const chain: any = {
    from: vi.fn(),
    where: vi.fn(),
    orderBy: vi.fn(),
    limit: vi.fn(),
    groupBy: vi.fn(),
    values: vi.fn(),
    set: vi.fn(),
    returning: vi.fn(),
    onConflictDoUpdate: vi.fn(),
    // Thenable — makes the chain directly awaitable
    then: (resolve: (v: T) => unknown, reject?: (e: unknown) => unknown) =>
      Promise.resolve(data).then(resolve, reject),
    catch: (fn: (e: unknown) => unknown) => Promise.resolve(data).catch(fn),
    finally: (fn: () => void) => Promise.resolve(data).finally(fn),
  }
  Object.keys(chain).forEach((k) => {
    if (typeof chain[k] === 'function' && !['then', 'catch', 'finally'].includes(k)) {
      chain[k].mockReturnValue(chain)
    }
  })
  return chain
}
