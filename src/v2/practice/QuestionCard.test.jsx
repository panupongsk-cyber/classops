import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { I18nProvider } from '../i18n/I18nContext.jsx'
import QuestionCard from './QuestionCard.jsx'

// Option-level figures (PS-TASK-20261012-1760): a figure replaces its option's text, which
// survives as the image's alt — except a bare "(see figure)" placeholder, which becomes a
// generic alt. Options without a figure are unchanged.
const question = {
  id: 'q1',
  seq: 7,
  examContentId: 'SYN',
  category: 'Synthetic',
  stem: { en: 'Which diagram shows a loop?' },
  options: [
    { label: 'a', text: { en: 'Two circles joined by arrows' }, figure: { en: '/api/practice/figures/F1' } },
    { label: 'b', text: { en: '(see figure)' }, figure: { en: '/api/practice/figures/F2' } },
    { label: 'c', text: { en: 'Plain text option' } },
  ],
  figure: null,
}

const renderCard = () =>
  render(
    <I18nProvider>
      <QuestionCard question={question} lang="en" selected={null} onSelect={() => {}} />
    </I18nProvider>,
  )

beforeEach(() => window.localStorage.setItem('classops_v2_lang', 'en'))
afterEach(cleanup)

describe('QuestionCard option figures', () => {
  it('renders the option image with the description as alt, and hides that description as text', () => {
    renderCard()
    const img = screen.getByRole('img', { name: 'Two circles joined by arrows' })
    expect(img.getAttribute('src')).toBe('/api/practice/figures/F1')
    expect(screen.queryByText('Two circles joined by arrows')).toBeNull()
  })

  it('uses a generic alt when the description is only a see-figure placeholder', () => {
    renderCard()
    const img = screen.getByRole('img', { name: 'Figure for option b' })
    expect(img.getAttribute('src')).toBe('/api/practice/figures/F2')
    expect(screen.queryByText('(see figure)')).toBeNull()
  })

  it('renders plain text for options without a figure', () => {
    renderCard()
    expect(screen.getByText('Plain text option')).toBeTruthy()
  })

  it('shows the explanation with its label only once the key is revealed', () => {
    const withExplanation = { ...question, explanation: { en: 'The loop terminates at once.' } }
    const { unmount } = render(
      <I18nProvider>
        <QuestionCard question={withExplanation} lang="en" selected="a" onSelect={() => {}} />
      </I18nProvider>,
    )
    expect(screen.queryByText('The loop terminates at once.')).toBeNull()
    unmount()
    render(
      <I18nProvider>
        <QuestionCard question={withExplanation} lang="en" selected="a" revealed={{ selected: 'a', answer: 'a' }} onSelect={() => {}} />
      </I18nProvider>,
    )
    expect(screen.getByText('Supplementary explanation — not ITPEC content')).toBeTruthy()
    expect(screen.getByText('The loop terminates at once.')).toBeTruthy()
  })
})
