
import React, { useEffect, useState } from 'react'

export default function InstallPWA(){
  const [deferred, setDeferred] = useState<any>(null)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    const onPrompt = (e: any) => {
      e.preventDefault()
      setDeferred(e)
      setVisible(true)
    }
    window.addEventListener('beforeinstallprompt', onPrompt as any)
    return () => window.removeEventListener('beforeinstallprompt', onPrompt as any)
  }, [])

  if(!visible) return null

  async function install(){
    const ev = deferred
    if(!ev) return
    ev.prompt()
    const { outcome } = await ev.userChoice
    setVisible(false)
    setDeferred(null)
  }

  return (
    <button className="btn" onClick={install} style={{marginLeft:8}}>Installer</button>
  )
}
