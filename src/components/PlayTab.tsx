
import React, { useEffect, useMemo, useRef, useState } from 'react'
import { DataFile, PlannedAction, Settings } from '../types'
import { t } from '../i18n'
import { buildPlan } from '../engine/planner'
import { pickVoices, SpeechQueue } from '../engine/speech'
import { beepNow } from '../engine/audio'

type Props = {
  settings: Settings
  onChangeSettings: (updater: (s:Settings)=>Settings | Settings) => void
  data: DataFile | null
  loading: boolean
  error: string | null
}

type Phase = 'idle'|'announcing'|'action'|'cooldown'|'done'

export default function PlayTab({ settings, onChangeSettings, data, loading, error }:Props){
  const tt = t(settings.lang)
  const [phase, setPhase] = useState<Phase>('idle')
  const [currentIdx, setCurrentIdx] = useState(0)
  const [plan, setPlan] = useState<PlannedAction[]>([])
  const [timeLeft, setTimeLeft] = useState(0)
  const [paused, setPaused] = useState(false)
  const [theme, setTheme] = useState('level1')
  const [segName, setSegName] = useState<string>('')

  const queueRef = useRef<SpeechQueue | null>(null)
  const voicesRef = useRef<any>(null)
  const cancelRef = useRef(false)
  const pausedRef = useRef(false)

  useEffect(() => { pausedRef.current = paused }, [paused])

  useEffect(() => {
    const seg = plan[currentIdx]?.segment
    if(!seg) return
    setTheme(seg==='SEXE' ? 'sexe' : `level${seg.slice(1)}`)
    setSegName((tt as any).segNames?.[seg] || seg)
  }, [plan, currentIdx, tt])

  useEffect(() => { cancelRef.current = false; return () => { cancelRef.current = true; queueRef.current?.cancel() } }, [])

  async function start(){
    if(!data){ return }
    const voices = await pickVoices()
    voicesRef.current = voices
    const p = buildPlan(settings, data).flat
    setPlan(p)
    setCurrentIdx(0)
    setPhase('announcing')
    run(p)
  }

  async function run(p:PlannedAction[]){
    const q = (queueRef.current ??= new SpeechQueue())
    q.clear()

    for(let i=0;i<p.length;i++){
      setCurrentIdx(i)
      const item = p[i]
      const zh = substitute(item.text_zh || '', settings.participants)
      const fr = substitute(item.text, settings.participants)
      q.enqueueCNFR(zh, fr, voicesRef.current)
      // wait for TTS end (no overlap)
      while(q['paused'] || (speechSynthesis.speaking || speechSynthesis.pending)){
        if(pausedRef.current){ await sleep(120); continue }
        if(cancelRef.current){ q.cancel(); setPhase('done'); return }
        await sleep(60)
      }
      if(cancelRef.current){ q.cancel(); setPhase('done'); return }

      // Action
      setPhase('action')
      await countdownAccurate(item.durationSec, (left)=>{
        setTimeLeft(left)
        if(left===3 || left===2 || left===1) beepNow()
      }, () => cancelRef.current, () => pausedRef.current)

      if(cancelRef.current){ q.cancel(); setPhase('done'); return }

      // Cooldown (between items)
      if(settings.cooldownSec>0 && (i < p.length-1)){
        setPhase('cooldown')
        await countdownAccurate(settings.cooldownSec, (left)=>setTimeLeft(left), () => cancelRef.current, () => pausedRef.current)
      }
      if(cancelRef.current){ q.cancel(); setPhase('done'); return }

      // Next → announce
      if(i < p.length-1) setPhase('announcing')
    }
    setPhase('done')
  }

  function stop(){
    cancelRef.current = true
    queueRef.current?.cancel()
    setPaused(false)
    setPhase('done')
    setTimeLeft(0)
  }

  function togglePause(){
    const next = !paused
    setPaused(next)
    if(next) queueRef.current?.pause()
    else queueRef.current?.resume()
  }

  const current = plan[currentIdx]
  const showCountdown = (phase==='action' || phase==='cooldown')

  return (
    <div className={['card theme', theme].join(' ')}>
      {/* Tiny segment chip with evocative UI-only name */}
      {current && <div className="seg-chip" style={{marginBottom:8}}>
        <span className="seg-dot" />
        <span>{segName}</span>
      </div>}

      {/* Reader: only CN/FR lines, big and centered */}
      <div className="cnfr" style={{textAlign:'center', marginTop: 8}}>
        <div key={current?.key + '-fr'} className="line big">{current ? substitute(current.text, settings.participants) : (loading ? '…' : '')}</div>
        <div key={current?.key + '-zh'} className="line big muted">{current ? substitute(current.text_zh || '', settings.participants) : ''}</div>
      </div>

      {/* Countdown only when relevant */}
      {showCountdown && <div className={['big', timeLeft<=3 ? 'pulse' : ''].join(' ')} style={{textAlign:'center', marginTop:12}}>{timeLeft}s</div>}

      {/* Controls: Start, Pause/Resume (single toggle), Stop */}
      <div className="controls" style={{marginTop:16, justifyContent:'center'}}>
        <button className="btn" onClick={start} disabled={!data || phase!=='idle'}>{tt.start}</button>
        <button className="btn secondary" onClick={togglePause} disabled={phase==='idle' || phase==='done'}>
          {paused ? tt.resume : tt.pause}
        </button>
        <button className="btn danger" onClick={stop} disabled={phase==='idle' || phase==='done'}>{tt.stop}</button>
      </div>

      {/* Minimal hint for missing data */}
      {!loading && !data && <div className="muted" style={{marginTop:12, textAlign:'center'}}>{tt.emptyData}</div>}
      {error && <div className="muted" style={{marginTop:12, textAlign:'center'}}>Erreur: {error}</div>}
    </div>
  )
}

function substitute(s:string, names:{P1:string; P2:string}){
  return s?.replaceAll('{P1}', names.P1).replaceAll('{P2}', names.P2) || ''
}
function sleep(ms:number){ return new Promise(r=>setTimeout(r,ms)) }

async function countdownAccurate(totalSec:number, onTick:(left:number)=>void, isCancelled:()=>boolean, isPaused:()=>boolean){
  const base = performance.now()
  let elapsed = 0
  for(let left = totalSec; left >= 0; ){
    if(isCancelled()) return
    if(isPaused()){ await sleep(120); continue }
    onTick(left)
    if(left===0) break
    const target = base + (totalSec - (left-1))*1000
    const wait = Math.max(0, target - performance.now())
    await sleep(wait)
    elapsed += 1
    left = totalSec - elapsed
  }
}
