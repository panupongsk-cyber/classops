import { act, fireEvent, render, screen, waitFor, cleanup } from '@testing-library/react'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { I18nProvider } from '../i18n/I18nContext.jsx'
import { ApiError, apiRequest } from '../auth/api.js'
import LibraryPage from './LibraryPage.jsx'
vi.mock('../auth/api.js', () => ({ apiRequest: vi.fn(), apiUrl: (p) => p, ApiError: class extends Error { constructor(code,status) { super(code);this.status=status } } }))
const meta = { title: 'Synthetic paper', languages: ['en','th'], answer_key_provenance: 'official', attribution: 'Synthetic attribution' }
const detail = { exam: { metadata: meta, revision: 'abc', source_path:'synthetic',source_commit:'def' },previous:null,next:'Q2',question:{content_id:'Q1',seq:1,category:'Alpha',stem:{en:'English stem',th:'โจทย์สังเคราะห์'},options:[{label:'a',text:{en:'A',th:'ก'}},{label:'b',text:{en:'B',th:'ข'},figure:{en:'/figure'}}]} }
function show(url='/v2/library/E/Q1?page=2') { return render(<I18nProvider><MemoryRouter initialEntries={[url]}><Routes><Route path="/v2/library/:examId/:itemId" element={<LibraryPage />} /><Route path="/v2/library/:examId" element={<LibraryPage />} /><Route path="/v2/library" element={<LibraryPage />} /></Routes></MemoryRouter></I18nProvider>) }
beforeEach(() => { localStorage.clear();apiRequest.mockReset() })
afterEach(cleanup)
test('Thai first, independent content language, reveal only on request and preserve list page', async () => {
  apiRequest.mockImplementation((p) => Promise.resolve(p.endsWith('/answer') ? {answer:'b',explanation:{th:'คำอธิบาย'}} : detail))
  show()
  await screen.findByText('โจทย์สังเคราะห์')
  expect(apiRequest).toHaveBeenCalledTimes(1)
  expect(screen.getByRole('link',{name:/กลับรายการ|Back to questions/}).getAttribute('href')).toBe('/v2/library/E?page=2&lang=th')
  fireEvent.change(screen.getByRole('combobox'),{target:{value:'en'}})
  await screen.findByText('English stem')
  fireEvent.click(screen.getByRole('button',{name:/เปิดเฉลย|Reveal answer/}))
  await screen.findByText(/official/)
  expect(apiRequest).toHaveBeenCalledWith('/api/library/E/questions/Q1/answer')
  fireEvent.click(screen.getByRole('button',{name:/ซ่อนเฉลย|Hide answer/}))
  expect(screen.queryByText(/official/)).toBeNull()
})
test('fallback, media, forbidden, retry and empty catalogue', async () => {
  apiRequest.mockResolvedValue({...detail,exam:{...detail.exam,metadata:{...meta,languages:['en']}}})
  const view=show();await screen.findByText('English stem');expect(screen.getByText(/Requested language unavailable|ไม่มีภาษาที่เลือก/)).toBeTruthy()
  expect(screen.getByRole('img').getAttribute('src')).toBe('/figure');view.unmount()
  apiRequest.mockRejectedValue(new ApiError('LIBRARY_FORBIDDEN',403));show();await screen.findByText(/สิทธิ์|access|permission/i);cleanup()
  apiRequest.mockRejectedValue(new Error('offline'));show('/v2/library');await screen.findByRole('button',{name:/ลอง|Retry/i});cleanup()
  apiRequest.mockResolvedValue({exams:[]});show('/v2/library');await screen.findByText(/No papers imported|ยังไม่มีชุดข้อสอบ/)
})
test('late answer response cannot reveal a key on the next question', async () => {
  let resolveAnswer
  apiRequest.mockImplementation((p) => p.endsWith('/answer') ? new Promise((resolve) => {resolveAnswer=resolve}) : Promise.resolve(p.includes('Q2') ? {...detail,question:{...detail.question,seq:2,content_id:'Q2'}} : detail))
  show();await screen.findByText('โจทย์สังเคราะห์');fireEvent.click(screen.getByRole('button',{name:/เปิดเฉลย|Reveal answer/}))
  fireEvent.click(screen.getByRole('link',{name:/ถัดไป|Next/}));await screen.findByRole('heading',{name:'Q2'})
  await act(async () => {resolveAnswer({answer:'a'})})
  expect(screen.queryByRole('status')).toBeNull()
})

test('generic reader renders Unicode tables, source caveats and reveals alternative keys only on request', async () => {
  const generic={...detail,exam:{...detail.exam,metadata:{...meta,languages:['th'],category_provenance:'official',source_notes:['Provisional reconstruction'],answer_key_note:'Unverified synthetic note'}},question:{...detail.question,source_number:'19',question_type:'numeric_response',category:null,table:{rows:[['x','y'],['α','β']],header_rows:1},notes:['OCR needs inspection'],options:[]}}
  apiRequest.mockImplementation(p=>Promise.resolve(p.endsWith('/answer')?{answer:'42',answer_alternatives:['43'],explanation:{th:'อธิบาย'},answer_key_note:'Reveal-only source note'}:generic))
  show();await screen.findByRole('heading',{name:'Q19'})
  expect(screen.getByRole('table')).toBeTruthy();expect(screen.getByRole('columnheader',{name:'x'})).toBeTruthy()
  expect(screen.getByText('Provisional reconstruction')).toBeTruthy()
  expect(screen.getByText('OCR needs inspection')).toBeTruthy()
  expect(screen.queryByText(/43/)).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:/เปิดเฉลย|Reveal answer/}))
  await screen.findByText(/43/)
  expect(screen.getByText('Reveal-only source note')).toBeTruthy()
})
test('image-only full items retain eight labels without inventing option text; voided and pending keys are explicit', async () => {
  const image={...detail,question:{...detail.question,stem:{},representation:'full_item_image',answer_in_image:true,figure:{en:'/source.png'},voided:true,voided_note:'Source voided this question',options:Array.from({length:8},(_,i)=>({label:String(i+1),text:{}}))}}
  apiRequest.mockImplementation(p=>Promise.resolve(p.endsWith('/answer')?{answer:null,voided:true}:image))
  show();await screen.findByText(/Source voided/)
  expect(screen.getAllByText(/ดูตัวเลือกในภาพต้นฉบับ|See this choice in the source image/)).toHaveLength(8)
  expect(screen.getByRole('img').getAttribute('src')).toBe('/source.png')
  expect(screen.getByText(/ภาพต้นฉบับมีเฉลยอยู่ในภาพ|The original image includes the answer/)).toBeTruthy()
  expect(screen.queryByRole('status')).toBeNull()
  fireEvent.click(screen.getByRole('button',{name:/เปิดเฉลย|Reveal answer/}))
  await waitFor(()=>expect(screen.getByRole('status').textContent).toMatch(/ข้อสอบยกเลิก|Voided/))
})
