import settingsURL from "tinybuild:asset/settings";
onmessage = async ({ data }) => {
  const settings = await (await fetch(settingsURL)).json();
  postMessage(
    String(data * settings.multiplier) + ": nested worker + embedded settings",
  );
};
