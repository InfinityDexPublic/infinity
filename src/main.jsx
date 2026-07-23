import './polyfills.js'

import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App.jsx'
import ChainProvider from './chain/WalletProvider.jsx'
import './styles.css'

createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <ChainProvider>
      <App />
    </ChainProvider>
  </React.StrictMode>
)
