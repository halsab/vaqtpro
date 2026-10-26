import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { Screen } from './Screen'

describe('Screen navigation slot', () => {
  it('starts at the content top and squares the upper panel corners without navigation', () => {
    const { container } = render(<Screen label="Welcome" top={<> {null}{false} </>}><p>Content</p></Screen>)
    expect(screen.getByRole('region', { name: 'Welcome' })).toHaveClass('app-screen--no-top')
    expect(container.querySelector('.screen-panel')).toHaveClass('screen-panel--no-top')
    expect(container.querySelector('.screen-top')).not.toBeInTheDocument()
  })

  it('keeps the navigation layout and rounded panel when controls exist', () => {
    const { container } = render(<Screen label="Location" top={<button>Back</button>}><p>Content</p></Screen>)
    expect(screen.getByRole('region', { name: 'Location' })).not.toHaveClass('app-screen--no-top')
    expect(container.querySelector('.screen-top')).toHaveTextContent('Back')
    expect(container.querySelector('.screen-panel')).not.toHaveClass('screen-panel--no-top')
  })
})
