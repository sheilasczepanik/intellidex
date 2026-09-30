import { useEffect } from 'react'
import DesktopApp from './DesktopApp'

const APP_TITLE = 'INTELLIDEX | Missing Persons Intelligence & Search Workspace'

export default function App() {
  useEffect(() => {
    document.title = APP_TITLE
  }, [])
  return <DesktopApp />
}
