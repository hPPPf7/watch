import { after } from "next/server";

export function runDeferredPublish(
  task: () => Promise<void>,
  onError: (error: unknown) => void,
) {
  const wrappedTask = async () => {
    try {
      await task();
    } catch (error) {
      onError(error);
    }
  };

  try {
    after(wrappedTask);
  } catch {
    void wrappedTask();
  }
}
