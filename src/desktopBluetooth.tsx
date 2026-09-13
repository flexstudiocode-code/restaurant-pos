// Web Bluetooth device chooser for the desktop app.
//
// In the browser, `navigator.bluetooth.requestDevice()` shows the browser's
// own chooser. In Electron there is no native chooser — the main process
// intercepts `select-bluetooth-device`, sends the matching device list here,
// and this module shows the app's own picker modal. The chosen device id goes
// back over the bridge and the main process completes the request.

import { createRoot } from 'react-dom/client';
import { getDesktop, type DesktopBluetoothDevice } from './desktop';

let attached = false;

/** Wire the desktop Bluetooth chooser once at startup. No-op outside Electron. */
export function initDesktopBluetooth(): void {
  const desktop = getDesktop();
  if (!desktop || attached) return;
  attached = true;
  desktop.bluetooth.onDevices((devices) => {
    void pickDevice(devices).then((id) => desktop.bluetooth.choose(id ?? ''));
  });
}

function pickDevice(devices: DesktopBluetoothDevice[]): Promise<string | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = (v: string | null) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<PickerModal devices={devices} onPick={(d) => close(d)} onCancel={() => close(null)} />);
  });
}

function PickerModal({
  devices,
  onPick,
  onCancel,
}: {
  devices: DesktopBluetoothDevice[];
  onPick: (deviceId: string) => void;
  onCancel: () => void;
}) {
  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        if (e.target === e.currentTarget) onCancel();
      }}
    >
      <div className="modal" style={{ width: 'min(92vw, 380px)' }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 16.5 }}>🖨 Bluetooth printer</h2>
        {devices.length === 0 ? (
          <p className="small muted">
            No nearby printers found. Make sure the printer is <b>powered on</b>, close to this
            computer, and <b>not connected to your phone</b> (a printer can only talk to one device
            at a time). Then tap Connect printer again to rescan.
          </p>
        ) : (
          <div style={{ display: 'grid', gap: 8, maxHeight: 280, overflowY: 'auto', margin: '4px 0 12px' }}>
            {devices.map((d) => (
              <button
                key={d.id}
                className="btn btn-ghost"
                style={{ justifyContent: 'flex-start' }}
                onClick={() => onPick(d.id)}
              >
                🖨 {d.name || d.id}
              </button>
            ))}
          </div>
        )}
        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-primary grow" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
