export type VoicePick = { zh?: SpeechSynthesisVoice; fr?: SpeechSynthesisVoice; any?: SpeechSynthesisVoice }

function waitVoices(): Promise<SpeechSynthesisVoice[]> {
  return new Promise(resolve => {
    const voices = speechSynthesis.getVoices()
    if (voices.length) return resolve(voices)
    const id = setInterval(() => {
      const vs = speechSynthesis.getVoices()
      if (vs.length) { clearInterval(id); resolve(vs) }
    }, 100)
  })
}

export async function pickVoices(): Promise<VoicePick> {
  const voices = await waitVoices()
  const pickStarts = (pref:string) => voices.find(v => (v.lang || '').toLowerCase().startsWith(pref))
  return {
    zh: pickStarts('zh') || pickStarts('cmn') || pickStarts('yue'),
    fr: pickStarts('fr'),
    any: voices[0]
  }
}

export function speak(text:string, voice?: SpeechSynthesisVoice): Promise<void> {
  return new Promise(resolve => {
    if(!text) return resolve()
    const u = new SpeechSynthesisUtterance(text)
    if(voice) u.voice = voice
    u.onend = () => resolve()
    u.onerror = () => resolve()
    speechSynthesis.speak(u)
  })
}

export class SpeechQueue {
  private queue: (() => Promise<void>)[] = []
  private running = false
  public paused = false

  enqueueCNFR(zh:string|undefined, fr:string|undefined, voices:VoicePick){
    if(zh) this.queue.push(()=>speak(zh, voices.zh || voices.any))
    if(fr) this.queue.push(()=>speak(fr, voices.fr || voices.any))
    this.run()
  }

  async run(){
    if(this.running) return
    this.running = true
    while(this.queue.length){
      if(this.paused){ await new Promise(r=>setTimeout(r,100)); continue }
      const job = this.queue.shift()!
      await job()
      await new Promise(r=>setTimeout(r,80))
    }
    this.running = false
  }
  pause(){ this.paused = true; try{ speechSynthesis.pause() }catch{} }
  resume(){ this.paused = false; try{ speechSynthesis.resume() }catch{} }
  cancel(){ this.queue = []; try{ speechSynthesis.cancel() }catch{} }
  clear(){ this.queue = [] }
}