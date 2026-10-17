import {useEffect,useState} from 'react'
import {Link,useSearchParams} from 'react-router-dom'
import {apiRequest} from '../auth/api.js'
import {useI18n} from '../i18n/I18nContext.jsx'
import {ForbiddenState,LoadingRows,RetryableError} from '../components/StateViews.jsx'
const fields=['q','family','exam','year','category','language','answer']
const read=(params)=>Object.fromEntries(fields.map(k=>[k,params.get(k)||'']))
export default function LibrarySearch(){
 const {t}=useI18n();const [params,setParams]=useSearchParams();const serialized=params.toString()
 const [draft,setDraft]=useState(()=>read(params));const [data,setData]=useState(null);const [status,setStatus]=useState('loading');const [attempt,setAttempt]=useState(0)
 const lang=params.get('lang')==='en'?'en':'th';const page=Number(params.get('page')||1)
 useEffect(()=>{setDraft(read(new URLSearchParams(serialized)))},[serialized])
 useEffect(()=>{let alive=true;setStatus('loading');apiRequest('/api/library/search?'+serialized).then(r=>{if(alive){setData(r);setStatus('ok')}}).catch(e=>{if(alive)setStatus(e.status===403?'forbidden':e.status===400?'invalid':'error')});return()=>{alive=false}},[serialized,attempt])
 const go=(values,newPage=1)=>{const next=new URLSearchParams({scope:'search',lang,page:String(newPage)});for(const k of fields)if(values[k])next.set(k,values[k]);setParams(next)}
 if(status==='forbidden')return <ForbiddenState />
 const facets=data?.facets||[]
 const unique=(key)=>[...new Set(facets.map(f=>f[key]).filter(Boolean))].sort()
 const choices={family:unique('family').map(v=>[v,v]),exam:[...new Map(facets.map(f=>[f.exam_id,[f.exam_id,f.title]])).values()],year:unique('year').map(v=>[v,v==='unknown'?t('libraryUnknownYear'):v]),category:[...new Map(facets.map(f=>[f.category_key,[f.category_key,`${f.family} · ${f.category||t('libraryUncategorized')}`]])).values()].sort((a,b)=>a[1].localeCompare(b[1])),language:[['th','ไทย'],['en','English']],answer:[['available',t('libraryKeyAvailable')],['missing',t('libraryNoAnswer')],['voided',t('libraryVoided')]]}
 const names={family:'libraryFamily',exam:'librarySet',year:'libraryYear',category:'libraryCategory',language:'libraryAvailableLanguage',answer:'libraryKeyStatus'}
 const pageLink=(n)=>{const next=new URLSearchParams(params);next.set('page',String(n));return '/v2/library?'+next}
 return <section className="library-page">
  <Link to="/v2/library">← {t('libraryTitle')}</Link><h1>{t('librarySearchTitle')}</h1><p>{t('librarySearchHelp')}</p>
  <form className="library-filters" onSubmit={e=>{e.preventDefault();go(draft)}}>
   <label>{t('librarySearchText')}<input name="q" maxLength={200} value={draft.q} onChange={e=>setDraft({...draft,q:e.target.value})}/></label>
   {Object.keys(names).map(k=><label key={k}>{t(names[k])}<select name={k} value={draft[k]} onChange={e=>setDraft({...draft,[k]:e.target.value})}><option value="">{t('libraryAll')}</option>{choices[k].map(([v,label])=><option key={v} value={v}>{label}</option>)}</select></label>)}
   <div className="library-actions"><button className="v2-btn v2-btn-primary" type="submit">{t('librarySearchSubmit')}</button><button className="v2-btn v2-btn-secondary" type="button" onClick={()=>go({})}>{t('libraryReset')}</button></div>
  </form>
  {status==='loading'?<LoadingRows/>:status==='error'?<RetryableError onRetry={()=>setAttempt(n=>n+1)}/>:status==='invalid'?<p role="alert">{t('libraryInvalidSearch')}</p>:<>
   <p role="status">{data.total} {t('libraryItems')} · {t('libraryPage')} {data.page}</p>
   {data.questions.length===0?<p>{t('libraryNoResults')}</p>:data.questions.map(q=><article className="v2-card" key={q.exam_id+'/'+q.source_id}><p>{q.title}</p><Link to={`/v2/library/${encodeURIComponent(q.exam_id)}/${encodeURIComponent(q.source_id)}?${params}`}>{q.source_label||`Q${q.source_number||q.seq}`} · {q.stem?.[lang]||q.stem?.th||q.stem?.en||t('libraryImageItem')}</Link></article>)}
   <nav className="library-actions" aria-label={t('libraryPages')}>{page>1&&<Link to={pageLink(page-1)}>{t('libraryPrevious')}</Link>}{page*data.pageSize<data.total&&<Link to={pageLink(page+1)}>{t('libraryNext')}</Link>}</nav>
  </>}
 </section>
}
