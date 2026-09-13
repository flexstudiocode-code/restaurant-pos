import { useStore } from '../store';

/** The restaurant logo (Settings → Restaurant profile → Logo), or the default
 *  🍽 badge when none has been uploaded. `container` is the CSS class that
 *  sizes and styles the badge (e.g. 'login-logo' or 'brand-logo'). */
export function AppLogo({ container }: { container: string }) {
  const { state } = useStore();
  const logo = state.profile.logo;
  if (!logo) return <div className={container}>🍽</div>;
  return (
    <div className={container}>
      <img className="app-logo-img" src={logo} alt="" draggable={false} />
    </div>
  );
}
