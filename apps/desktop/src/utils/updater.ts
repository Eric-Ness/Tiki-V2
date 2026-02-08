import { check } from "@tauri-apps/plugin-updater";
import { ask, message } from "@tauri-apps/plugin-dialog";
import { relaunch } from "@tauri-apps/plugin-process";

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
      await update.downloadAndInstall();
      await relaunch();
    }
  } catch (error) {
    console.error("Update check failed:", error);
  }
}
