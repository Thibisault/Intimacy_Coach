import React from 'react'
import { Settings, Segment } from '../types'
import { t } from '../i18n'

type Props = { settings: Settings; onChange: (s:Settings)=>void }

const allSegs: Segment[] = ['L1','L2','L3','L4','L5','SEXE']

export default function CustomizeTab({ settings, onChange }:Props){
  const tt = t(settings.lang)

  function set<K extends keyof Settings>(key:K, val: Settings[K]){
    onChange({ ...settings, [key]: val })
  }
  function setFilter(k: keyof Settings['filters'], v:boolean){
    set('filters', { ...settings.filters, [k]: v })
  }
  function move(idx:number, dir:-1|1){
    const arr = [...settings.sequence]
    const ni = idx + dir
    if(ni<0 || ni>=arr.length) return
    const [it] = arr.splice(idx,1)
    arr.splice(ni, 0, it)
    set('sequence', arr)
  }
  function remove(idx:number){
    const arr = [...settings.sequence]
    arr.splice(idx,1)
    set('sequence', arr)
  }
  function add(seg:Segment){
    set('sequence', [...settings.sequence, { segment: seg, minutes: seg==='SEXE' ? 6 : 3 }])
  }
  function setRange(seg:Segment, field:'min'|'max', val:number){
    const ranges = { ...settings.ranges, [seg]: { ...settings.ranges[seg], [field]: Math.max(1, Math.round(val)) } }
    set('ranges', ranges)
  }
  function setSeqMinutes(i:number, val:number){
    const seq = [...settings.sequence]
    seq[i] = { ...seq[i], minutes: Math.max(1, Math.round(val)) }
    set('sequence', seq)
  }

  return (
    <div className="card">
      <h2>{tt.participants}</h2>
      <div className="grid">
        <div className="col">
          <label>{tt.p1}</label>
          <input value={settings.participants.P1} onChange={e=>set('participants', {...settings.participants, P1:e.target.value})} />
        </div>
        <div className="col">
          <label>{tt.p2}</label>
          <input value={settings.participants.P2} onChange={e=>set('participants', {...settings.participants, P2:e.target.value})} />
        </div>
      </div>

      <h2 style={{marginTop:16}}>{tt.filters}</h2>
      <div className="row">
        {(['anal','hard','clothed'] as const).map(k => (
          <label key={k} className="row" style={{gap:6}}>
            <input type="checkbox" checked={settings.filters[k]} onChange={e=>setFilter(k, e.target.checked)} />
            <span>{tt[k]}</span>
          </label>
        ))}
      </div>

      <h2 style={{marginTop:16}}>{tt.actorCycle}</h2>
      <div className="row">
        {(['random','p1p2both','p1p1p2both'] as const).map(k => (
          <label key={k} className="row" style={{gap:6}}>
            <input type="radio" name="actor" checked={settings.actorMode===k} onChange={e=>set('actorMode', k)} />
            <span>{tt[k]}</span>
          </label>
        ))}
      </div>

      <h2 style={{marginTop:16}}>{tt.ranges}</h2>
      <div className="grid">
        {(['L1','L2','L3','L4','L5','SEXE'] as Segment[]).map(seg => (
          <div key={seg} className="col card">
            <div className="row" style={{justifyContent:'space-between'}}>
              <strong>{seg}</strong>
            </div>
            <div className="row">
              <div className="col">
                <label>{tt.min}</label>
                <input type="number" value={settings.ranges[seg].min} onChange={e=>setRange(seg, 'min', Number(e.target.value))} />
              </div>
              <div className="col">
                <label>{tt.max}</label>
                <input type="number" value={settings.ranges[seg].max} onChange={e=>setRange(seg, 'max', Number(e.target.value))} />
              </div>
            </div>
          </div>
        ))}
      </div>

      <h2 style={{marginTop:16}}>{tt.cooldownSec}</h2>
      <input type="number" value={settings.cooldownSec} onChange={e=>set('cooldownSec', Math.max(0, Math.round(Number(e.target.value))))} />

      <h2 style={{marginTop:16}}>{tt.sequence}</h2>
      <div className="col">
        {settings.sequence.map((s, i) => (
          <div key={i} className="row" style={{alignItems:'center'}}>
            <strong style={{width:60}}>{s.segment}</strong>
            <label className="row" style={{gap:6}}>
              min:
              <input type="number" style={{width:80}} value={s.minutes} onChange={e=>setSeqMinutes(i, Number(e.target.value))} />
            </label>
            <button className="btn secondary" onClick={()=>move(i,-1)}>↑</button>
            <button className="btn secondary" onClick={()=>move(i, 1)}>↓</button>
            <button className="btn danger" onClick={()=>remove(i)}>{tt.remove}</button>
          </div>
        ))}
        <div className="row" style={{marginTop:8}}>
          <select onChange={e=> (e.target.value && add(e.target.value as Segment), e.currentTarget.selectedIndex=0)}>
            <option value="">{tt.addStep}…</option>
            {allSegs.map(seg => <option key={seg} value={seg}>{seg}</option>)}
          </select>
        </div>
      </div>
    </div>
  )
}