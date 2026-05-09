import { check } from "@tauri-apps/plugin-updater";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";
import { useToastStore } from "../stores";

export async function checkForAppUpdates(showNoUpdateMessage: boolean) {
  try {
    const update = await check();

    if (!update) {
      if (showNoUpdateMessage) {
        await message("You are on the latest version.", {
          title: "No Update Available",
          kind: "info",
        });
      }
      return;
    }

    useToastStore.getState().addToast(`Update available: v${update.version}`, 'info', 6000);

    const shouldUpdate = await ask(
      `Version ${update.version} is available!\n\n${update.body ?? ""}`,
      {
        title: "Update Available",
        kind: "info",
        okLabel: "Update",
        cancelLabel: "Later",
      }
    );

    if (shouldUpdate) {
      const toasts = useToastStore.getState();
      const progressToastId = toasts.addToast(
        `Downloading update v${update.version}...`,
        'info',
        60000
      );

      let totalBytes = 0;
      let receivedBytes = 0;

      await update.downloadAndInstall((event) => {
        if (event.event === 'Started') {
          totalBytes = event.data.contentLength ?? 0;
        } else if (event.event === 'Progress') {
          receivedBytes += event.data.chunkLength;
          if (totalBytes > 0) {
            const percent = Math.floor((receivedBytes / totalBytes) * 100);
            useToastStore
              .getState()
              .updateToast(progressToastId, `Downloading update v${update.version}... ${percent}%`);
          }
        } else if (event.event === 'Finished') {
          useToastStore
            .getState()
            .updateToast(progressToastId, `Installing update v${update.version}...`);
        }
      });

      await relaunch();
    }
  } catch (error) {
    console.error("Update check failed:", error);
    useToastStore.getState().addToast(`Update failed: ${error}`, 'error', 8000);
  }
}
