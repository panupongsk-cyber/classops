import { useCallback, useEffect, useState } from 'react'
import { Link, useParams, useSearchParams, useLocation } from 'react-router-dom'
import { apiRequest, apiUrl } from '../auth/api.js'
import { EmptyState, ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { useI18n } from '../i18n/I18nContext.jsx'
import './library.css'

const text = (value, lang) => value?.[lang] || value?.en || value?.th || ''
const figure = (value, lang) => value?.[lang] || value?.en || value?.th
const path = (exam, item) => `/v2/library/${encodeURIComponent(exam)}${item ? `/${encodeURIComponent(item)}` : ''}`

export default function LibraryPage() {
  const location = useLocation()
  return <LibraryReader key={location.pathname} />
}

function LibraryReader() {
  const { examId, itemId } = useParams()
  const [search, setSearch] = useSearchParams()
  const { t } = useI18n()
  const [data, setData] = useState(null)
  const [status, setStatus] = useState('loading')
  const [attempt, setAttempt] = useState(0)
  const [answer, setAnswer] = useState(null)
  const [answerStatus, setAnswerStatus] = useState('idle')
  const rawPage = Number(search.get('page') || 1)
  const page = Number.isInteger(rawPage) && rawPage > 0 && rawPage <= 100000 ? rawPage : 1
  const requestedLang = search.get('lang') === 'en' ? 'en' : 'th'
  const query = `?page=${page}&lang=${requestedLang}`
  const endpoint = !examId ? '/api/library' : `/api/library/${encodeURIComponent(examId)}/questions${itemId ? `/${encodeURIComponent(itemId)}` : `?page=${page}`}`
  useEffect(() => {
    let alive = true
    setStatus('loading'); setData(null); setAnswer(null); setAnswerStatus('idle')
    apiRequest(endpoint).then((result) => { if (alive) { setData(result); setStatus('ok') } })
      .catch((error) => { if (alive) setStatus(error.status === 403 ? 'forbidden' : error.status === 404 ? 'missing' : 'error') })
    return () => { alive = false }
  }, [endpoint, attempt])
  const reveal = useCallback(async () => {
    setAnswerStatus('loading')
    try {
      const result = await apiRequest(`${endpoint}/answer`)
      // Reader is keyed by its URL, so a late answer cannot appear on another item.
      setAnswer(result); setAnswerStatus('ok')
    } catch { setAnswerStatus('error') }
  }, [endpoint])
  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'missing') return <EmptyState heading={t('libraryMissing')} action={<Link to="/v2/library">{t('libraryTitle')}</Link>} />
  if (status === 'error') return <RetryableError onRetry={() => setAttempt((n) => n + 1)} />

  if (!examId) return <section className="library-page"><h1>{t('libraryTitle')}</h1><p>{t('libraryPrivate')}</p>
    {data.exams.length === 0 ? <EmptyState heading={t('libraryEmpty')} /> : data.exams.map((exam) => <article className="v2-card" key={exam.id}>
      <h2><Link to={path(exam.id)}>{exam.metadata.title}</Link></h2>
      <p>{exam.metadata.provider} · {exam.metadata.item_count} {t('libraryItems')}</p>
    </article>)}
  </section>

  const exam = data.exam
  const meta = exam.metadata
  const lang = meta.languages.includes(requestedLang) ? requestedLang : meta.languages[0]
  return <section className="library-page">
    <Link to="/v2/library">← {t('libraryTitle')}</Link>
    <h1>{meta.title}</h1>
    <label>{t('libraryLanguage')} <select value={requestedLang} onChange={(e) => { const next = new URLSearchParams(search); next.set('lang', e.target.value); setSearch(next, { replace: true }) }}>
      <option value="th">ไทย</option><option value="en">English</option>
    </select></label>
    <p>{t('libraryDisplaying')}: <strong>{lang === 'th' ? 'ไทย' : 'English'}</strong>{lang !== requestedLang && ` · ${t('libraryFallback')}`}</p>
    {lang === 'th' && meta.translation_note && <p className="v2-subtext">{meta.translation_note}</p>}
    {!itemId ? <>
      <p>{data.total} {t('libraryItems')} · {t('libraryPage')} {page}</p>
      {data.questions.length === 0 ? <EmptyState heading={t('libraryNoItems')} /> : data.questions.map((q) => <article className="v2-card" key={q.source_id}>
        <Link to={`${path(examId, q.source_id)}${query}`}>Q{q.seq} · {text(q.stem, lang)}</Link>
      </article>)}
      <nav className="library-actions" aria-label={t('libraryPages')}>
        {page > 1 && <Link to={`${path(examId)}?page=${page - 1}&lang=${requestedLang}`}>{t('libraryPrevious')}</Link>}
        {page * data.pageSize < data.total && <Link to={`${path(examId)}?page=${page + 1}&lang=${requestedLang}`}>{t('libraryNext')}</Link>}
      </nav>
    </> : <>
      <Link to={`${path(examId)}${query}`}>← {t('libraryBack')}</Link>
      <article className="v2-card library-question" lang={lang}>
        <h2>Q{data.question.seq}</h2><p className="v2-subtext">{data.question.content_id} · {data.question.category} · {t('libraryCategoryNote')}</p>
        <p className="library-text">{text(data.question.stem, lang)}</p>
        {figure(data.question.figure, lang) && <img src={apiUrl(figure(data.question.figure, lang))} alt={`${t('libraryFigure')} Q${data.question.seq}`} />}
        <ol className="library-options">{data.question.options.map((o) => <li key={o.label}>
          <strong>{o.label}) </strong>{figure(o.figure, lang) ? <img src={apiUrl(figure(o.figure, lang))} alt={text(o.text, lang) || `${t('libraryFigure')} ${o.label}`} /> : <span className="library-text">{text(o.text, lang)}</span>}
        </li>)}</ol>
        <button type="button" className="v2-btn v2-btn-secondary" disabled={answerStatus === 'loading'} onClick={() => { if (answer) { setAnswer(null); setAnswerStatus('idle') } else reveal() }}>
          {t(answer ? 'libraryHideAnswer' : answerStatus === 'loading' ? 'libraryLoadingAnswer' : 'libraryRevealAnswer')}
        </button>
        {answerStatus === 'error' && <RetryableError onRetry={reveal} />}
        {answer && <div role="status"><p><strong>{t('libraryAnswer')}: {answer.answer || t('libraryNoAnswer')}</strong></p>
          <p>{t('libraryProvenance')}: {meta.answer_key_provenance}</p>
          {answer.explanation && <p className="library-text">{text(answer.explanation, lang)}</p>}
        </div>}
      </article>
      <nav className="library-actions" aria-label={t('libraryQuestions')}>
        {data.previous && <Link to={`${path(examId, data.previous)}${query}`}>{t('libraryPrevious')}</Link>}
        {data.next && <Link to={`${path(examId, data.next)}${query}`}>{t('libraryNext')}</Link>}
      </nav>
    </>}
    <footer><p>{meta.attribution}</p><p className="v2-subtext">{t('libraryRevision')}: {exam.revision}<br />{exam.source_path} · {exam.source_commit}</p></footer>
  </section>
}
