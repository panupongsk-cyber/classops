import {fireEvent,render,screen,cleanup} from '@testing-library/react'
import {afterEach,beforeEach,test,expect,vi} from 'vitest'
import {MemoryRouter,Route,Routes,useLocation} from 'react-router-dom'
import {I18nProvider} from '../i18n/I18nContext.jsx'
import {apiRequest} from '../auth/api.js'
import LibraryPage from './LibraryPage.jsx'
vi.mock('../auth/api.js',()=>({apiRequest:vi.fn(),apiUrl:p=>p}))
const result={total:21,page:1,pageSize:20,questions:[{exam_id:'E',source_id:'Q1',seq:1,stem:{th:'โจทย์สังเคราะห์'},title:'Synthetic set'}],facets:[{exam_id:'E',title:'Synthetic set',family:'Family',year:'2024',category_key:'["Family", "Tag"]',category:'Tag'}]}
function Location(){return <output data-testid="url">{useLocation().pathname+useLocation().search}</output>}
function show(url='/v2/library?scope=search&page=1&lang=th&q=เดิม'){return render(<I18nProvider><MemoryRouter initialEntries={[url]}><Routes><Route path="/v2/library" element={<LibraryPage/>}/><Route path="/v2/library/:examId/:itemId" element={<LibraryPage/>}/></Routes><Location/></MemoryRouter></I18nProvider>)}
beforeEach(()=>{localStorage.clear();apiRequest.mockReset()});afterEach(cleanup)
test('URL restores form, combines filters, resets page, paginates and clears',async()=>{
 apiRequest.mockResolvedValue(result);show();await screen.findByText('โจทย์สังเคราะห์',{exact:false})
 expect(screen.getByRole('textbox').value).toBe('เดิม')
 fireEvent.change(screen.getByRole('textbox'),{target:{value:'ค้นหา'}})
 fireEvent.change(screen.getByRole('combobox',{name:/ตระกูล|family/}),{target:{value:'Family'}})
 fireEvent.click(screen.getByRole('button',{name:/^ค้นหา$|^Search$/}))
 await screen.findByText('โจทย์สังเคราะห์',{exact:false})
 expect(screen.getByTestId('url').textContent).toContain('family=Family')
 fireEvent.click(screen.getByRole('link',{name:/ถัดไป|Next/}));await screen.findByText('โจทย์สังเคราะห์',{exact:false})
 expect(screen.getByTestId('url').textContent).toContain('page=2')
 fireEvent.click(screen.getByRole('button',{name:/ล้างตัวกรอง|Clear filters/}));await screen.findByText('โจทย์สังเคราะห์',{exact:false})
 expect(screen.getByTestId('url').textContent).toBe('/v2/library?scope=search&lang=th&page=1')
})
test('search reader crosses papers and returns to exact selected result URL; reveal ignores query',async()=>{
 apiRequest.mockImplementation(p=>Promise.resolve(p.endsWith('/answer')?{answer:'a'}:p.startsWith('/api/library/search')?result:{exam:{metadata:{title:'Synthetic set',languages:['th']}},question:{content_id:'Q1',seq:1,stem:{th:'โจทย์สังเคราะห์'},options:[]},previous:null,next:null,resultContext:{previous:null,next:{exam:'OTHER',item:'Q2'}}}))
 show('/v2/library/E/Q1?scope=search&page=2&lang=th&q=alpha&family=Family');await screen.findByText('โจทย์สังเคราะห์')
 expect(screen.getByRole('link',{name:/กลับรายการ|Back to questions/}).getAttribute('href')).toBe('/v2/library?scope=search&page=2&lang=th&q=alpha&family=Family')
 expect(screen.getByRole('link',{name:/ถัดไป|Next/}).getAttribute('href')).toBe('/v2/library/OTHER/Q2?scope=search&page=2&lang=th&q=alpha&family=Family')
 fireEvent.click(screen.getByRole('button',{name:/เปิดเฉลย|Reveal answer/}));await screen.findByRole('status')
 expect(apiRequest).toHaveBeenCalledWith('/api/library/E/questions/Q1/answer')
})
test('empty results keep filters available',async()=>{apiRequest.mockResolvedValue({...result,total:0,questions:[]});show();await screen.findByText(/ไม่พบข้อสอบตามเงื่อนไข|No questions match/);expect(screen.getByRole('textbox').value).toBe('เดิม')})
