let ctx: AudioContext | null = null
function ac(){ return (ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)()) }

export function beepNow(freq=880, ms=120){
  const a = ac()
  const o = a.createOscillator()
  const g = a.createGain()
  o.connect(g); g.connect(a.destination)
  o.type='sine'
  o.frequency.value = freq
  const now = a.currentTime
  g.gain.setValueAtTime(0, now)
  g.gain.linearRampToValueAtTime(0.6, now+0.01)
  g.gain.exponentialRampToValueAtTime(0.001, now + ms/1000)
  o.start(now)
  o.stop(now + ms/1000 + 0.02)
}