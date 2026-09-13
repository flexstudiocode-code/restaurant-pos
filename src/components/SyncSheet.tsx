import { useState } from 'react';
import { useStore } from '../store';
import { Modal } from './ui';
import { getDeviceName, newPairingCode, setDeviceName } from '../syncDevice';

/**
 * LAN sync controls, reachable by every role from the topbar pill (waiters
 * cannot open Settings, but they must be able to connect their phone to the
 * admin's hub). Admins additionally get the collector-hub controls.
 */
export function SyncSheet({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { user, sync, syncSetState, notify } = useStore();
  const isAdmin = user?.role === 'admin';
  const [deviceName, setDeviceNameLocal] = useState(getDeviceName());
  const [port, setPort] = useState(String(sync.hubPort || 8765));
  const [hubCode, setHubCode] = useState(sync.hubPairingCode || newPairingCode());
  const [address, setAddress] = useState(sync.clientAddress);
  const [clientCode, setClientCode] = useState(sync.clientPairingCode);

  const portNum = Number(port);
  const portValid = Number.isInteger(portNum) && portNum >= 1024 && portNum <= 65535;
  const addressValid = /^[\w.:\-[\]]+(:\d+)?$/.test(address.trim()) && address.trim().length > 0;

  const startHub = () => {
    if (!portValid) {
      notify('Port must be 1024–65535', 'err');
      return;
    }
    if (!/^\d{4}$/.test(hubCode)) {
      notify('Pairing code must be exactly 4 digits', 'err');
      return;
    }
    syncSetState({ hubRequested: true, hubPort: portNum, hubPairingCode: hubCode, hubNonce: Date.now() });
  };

  const connectClient = () => {
    if (!addressValid) {
      notify('Enter the hub address, e.g. 192.168.1.50:8765', 'err');
      return;
    }
    if (!/^\d{4}$/.test(clientCode)) {
      notify('Enter the 4-digit pairing code shown on the hub', 'err');
      return;
    }
    syncSetState({
      clientRequested: true,
      clientAddress: address.trim(),
      clientPairingCode: clientCode,
      clientNonce: Date.now(),
    });
  };

  const statusText =
    sync.clientState === 'connected'
      ? 'Connected to hub'
      : sync.clientState === 'connecting'
        ? sync.clientError || 'Connecting…'
        : sync.clientState === 'error'
          ? sync.clientError || 'Connection failed'
          : 'Not connected';

  return (
    <Modal open={open} onClose={onClose} title="Sync & multi-device">
      <div className="field">
        <label>This device's name</label>
        <input
          className="input"
          placeholder="e.g. Counter tablet, Waiter phone 2"
          value={deviceName}
          onChange={(e) => setDeviceNameLocal(e.target.value)}
          onBlur={() => {
            const v = deviceName.trim() || 'Device';
            setDeviceName(v);
            setDeviceNameLocal(v);
          }}
        />
        <div className="small muted" style={{ marginTop: 5 }}>
          Shown on the hub so you can see which device sent each bill.
        </div>
      </div>

      {isAdmin && (
        <>
          <div className="divider" />
          <div className="bold" style={{ fontSize: 14.5, marginBottom: 6 }}>🛜 As collector (admin)</div>
          <p className="small muted" style={{ margin: '0 0 10px' }}>
            Run the sync hub on this device. Waiters' phones connect to it and their bills
            appear in Reports automatically. Menu &amp; settings changes you make here reach
            every connected device. <b>The hub runs in the Android app or the
            desktop app.</b>
          </p>
          {!sync.hubRunning ? (
            <>
              <div className="row" style={{ gap: 8, marginBottom: 8 }}>
                <div className="field" style={{ width: 110 }}>
                  <label>Port</label>
                  <input className="input" inputMode="numeric" value={port} onChange={(e) => setPort(e.target.value)} />
                </div>
                <div className="field grow">
                  <label>Pairing code (4 digits)</label>
                  <div className="row" style={{ gap: 6 }}>
                    <input className="input grow" inputMode="numeric" value={hubCode} onChange={(e) => setHubCode(e.target.value)} />
                    <button className="btn btn-ghost" onClick={() => setHubCode(newPairingCode())}>🎲</button>
                  </div>
                </div>
              </div>
              <button className="btn btn-primary btn-block" onClick={startHub}>
                ▶ Start sync hub
              </button>
            </>
          ) : (
            <>
              <div className="small" style={{ marginBottom: 6 }}>
                <span className="badge" style={{ background: 'var(--ok-soft)', color: 'var(--ok)', marginRight: 6 }}>● Running</span>
                Port {sync.hubPort} · pairing code <b>{sync.hubPairingCode}</b>
              </div>
              <div className="small muted" style={{ marginBottom: 6 }}>
                On each waiter phone, open this screen and connect to:
              </div>
              <div className="row" style={{ gap: 6, flexWrap: 'wrap', marginBottom: 10 }}>
                {sync.hubAddresses.map((a) => (
                  <button
                    key={a}
                    className="chip"
                    title="Tap to copy"
                    onClick={() => {
                      void navigator.clipboard?.writeText(`${a}:${sync.hubPort}`).then(
                        () => notify(`Copied ${a}:${sync.hubPort}`, 'ok'),
                        () => notify(`${a}:${sync.hubPort}`, 'info')
                      );
                    }}
                  >
                    {a}:{sync.hubPort}
                  </button>
                ))}
              </div>
              {sync.hubClients.length > 0 ? (
                <div style={{ marginBottom: 10 }}>
                  <div className="small bold" style={{ marginBottom: 4 }}>
                    Connected devices ({sync.hubClients.length})
                  </div>
                  {sync.hubClients.map((c) => (
                    <div className="row row-between" key={c.connectionId} style={{ padding: '5px 0', borderBottom: '1px solid var(--border)' }}>
                      <span className="small">{c.name} <span className="muted">· {c.role || 'unknown'}</span></span>
                    </div>
                  ))}
                </div>
              ) : (
                <div className="small muted" style={{ marginBottom: 10 }}>
                  No devices connected yet.
                </div>
              )}
              <button className="btn btn-danger btn-block" onClick={() => syncSetState({ hubRequested: false })}>
                ■ Stop sync hub
              </button>
            </>
          )}
        </>
      )}

      <div className="divider" />
      <div className="bold" style={{ fontSize: 14.5, marginBottom: 6 }}>📱 As waiter / kitchen device</div>
      <p className="small muted" style={{ margin: '0 0 10px' }}>
        Connect this device to the collector (admin) hub to send bills to the admin and
        receive the menu &amp; settings. Works in the Android app and in the browser.
      </p>
      <div className="row" style={{ gap: 8, marginBottom: 8 }}>
        <div className="field grow">
          <label>Hub address</label>
          <input
            className="input"
            placeholder="192.168.1.50:8765"
            inputMode="url"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
        </div>
        <div className="field" style={{ width: 130 }}>
          <label>Pairing code</label>
          <input className="input" inputMode="numeric" value={clientCode} onChange={(e) => setClientCode(e.target.value)} />
        </div>
      </div>
      {sync.clientState === 'connected' ? (
        <button className="btn btn-danger btn-block" onClick={() => syncSetState({ clientRequested: false })}>
          Disconnect from hub
        </button>
      ) : (
        <button className="btn btn-primary btn-block" onClick={connectClient} disabled={sync.clientState === 'connecting'}>
          {sync.clientState === 'connecting' ? 'Connecting…' : 'Connect to hub'}
        </button>
      )}
      <div
        className={`small ${sync.clientState === 'connected' ? 'ok' : sync.clientState === 'error' ? 'err-text' : 'muted'}`}
        style={{ marginTop: 8 }}
      >
        {statusText}
      </div>
      {sync.clientState === 'connected' && (
        <div className="small muted" style={{ marginTop: 4 }}>
          New bills you take are sent to the hub automatically. Reconnects on its own if the connection drops.
        </div>
      )}
    </Modal>
  );
}