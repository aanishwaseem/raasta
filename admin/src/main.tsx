import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { TrackPage } from './TrackPage';
import './styles.css';

// /track/<token> is the public family-tracking page; everything else is the signed-in console
const track = /^\/track\/([A-Za-z0-9_-]{16,128})\/?$/.exec(location.pathname);

createRoot(document.getElementById('root')!).render(<StrictMode>{track ? <TrackPage token={track[1]} /> : <App />}</StrictMode>);
