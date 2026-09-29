import { useEffect } from 'react'
import DesktopApp from './DesktopApp'

const APP_TITLE = 'INTELLIDEX | Investigative Evidence & Timeline Workbench'

export default function App() {
  useEffect(() => {
    document.title = APP_TITLE
  }, [])
  return <DesktopApp />
}
