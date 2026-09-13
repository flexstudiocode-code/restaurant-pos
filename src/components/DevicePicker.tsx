import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { getThermalDevicesInfo, type ThermalDeviceInfo } from '../nativeThermal';

export interface DeviceChoice {
  address: string;
  name: string;
}

/** Show the paired-printer picker; resolves with the choice or null on cancel. */
export function showDevicePicker(): Promise<DeviceChoice | null> {
  return new Promise((resolve) => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const root = createRoot(host);
    const close = (v: DeviceChoice | null) => {
      root.unmount();
      host.remove();
      resolve(v);
    };
    root.render(<DevicePickerModal onPick={(d) => close(d)} onCancel={() => close(null)} />);
  });
}

function DevicePickerModal({ onPick, onCancel }: { onPick: (d: DeviceChoice) => void; onCancel: () => void }) {
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<{ devices: ThermalDeviceInfo[]; enabled: boolean } | null>(null);

  const load = () => {
    setLoading(true);
    setError(null);
    getThermalDevicesInfo()
      .then((res) => setInfo({ devices: res.devices, enabled: res.enabled }))
      .catch(() => setError('Could not read Bluetooth. Make sure the permission is allowed.'))
      .finally(() => setLoading(false));
  };

  useEffect(load, []);

  return (
    <div className="modal-overlay" onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}>
      <div className="modal" style={{ width: 'min(92vw, 380px)' }}>
        <h2 style={{ margin: '0 0 12px', fontSize: 16.5 }}>🖨 Bluetooth printer</h2>

        {error && <p className="small" style={{ color: 'var(--danger)' }}>{error}</p>}

        {!error && loading && <p className="small muted">Looking for paired printers…</p>}

        {!error && !loading && info && !info.enabled && (
          <p className="small muted">
            Bluetooth is off — turn it on in Quick Settings, then tap Refresh.
          </p>
        )}

        {!error && !loading && info && info.enabled && info.devices.length === 0 && (
          <p className="small muted">
            No paired printers found. Pair your thermal printer in Android Settings → Bluetooth first, then tap
            Refresh.
          </p>
        )}

        {!error && !loading && info && info.enabled && info.devices.length > 0 && (
          <div style={{ display: 'grid', gap: 8, maxHeight: 280, overflowY: 'auto', margin: '4px 0 12px' }}>
            {info.devices.map((d) => (
              <button key={d.address} className="btn btn-ghost" style={{ justifyContent: 'flex-start' }} onClick={() => onPick({ address: d.address, name: d.name })}>
                🖨 {d.name}
              </button>
            ))}
          </div>
        )}

        <div className="row" style={{ gap: 8 }}>
          <button className="btn btn-ghost grow" onClick={load} disabled={loading}>
            Refresh
          </button>
          <button className="btn btn-primary grow" onClick={onCancel}>
            Cancel
          </button>
        </div>
      </div>
    </div>
  );
}
