import { useState } from 'react';
import { useStore } from '../store';
import { isDesktop } from '../desktop';
import { usePinKeypad } from '../usePinKeypad';
import { AppLogo } from '../components/AppLogo';

export function LoginScreen() {
  const { login, state } = useStore();
  const [pin, setPin] = useState('');

  const press = (d: string) => {
    if (pin.length >= 4) return;
    setPin((p) => p + d);
  };

  const clear = () => setPin('');
  const backspace = () => setPin((p) => p.slice(0, -1));

  const submit = () => {
    if (pin.length < 4) return;
    const role = login(pin);
    if (!role) {
      setPin('');
      // brief shake feedback: handled by clearing pin
    }
  };

  usePinKeypad({ onDigit: press, onBackspace: backspace, onClear: clear, onSubmit: submit });

  return (
    <div className="login-wrap">
      <div className="login-card">
        <AppLogo container="login-logo" />
        <h1 style={{ margin: 0, fontSize: 21 }}>{state.profile.name}</h1>
        <p className="muted" style={{ margin: '6px 0 0', fontSize: 13 }}>
          Enter staff PIN to sign in
        </p>

        <div className="pin-head">
          <div className="pin-dots">
            {[0, 1, 2, 3].map((i) => (
              <span key={i} className={pin.length > i ? 'filled' : ''} />
            ))}
          </div>
          <button
            className="pin-backspace"
            onClick={backspace}
            disabled={pin.length === 0}
            aria-label="Delete last digit"
            title="Delete last digit"
          >
            ⌫
          </button>
        </div>

        <div className="pin-pad">
          {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((d) => (
            <button key={d} onClick={() => press(d)}>
              {d}
            </button>
          ))}
          <button className="fn" onClick={clear}>
            Clear
          </button>
          <button onClick={() => press('0')}>0</button>
          <button className="enter" onClick={submit}>
            OK
          </button>
        </div>

        <div className="pin-hint">
          {state.auth.users.slice(0, 4).map((u, i) => (
            <span key={u.id}>
              {i > 0 && ' · '}
              {u.name} <b>{u.pin}</b>
            </span>
          ))}
          {state.auth.users.length > 4 && ` · +${state.auth.users.length - 4} more`}
        </div>
        {isDesktop() && (
          <div className="pin-hint" style={{ marginTop: 6 }}>
            Keyboard: digits · ⌫ delete · ⏎ enter · Esc clear
          </div>
        )}
      </div>
    </div>
  );
}
