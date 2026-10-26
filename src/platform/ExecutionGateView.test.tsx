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

  it('updates a blocked screen to the default family after the owner removes its theme cache', async () => {
    const values = new Map<string, string>([['salah-theme-preference-v1', JSON.stringify({ version: 1, themeFamily: 'seasonal' })]])
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => { values.set(key, value) },
      removeItem: (key: string) => { values.delete(key) },
    }
    vi.stubGlobal('localStorage', storage)
    mocks.gate = createGate(Promise.resolve(false))
    render(<ExecutionGateView />)
    expect(await screen.findByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
    expect(document.documentElement.dataset.theme).toBe('seasonal')

    storage.removeItem('salah-theme-preference-v1')
    act(() => {
      window.dispatchEvent(new StorageEvent('storage', { key: 'salah-theme-preference-v1', newValue: null }))
    })

    expect(document.documentElement.dataset.theme).toBe('seasonal')
    expect(storage.getItem('salah-theme-preference-v1')).toBeNull()
  })

  it('ignores initial ownership completion after a BFCache controller replacement', async () => {
    const lateStart = deferred<boolean>()
    const first = createGate(lateStart.promise)
    const replacement = createGate(Promise.resolve(false))
    mocks.createGate.mockReset().mockReturnValueOnce(first).mockReturnValueOnce(replacement)
    render(<ExecutionGateView />)

    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      await Promise.resolve()
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      await Promise.resolve()
    })
    expect(await screen.findByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
    await act(async () => { lateStart.resolve(true); await lateStart.promise })
    expect(screen.queryByTestId('app')).not.toBeInTheDocument()
  })

  it('ignores a takeover result from a controller replaced while the request is pending', async () => {
    const request = deferred<boolean>()
    const previous = createGate(Promise.resolve(false))
    previous.requestOwnership = vi.fn(() => request.promise)
    const restored = createGate(Promise.resolve(false))
    mocks.createGate.mockReset().mockReturnValueOnce(previous).mockReturnValueOnce(restored)
    render(<ExecutionGateView />)

    fireEvent.click(await screen.findByRole('button', { name: 'Продолжить здесь' }))
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      await Promise.resolve()
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      await Promise.resolve()
    })
    expect(await screen.findByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
    await act(async () => { request.resolve(true); await request.promise })
    expect(screen.queryByTestId('app')).not.toBeInTheDocument()
  })

  it('keeps takeover available when a successful old request completes after lifecycle replacement', async () => {
    const oldRequest = deferred<boolean>()
    const previous = createGate(Promise.resolve(false))
    previous.requestOwnership = vi.fn(() => oldRequest.promise)
    const restored = createGate(Promise.resolve(false))
    restored.requestOwnership = vi.fn().mockResolvedValue(true)
    mocks.createGate.mockReset().mockReturnValueOnce(previous).mockReturnValueOnce(restored)
    render(<ExecutionGateView />)

    fireEvent.click(await screen.findByRole('button', { name: 'Продолжить здесь' }))
    expect(screen.getByRole('button', { name: 'Переключаем…' })).toBeDisabled()
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      await Promise.resolve()
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      await Promise.resolve()
    })
    const restoredButton = await screen.findByRole('button', { name: 'Продолжить здесь' })
    expect(restoredButton).toBeEnabled()

    await act(async () => { oldRequest.resolve(true); await oldRequest.promise })
    expect(screen.queryByTestId('app')).not.toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
    expect(restoredButton).toBeEnabled()

    fireEvent.click(restoredButton)
    expect(await screen.findByTestId('app')).toBeInTheDocument()
    expect(restored.requestOwnership).toHaveBeenCalledOnce()
    expect(mocks.app).toHaveBeenCalledOnce()
  })

  it('does not apply an old failed request state to the replacement controller', async () => {
    const oldRequest = deferred<boolean>()
    const previous = createGate(Promise.resolve(false))
    previous.requestOwnership = vi.fn(() => oldRequest.promise)
    let previousHasError = false
    previous.hasError = () => previousHasError
    const restored = createGate(Promise.resolve(false))
    restored.requestOwnership = vi.fn().mockResolvedValue(true)
    mocks.createGate.mockReset().mockReturnValueOnce(previous).mockReturnValueOnce(restored)
    render(<ExecutionGateView />)

    fireEvent.click(await screen.findByRole('button', { name: 'Продолжить здесь' }))
    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      await Promise.resolve()
      window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true }))
      await Promise.resolve()
    })
    const restoredButton = await screen.findByRole('button', { name: 'Продолжить здесь' })
    await act(async () => {
      previousHasError = true
      oldRequest.resolve(false)
      await oldRequest.promise
    })

    expect(screen.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
    expect(screen.queryByRole('alert')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Продолжить здесь' })).toBeEnabled()
    fireEvent.click(restoredButton)
    expect(await screen.findByTestId('app')).toBeInTheDocument()
    expect(restored.requestOwnership).toHaveBeenCalledOnce()
    expect(mocks.app).toHaveBeenCalledOnce()
  })

  it('shows a retryable error when lifecycle relinquishment fails', async () => {
    const owner = createGate(Promise.resolve(true))
    owner.relinquish.mockRejectedValueOnce(new Error('quiescence failed'))
    mocks.createGate.mockReset().mockReturnValue(owner)
    render(<ExecutionGateView />)

    await act(async () => {
      window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true }))
      await Promise.resolve()
      await Promise.resolve()
    })

    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeEnabled()
    expect(screen.queryByTestId('app')).not.toBeInTheDocument()
  })

  it('preserves a delayed lifecycle relinquishment failure after pageshow advances the generation', async () => {
    const drain = deferred<undefined>()
    const owner = createGate(Promise.resolve(true))
    owner.relinquish.mockReturnValueOnce(drain.promise)
    mocks.createGate.mockReset().mockReturnValue(owner)
    render(<ExecutionGateView />)

    act(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })) })
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    expect(screen.getByText('Ожидаем завершения безопасного переключения…')).toBeVisible()

    await act(async () => { drain.reject(new Error('quiescence failed')); await Promise.resolve() })
    expect(screen.getByRole('alert')).toBeVisible()
    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeEnabled()
    expect(mocks.createGate).toHaveBeenCalledOnce()
    expect(screen.queryByTestId('app')).not.toBeInTheDocument()
  })

  it('keeps a visible resolving state while restoration quiescence is pending', async () => {
    const drain = deferred<undefined>()
    const owner = createGate(Promise.resolve(true))
    owner.relinquish.mockReturnValueOnce(drain.promise)
    mocks.createGate.mockReset().mockReturnValue(owner)
    render(<ExecutionGateView />)

    act(() => { window.dispatchEvent(new PageTransitionEvent('pagehide', { persisted: true })) })
    act(() => { window.dispatchEvent(new PageTransitionEvent('pageshow', { persisted: true })) })
    expect(screen.getByText('Ожидаем завершения безопасного переключения…')).toBeVisible()
    expect(screen.queryByTestId('app')).not.toBeInTheDocument()
    expect(mocks.createGate).toHaveBeenCalledOnce()

    await act(async () => { drain.resolve(undefined); await drain.promise; await Promise.resolve() })
    expect(await screen.findByTestId('app')).toBeInTheDocument()
  })

  it('does not let StrictMode cleanup cancel a lock-owning controller before remount', async () => {
    const start = deferred<boolean>()
    const first = createGate(start.promise)
    const second = createGate(Promise.resolve(true))
    mocks.createGate.mockReset().mockReturnValueOnce(first).mockReturnValueOnce(second)
    render(<StrictMode><ExecutionGateView /></StrictMode>)

    await act(async () => { start.resolve(true); await start.promise })
    expect(await screen.findByTestId('app')).toBeInTheDocument()
    expect(first.close).toHaveBeenCalledOnce()
    expect(second.start).toHaveBeenCalledOnce()
  })

  it('keeps ownership resolution separate from the confirmed blocked screen', async () => {
    const start = deferred<boolean>()
    mocks.gate = createGate(start.promise)

    const view = render(<ExecutionGateView />)

    expect(screen.queryByRole('heading', { name: 'Приложение уже открыто' })).not.toBeInTheDocument()
    expect(screen.queryByText('Ожидаем завершения безопасного переключения…')).not.toBeInTheDocument()
    expect(screen.queryByTestId('app')).not.toBeInTheDocument()

    await act(async () => { start.resolve(false); await start.promise })

    expect(screen.getByRole('heading', { name: 'Приложение уже открыто' })).toBeVisible()
    expect(view.container.querySelector('.app-screen')).toBeInTheDocument()
    expect(view.container.querySelector('.screen-panel')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Продолжить здесь' })).toHaveClass('pill--primary')
  })

  it('mounts App immediately after ownership succeeds without a lazy fallback stage', async () => {
    mocks.gate = createGate(Promise.resolve(true))
    render(<ExecutionGateView />)

    expect(await screen.findByTestId('app')).toBeInTheDocument()
    expect(mocks.app).toHaveBeenCalledOnce()
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

  it('shows a recoverable coordination error instead of claiming another tab owns the lock', async () => {
    const gate = createGate(Promise.resolve(false))
    gate.hasError = () => true
    mocks.gate = gate
    render(<ExecutionGateView />)

    expect(await screen.findByText('Не удалось проверить безопасное владение вкладкой. Повторите попытку.')).toBeVisible()
    expect(screen.queryByRole('heading', { name: 'Приложение уже открыто' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Попробовать снова' })).toBeEnabled()
  })
})
