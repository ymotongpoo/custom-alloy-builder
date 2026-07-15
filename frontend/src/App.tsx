import { ReactFlow } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import './App.css'
import { useState } from 'react'

function App() {
  const [activeTab, setActiveTab] = useState<'config' | 'binary'>('config')

  return (
    <main className="app-shell">
      <header className="app-header">
        <h1>Custom Alloy Builder</h1>
        <nav className="tabs" aria-label="Builder views">
          <button
            type="button"
            aria-selected={activeTab === 'config'}
            onClick={() => setActiveTab('config')}
          >
            Config Builder
          </button>
          <button
            type="button"
            aria-selected={activeTab === 'binary'}
            onClick={() => setActiveTab('binary')}
          >
            Binary Builder
          </button>
        </nav>
      </header>

      {activeTab === 'config' ? (
        <section className="placeholder-panel" aria-label="Config Builder">
          <div className="canvas-placeholder">
            <ReactFlow nodes={[]} edges={[]} fitView />
          </div>
        </section>
      ) : (
        <section className="placeholder-panel" aria-label="Binary Builder">
          <div>Binary Builder placeholder</div>
        </section>
      )}
    </main>
  )
}

export default App
