/* @refresh reload */
import { render } from '@solidjs/web';
import App from './ui/App';
import './styles.css';

const root = document.getElementById('root');
if (!root) throw new Error('root element missing');
render(() => <App />, root);
