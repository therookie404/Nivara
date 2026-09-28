// main.jsx — React entry point for NIVARA.
// NIVARA is a hackathon fintech prototype: early financial-stress detection +
// recovery planning. Mounts <App/> (wrapped in the Firebase AuthProvider) into
// #root with StrictMode, and pulls in the global stylesheet. Nothing else
// lives here — all screens, state and routing-by-tab live in App.jsx.
import React from 'react';
import ReactDOM from 'react-dom/client';
import App from './App.jsx';
import './styles.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
