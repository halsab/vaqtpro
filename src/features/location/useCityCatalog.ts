import { useCallback, useRef, useState } from 'react'

import type { CityCatalogService } from '../../data/cityCatalog'

export type CityCatalogStatus = 'idle' | 'loading' | 'ready' | 'offline' | 'error'

interface CityCatalogServices {
  cities: CityCatalogService
}

export function useCityCatalog(services: CityCatalogServices) {
  const [cityCatalogStatus, setCityCatalogStatus] = useState<CityCatalogStatus>('idle')
  const status = useRef(cityCatalogStatus)
  const cityCatalogLoad = useRef<Promise<void> | null>(null)
  const loadRevision = useRef(0)

  const updateStatus = useCallback((next: CityCatalogStatus) => {
    status.current = next
    setCityCatalogStatus(next)
  }, [])

  const loadCities = useCallback((retry = false) => {
    if (retry) {
      loadRevision.current += 1
      services.cities.cancelPending?.()
      cityCatalogLoad.current = null
      updateStatus('idle')
    }
    if (status.current === 'ready' || cityCatalogLoad.current) return

    const revision = loadRevision.current
    updateStatus('loading')
    const load = services.cities.load().then((result) => {
      if (revision !== loadRevision.current) return
      if (result.ok) {
        updateStatus('ready')
        return
      }
      updateStatus(result.error.reason === 'offline' ? 'offline' : 'error')
    }).catch(() => {
      if (revision === loadRevision.current) updateStatus('error')
    })
    const trackedLoad = load.finally(() => {
      if (revision === loadRevision.current && cityCatalogLoad.current === trackedLoad) cityCatalogLoad.current = null
    })
    cityCatalogLoad.current = trackedLoad
  }, [services, updateStatus])

  return { cityCatalogStatus, loadCities }
}
