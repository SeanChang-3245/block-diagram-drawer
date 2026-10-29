import { useEffect } from 'react';
import { useStore } from './store';
import { Canvas } from './ui/Canvas';
import { AiPromptDialog, HelpOverlay, MacroPicker, StatusBar, Toast, ToolPalette, TopBar } from './ui/Chrome';
import { PropsPanel } from './ui/PropsPanel';
import { onKeyDown } from './ui/commands';
import { openDroppedFile } from './io/files';

export const App = () => {
  const showProps = useStore((s) => s.showProps);

  useEffect(() => {
    window.addEventListener('keydown', onKeyDown);
    const beforeUnload = (e: BeforeUnloadEvent) => {
      if (useStore.getState().dirty && useStore.getState().doc.order.length) e.preventDefault();
    };
    window.addEventListener('beforeunload', beforeUnload);
    return () => {
      window.removeEventListener('keydown', onKeyDown);
      window.removeEventListener('beforeunload', beforeUnload);
    };
  }, []);

  return (
    <div
      className="app"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        const file = e.dataTransfer.files[0];
        if (file) void openDroppedFile(file);
      }}
    >
      <TopBar />
      <div className="main">
        <ToolPalette />
        <Canvas />
        {showProps && <PropsPanel />}
      </div>
      <StatusBar />
      <HelpOverlay />
      <MacroPicker />
      <AiPromptDialog />
      <Toast />
    </div>
  );
};
