const databaseName = 'salah-city-catalog'
let cleanup: Promise<void> | undefined

interface DeleteRequestLike {
  onsuccess: (() => void) | null
  onerror: (() => void) | null
  onblocked: (() => void) | null
}

interface IndexedDBFactoryLike {
  deleteDatabase(name: string): DeleteRequestLike
}

export function clearLegacyCatalogStorage(): Promise<void> {
  const factory = Reflect.get(globalThis, 'indexedDB') as IndexedDBFactoryLike | undefined
  if (!factory) return Promise.resolve()
  cleanup ??= new Promise(resolve => {
    const request = factory.deleteDatabase(databaseName)
    const finish = () => resolve()
    request.onsuccess = finish
    request.onerror = finish
    request.onblocked = finish
  })
  return cleanup
}
