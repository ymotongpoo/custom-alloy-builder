import './App.css'
import { useState } from 'react'
import { ConfigBuilder } from './ConfigBuilder'
import { BinaryBuilder } from './builder/BinaryBuilder'

function App() {
  const [activeTab, setActiveTab] = useState<'config' | 'binary'>('config')
  const [configComponents, setConfigComponents] = useState<string[]>([])

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
        <ConfigBuilder onComponentsChange={setConfigComponents} />
      ) : (
        <BinaryBuilder currentConfigComponents={configComponents} />
      )}
    </main>
  )
}

export default App
