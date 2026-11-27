import Toolbar from './Toolbar';
import Viewport from './Viewport';
import Timeline from './Timeline';

export default function App() {
  return (
    <div class="app">
      <Toolbar />
      <div class="main">
        <Viewport />
      </div>
      <Timeline />
    </div>
  );
}
