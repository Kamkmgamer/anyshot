import '../common/ui.css';
import './update.css';
import { render } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import logo from '../../../resources/icon-256.png';
import type { UpdateOffer, UpdateStatus } from '../../shared/update';
import { followTheme } from '../common/theme';

const api = window.anyshot;

function Progress({ status }: { status: UpdateStatus }) {
  if (status.state === 'downloading') {
    const percent = Math.round(status.percent);
    return (
      <div class="progress" data-testid="update-progress">
        <progress max={100} value={percent} aria-label="Download progress" />
        <span>Downloading… {percent} %</span>
      </div>
    );
  }
  if (status.state === 'installing')
    return (
      <p class="progress" data-testid="update-progress">
        Installing; anyshot restarts in a moment…
      </p>
    );
  if (status.state === 'error')
    return (
      <p class="error" role="alert" data-testid="update-error">
        The update failed: {status.message}
      </p>
    );
  return null;
}

function App() {
  const [offer, setOffer] = useState<UpdateOffer | null>(null);
  const [status, setStatus] = useState<UpdateStatus>({ state: 'idle' });
  useEffect(() => {
    void api.invoke('update:init').then((init) => {
      setOffer(init.offer);
      setStatus(init.status);
    });
    return api.on('update:status', setStatus);
  }, []);
  if (!offer) return null;
  const busy = status.state === 'downloading' || status.state === 'installing';
  const openRelease = () => void api.invoke('shell:open-url', offer.releaseUrl);
  return (
    <main class="update" data-testid="update">
      <header>
        <img src={logo} alt="" width={48} height={48} />
        <div>
          <h1 data-testid="update-title">anyshot {offer.version} is available</h1>
          <p class="muted">You have {offer.current}.</p>
        </div>
      </header>
      {offer.notes.length > 0 ? (
        <ul class="notes" data-testid="update-notes">
          {offer.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : (
        <p class="muted">See the release notes for what changed.</p>
      )}
      <button type="button" class="link" onClick={openRelease}>
        Release notes
      </button>
      {!offer.canInstall && (
        <p class="muted" data-testid="update-manual">
          This copy was installed as a package: download the new .deb from the release page.
        </p>
      )}
      <Progress status={status} />
      <footer>
        <button
          type="button"
          data-testid="update-later"
          disabled={busy}
          onClick={() => void api.invoke('window:close')}
        >
          Later
        </button>
        {offer.canInstall ? (
          <button
            type="button"
            class="primary"
            data-testid="update-install"
            disabled={busy}
            onClick={() => void api.invoke('update:install')}
          >
            {status.state === 'error' ? 'Try again' : 'Update'}
          </button>
        ) : (
          <button
            type="button"
            class="primary"
            data-testid="update-download"
            onClick={() => {
              openRelease();
              void api.invoke('window:close');
            }}
          >
            Download
          </button>
        )}
      </footer>
    </main>
  );
}

render(<App />, document.getElementById('root') as HTMLElement);
followTheme();
