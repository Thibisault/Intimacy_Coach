import React, { useEffect, useMemo, useState } from 'react'
import { t } from './i18n'
import { Settings, defaultSettings, loadSettings, saveSettings, Step, Segment, DataFile } from './types'
import PlayTab from './components/PlayTab'
import CustomizeTab from './components/CustomizeTab'
import InstallPWA from './components/InstallPWA'

type Tab = 'play' | 'custom'

export default function App(){
  const [tab, setTab] = useState<Tab>('play')
  const [settings, setSettings] = useState<Settings>(() => loadSettings() ?? defaultSettings)
  const [data, setData] = useState<DataFile | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => { saveSettings(settings) }, [settings])

  useEffect(() => {
    (async () => {
      try {
        const res = await fetch(`${import.meta.env.BASE_URL}data.json`, { cache: 'no-store' })
        if(!res.ok) throw new Error('data.json introuvable')
        const json = await res.json()
        setData(json)
      } catch(e:any) {
        setError(e.message || 'Erreur de chargement de data.json')
      } finally {
        setLoading(false)
      }
    })()
  }, [])

  const lang = settings.lang
  const tt = t(lang)

  return (
    <div className="container">
      <header className="row" style={{alignItems:'center', marginBottom: 12}}>
        <h1>Intimacy Coach</h1><InstallPWA />
        <div className="row lang" style={{alignItems:'center'}}>
          <label>{tt.language}</label>
          <select value={lang} onChange={e => setSettings(s => ({...s, lang: e.target.value as any}))}>
            <option value="fr">Français</option>
            <option value="zh">中文</option>
          </select>
        </div>
      </header>

      <div className="tabs">
        <div className={["tab", tab==='play'?'active':''].join(' ')} onClick={()=>setTab('play')}>{tt.play}</div>
        <div className={["tab", tab==='custom'?'active':''].join(' ')} onClick={()=>setTab('custom')}>{tt.customize}</div>
      </div>

      {tab==='play' ? (
        <PlayTab
          settings={settings}
          onChangeSettings={setSettings}
          data={data}
          loading={loading}
          error={error}
        />
      ) : (
        <CustomizeTab
          settings={settings}
          onChange={setSettings}
        />
      )}
    </div>
  )
}