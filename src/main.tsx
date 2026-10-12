import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App'
import './styles.css'
import { initializeStorage } from './lib/storage'

async function start() {
  const root = document.getElementById('root')!;
  try {
    await initializeStorage();
    ReactDOM.createRoot(root).render(<React.StrictMode><App /></React.StrictMode>);
  } catch {
    root.replaceChildren();
    const message = document.createElement('p');
    message.textContent = '本地 SQLite 存储初始化失败，已有数据未删除。请重试。';
    const retry = document.createElement('button');
    retry.textContent = '重试'; retry.onclick = () => void start();
    root.append(message, retry);
  }
}
void start();
