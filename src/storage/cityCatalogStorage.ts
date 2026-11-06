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
  cleanup ??= new Promise((resolve, reject) => {
    let request: DeleteRequestLike
    try {
      request = factory.deleteDatabase(databaseName)
    } catch {
      cleanup = undefined
      reject(new Error('Legacy catalog cleanup failed'))
      return
    }
    request.onsuccess = () => resolve()
    const retry = () => {
      cleanup = undefined
      reject(new Error('Legacy catalog cleanup blocked or failed'))
    }
    request.onerror = retry
    request.onblocked = retry
  })
  return cleanup
}
