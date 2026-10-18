import {useI18n} from '../i18n/I18nContext.jsx'
export default function LibraryPublication({publication}){
 const {t}=useI18n()
 return publication?<p className="v2-subtext library-publication">{t('libraryRelease')}: <code>{publication.revision}</code> · {t('libraryUpdated')}: <time dateTime={publication.activated_at}>{publication.activated_at}</time></p>:<p className="v2-subtext">{t('libraryLegacyRelease')}</p>
}
