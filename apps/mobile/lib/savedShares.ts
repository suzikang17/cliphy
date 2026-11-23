import AsyncStorage from "@react-native-async-storage/async-storage";
import { addClip } from "./api";
import { showQueueError } from "./queueError";
import { uploadPreparedImage } from "./uploadImage";
import { createOutbox } from "./shareOutbox";

const KEY = "cliphy.shareOutbox.v1";

/** The app's one outbox of shared links and pictures: stored on the phone, sent to the Library. */
export const shareOutbox = createOutbox({
  load: () => AsyncStorage.getItem(KEY),
  save: (value) => AsyncStorage.setItem(KEY, value),
  send: async (item) => {
    if (item.kind === "image") await uploadPreparedImage(item.url);
    else await addClip({ url: item.url });
  },
  refused: (err) => showQueueError(err),
  now: () => new Date(),
});
