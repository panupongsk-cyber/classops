import { useCallback, useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { useI18n } from '../i18n/I18nContext.jsx'
import { ForbiddenState, LoadingRows, RetryableError } from '../components/StateViews.jsx'
import { ApiError } from '../auth/api.js'
import {
  createAssignment, createCategory, deleteAssignment, deleteCategory,
  downloadGradebookCsv, getGradebook, listAssignments, listCategories,
} from './api.js'

export default function GradebookPage() {
  const { t } = useI18n()
  const { sectionId } = useParams()

  const [categories, setCategories] = useState(null)
  const [assignments, setAssignments] = useState(null)
  const [gradebook, setGradebook] = useState(null)
  const [status, setStatus] = useState('loading')

  const [categoryName, setCategoryName] = useState('')
  const [categoryWeight, setCategoryWeight] = useState('')

  const load = useCallback(async () => {
    setStatus('loading')
    try {
      const [categoriesResult, assignmentsResult, gradebookResult] = await Promise.all([
        listCategories(sectionId), listAssignments(sectionId), getGradebook(sectionId),
      ])
      setCategories(categoriesResult.categories)
      setAssignments(assignmentsResult.assignments)
      setGradebook(gradebookResult)
      setStatus('ok')
    } catch (err) {
      if (err instanceof ApiError && err.status === 403) setStatus('forbidden')
      else setStatus('error')
    }
  }, [sectionId])

  useEffect(() => { load() }, [load])

  async function handleAddCategory(event) {
    event.preventDefault()
    await createCategory(sectionId, categoryName.trim(), Number(categoryWeight))
    setCategoryName('')
    setCategoryWeight('')
    await load()
  }

  async function handleDeleteCategory(categoryId) {
    if (!window.confirm(t('deleteConfirm'))) return
    await deleteCategory(categoryId)
    await load()
  }

  async function handleExportCsv() {
    await downloadGradebookCsv(sectionId, 'gradebook.csv')
  }

  if (status === 'loading') return <LoadingRows />
  if (status === 'forbidden') return <ForbiddenState />
  if (status === 'error') return <RetryableError onRetry={load} />

  return (
    <div>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 20 }}>
        <h1 className="v2-h1" style={{ margin: 0 }}>{t('gradebookHeading')}</h1>
        <button type="button" className="v2-btn v2-btn-secondary" onClick={handleExportCsv}>{t('exportCsvCta')}</button>
      </div>

      <div className="v2-card" style={{ marginBottom: 20 }}>
        <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('categoriesHeading')}</div>
        {categories.length === 0 && <p style={{ color: 'var(--v2-ink-muted)', fontSize: '.85rem' }}>{t('noCategories')}</p>}
        {categories.map((category) => (
          <CategoryBlock
            key={category.id}
            category={category}
            assignments={assignments.filter((a) => a.category_id === category.id)}
            onDeleteCategory={() => handleDeleteCategory(category.id)}
            onChanged={load}
          />
        ))}
        <form onSubmit={handleAddCategory} style={{ display: 'flex', gap: 10, alignItems: 'flex-end', marginTop: 16 }}>
          <div className="v2-field" style={{ margin: 0, flex: 1 }}>
            <label htmlFor="category-name">{t('categoryNameLabel')}</label>
            <input id="category-name" value={categoryName} onChange={(e) => setCategoryName(e.target.value)} required />
          </div>
          <div className="v2-field" style={{ margin: 0, width: 100 }}>
            <label htmlFor="category-weight">{t('categoryWeightLabel')}</label>
            <input id="category-weight" type="number" min="0" step="any" value={categoryWeight} onChange={(e) => setCategoryWeight(e.target.value)} required />
          </div>
          <button type="submit" className="v2-btn v2-btn-primary">{t('addCategory')}</button>
        </form>
      </div>

      <div style={{ fontWeight: 600, marginBottom: 12 }}>{t('resultsHeading')}</div>
      <table className="v2-table">
        <thead>
          <tr>
            <th>{t('colName')}</th>
            {categories.map((category) => <th key={category.id}>{category.name}</th>)}
            <th>{t('colFinalGrade')}</th>
          </tr>
        </thead>
        <tbody>
          {gradebook.students.map((student) => (
            <tr key={student.userId}>
              <td>{student.displayName}</td>
              {categories.map((category) => (
                <td key={category.id} className="is-muted">
                  {student.categoryPercentages[category.id] !== undefined
                    ? `${student.categoryPercentages[category.id].toFixed(1)}%`
                    : '—'}
                </td>
              ))}
              <td style={{ fontWeight: 600 }}>
                {student.finalGrade !== null ? `${student.finalGrade.toFixed(1)}%` : t('notEnoughData')}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}

function CategoryBlock({ category, assignments, onDeleteCategory, onChanged }) {
  const { t } = useI18n()
  const { sectionId } = useParams()
  const [name, setName] = useState('')
  const [maxPoints, setMaxPoints] = useState('')

  async function handleAddAssignment(event) {
    event.preventDefault()
    await createAssignment(category.id, name.trim(), Number(maxPoints))
    setName('')
    setMaxPoints('')
    onChanged()
  }

  async function handleDeleteAssignment(assignmentId) {
    if (!window.confirm(t('deleteConfirm'))) return
    await deleteAssignment(assignmentId)
    onChanged()
  }

  return (
    <div style={{ border: '1px solid var(--v2-border)', borderRadius: 12, padding: 16, marginBottom: 12 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
        <div style={{ fontWeight: 600 }}>{category.name} <span style={{ color: 'var(--v2-ink-muted)', fontWeight: 400 }}>({t('categoryWeightLabel')}: {category.weight})</span></div>
        <button type="button" className="v2-btn v2-btn-secondary" style={{ padding: '4px 10px', fontSize: '.75rem' }} onClick={onDeleteCategory}>{t('remove')}</button>
      </div>
      {assignments.length === 0 && <p style={{ color: 'var(--v2-ink-muted)', fontSize: '.82rem' }}>{t('noAssignments')}</p>}
      {assignments.map((assignment) => (
        <div key={assignment.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', fontSize: '.85rem' }}>
          <span>{assignment.name} <span className="is-muted">/ {assignment.max_points}</span></span>
          <span>
            <Link to={`/v2/sections/${sectionId}/gradebook/assignments/${assignment.id}/scores`} style={{ marginRight: 12, fontSize: '.8rem' }}>{t('enterScoresAction')}</Link>
            <button type="button" className="v2-btn v2-btn-secondary" style={{ padding: '2px 8px', fontSize: '.72rem' }} onClick={() => handleDeleteAssignment(assignment.id)}>{t('remove')}</button>
          </span>
        </div>
      ))}
      <form onSubmit={handleAddAssignment} style={{ display: 'flex', gap: 8, alignItems: 'flex-end', marginTop: 10 }}>
        <input value={name} onChange={(e) => setName(e.target.value)} placeholder={t('assignmentNameLabel')} required style={{ flex: 1, padding: '6px 10px', border: '1px solid var(--v2-border-strong)', borderRadius: 8, fontSize: '.85rem' }} />
        <input type="number" min="0" step="any" value={maxPoints} onChange={(e) => setMaxPoints(e.target.value)} placeholder={t('assignmentMaxPointsLabel')} required style={{ width: 90, padding: '6px 10px', border: '1px solid var(--v2-border-strong)', borderRadius: 8, fontSize: '.85rem' }} />
        <button type="submit" className="v2-btn v2-btn-secondary" style={{ padding: '6px 12px', fontSize: '.8rem' }}>{t('addAssignment')}</button>
      </form>
    </div>
  )
}
