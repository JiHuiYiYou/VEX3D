import { useEffect, useState } from 'react'
import { useApp } from '@/state/store'

/**
 * 非法叠放被拒绝时的提示条。
 *
 * 摆放规则：Pin 只能放在 Cup 上或直接放在 Goal 上；Cup 只能放在 Pin 上。
 * 违反时 store 的 placeItem 会拒绝放置并写下 placeError，这里把它显示出来。
 */
export function PlaceHint() {
  const placeError = useApp((s) => s.placeError)
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!placeError) {
      setVisible(false)
      return
    }
    setVisible(true)
    const t = setTimeout(() => setVisible(false), 2400)
    return () => clearTimeout(t)
  }, [placeError])

  if (!placeError || !visible) return null
  return <div className="place-hint">⚠ {placeError.reason}</div>
}
