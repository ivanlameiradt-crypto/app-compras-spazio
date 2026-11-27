import { createRoot } from 'react-dom/client'
import '../src/styles.css'
import NotaSefaz from '../src/admin/NotaSefaz'
createRoot(document.getElementById('root')!).render(<div className="cupom" style={{ maxWidth: 480, margin: '0 auto', padding: 12 }}><NotaSefaz /></div>)
