import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createClients } from '@/api';
import { AppRoot } from './AppRoot';
import './styles/hub.css';
import './styles/app.css';

const clients = createClients();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRoot clients={clients} />
  </StrictMode>,
);
