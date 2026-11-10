import { act, fireEvent, render, screen } from '@testing-library/react'
import { StrictMode } from 'react'
import { afterEach, describe, expect, it, vi } from 'vitest'

type MockGate = {
  supported: boolean
  hasError: () => boolean
  start: () => Promise<boolean>
  requestOwnership: () => Promise<boolean>
  close: () => void
  relinquish: () => Promise<void>
  onTakeover: (callback: () => Promise<void>) => void
}

const mocks = vi.hoisted(() => ({ gate: null as MockGate | null,
  createGate: vi.fn<() => MockGate | null>(), app: vi.fn() }))

vi.mock('../App', () => ({ App: () => { mocks.app(); return <div data-testid="app" /> } }))
vi.mock('./executionGate', () => ({
  createExecutionGate: () => mocks.createGate() ?? mocks.gate,
  waitForExecutionQuiescence: () => Promise.resolve(),
}))

import { ExecutionGateView } from './ExecutionGateView'

function deferred<T>() {
  let resolve!: (value?: T) => void
  let reject!: (reason?: unknown) => void
  const promise = new Promise<T>((done, fail) => { resolve = value => done(value as T); reject = fail })
  return { promise, resolve, reject }
}

function createGate(start: Promise<boolean>) {
  return {
    supported: true,
    hasError: () => false,
    start: vi.fn(() => start),
    requestOwnership: vi.fn().mockResolvedValue(false),
    close: vi.fn(),
    relinquish: vi.fn().mockResolvedValue(undefined),
    onTakeover: vi.fn(),
  }
}

afterEach(() => {
  mocks.gate = null
  mocks.createGate.mockReset()
  mocks.app.mockClear()
  document.documentElement.removeAttribute('style')
  document.documentElement.removeAttribute('data-theme')
  document.documentElement.removeAttribute('data-theme-tone')
  document.documentElement.removeAttribute('data-season')
})

describe('execution gate presentation', () => {
  it('starts the only tab under StrictMode while cancelled lock requests are still queued', async () => {
    const actual = await vi.importActual<typeof import('./executionGate')>('./executionGate')
    let reserved = false
    const locks = {
      request: vi.fn(async (_name: string, _options: LockOptions, callback: (lock: Lock | null) => Promise<void>) => {
        const available = !reserved
        if (available) reserved = true
        await Promise.resolve()
        try { await callback(available ? { name: _name, mode: 'exclusive' } : null) }
        finally { if (available) reserved = false }
      }),
    }
    const previousLocks = Object.getOwnPropertyDescriptor(navigator, 'locks')
    Object.defineProperty(navigator, 'locks', { configurable: true, value: locks })
    vi.stubGlobal('BroadcastChannel', class {
      onmessage = null
      close() {}
      postMessage() {}
    })
    mocks.createGate.mockImplementation(actual.createExecutionGate)
    const view = render(<StrictMode><ExecutionGateView /></StrictMode>)

    try {
      expect(await screen.findByTestId('app')).toBeInTheDocument()
      expect(screen.queryByRole('heading', { name: 'Приложение уже открыто' })).not.toBeInTheDocument()
    } finally {
      view.unmount()
      if (previousLocks) Object.defineProperty(navigator, 'locks', previousLocks)
      else Reflect.deleteProperty(navigator, 'locks')
      vi.unstubAllGlobals()
    }
  })

  it('uses a fresh controller across consecutive BFCache lifecycle cycles', async () => {
    const first = createGate(Promise.resolve(true))
    const second = createGate(Promise.resolve(true))
    const third = createGate(Promise.resolve(true))
    mocks.createGate.mockReset().mockReturnValueOnce(first).mockReturnValueOnce(second).mockReturnValueOnce(third)
    render(<ExecutionGateView />)
    expect(await screen.findByTestId('app')).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      await Promise.resolve()
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      await Promise.resolve()
    })
    expect(await screen.findByTestId('app')).toBeInTheDocument()
    expect(first.relinquish).toHaveBeenCalledOnce()
    expect(first.close).toHaveBeenCalledOnce()

    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      await Promise.resolve()
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      await Promise.resolve()
    })
    expect(await screen.findByTestId('app')).toBeInTheDocument()
    expect(second.relinquish).toHaveBeenCalledOnce()
    expect(second.close).toHaveBeenCalledOnce()
    expect(mocks.createGate).toHaveBeenCalledTimes(3)
  })












  it('keeps App unmounted and actions retryable after ownership request failures', async () => {
    const gate = createGate(Promise.resolve(false))
    gate.requestOwnership = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true)
    mocks.gate = gate
    render(<ExecutionGateView />)

    const action = await screen.findByRole('button', { name: 'Продолжить здесь' })
    expect(screen.queryByTestId('app')).not.toBeInTheDocument()
    fireEvent.click(action)
    expect(await screen.findByRole('alert')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeEnabled()
    expect(screen.queryByTestId('app')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Попробовать снова' }))
    expect(await screen.findByTestId('app')).toBeInTheDocument()
    expect(gate.requestOwnership).toHaveBeenCalledTimes(2)
  })

  it('never mounts App when coordination APIs are unsupported', async () => {
    const gate = createGate(Promise.resolve(false))
    gate.supported = false
    gate.hasError = () => true
    gate.requestOwnership = vi.fn().mockResolvedValue(false)
    mocks.gate = gate
    render(<ExecutionGateView />)

    expect(await screen.findByText('Для безопасной работы требуется поддержка блокировки вкладок. Повторите попытку.')).toBeVisible()
    expect(screen.queryByTestId('app')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeEnabled()
  })

})
