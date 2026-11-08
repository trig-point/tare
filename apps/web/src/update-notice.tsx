import { useRegisterSW } from "virtual:pwa-register/react";

// An installed app can sit in the background for days without a navigation, which is when browsers check.
function checkWhenShown(
  _url: string,
  registration?: ServiceWorkerRegistration,
) {
  document.addEventListener("visibilitychange", () => {
    if (document.visibilityState === "visible") void registration?.update();
  });
}

export function UpdateNotice() {
  const {
    needRefresh: [ready],
    updateServiceWorker,
  } = useRegisterSW({ onRegisteredSW: checkWhenShown });
  if (!ready) return null;
  return (
    <output className="update-notice">
      Update ready
      <button type="button" onClick={() => void updateServiceWorker()}>
        Reload
      </button>
    </output>
  );
}
