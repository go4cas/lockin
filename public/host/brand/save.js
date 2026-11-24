// @ts-check
// Saving a draft without losing what was typed while the save was on its way (code review LI-007).
// Pure: no DOM and no Arrow, so it can be tested on its own.

/**
 * Sends the draft as it is now. When the reply comes, the saved baseline always becomes the
 * server's copy; the editable draft takes the server's copy only if nothing changed since the
 * draft was sent. Edits made while saving stay in the draft, which then reads as not saved.
 * @template T
 * @param {{
 *   snapshot: () => string,              // the draft as JSON, as it would be sent
 *   send: (body: any) => Promise<T>,     // the PUT; rejects on an error
 *   setSaved: (saved: T) => void,        // the new baseline
 *   apply: (saved: T) => void,           // replaces the draft with the server's copy
 * }} o
 * @returns {Promise<{ saved: T, keptEdits: boolean }>}
 */
export async function saveDraft(o) {
  const sent = o.snapshot();
  const saved = await o.send(JSON.parse(sent));
  o.setSaved(saved);
  const keptEdits = o.snapshot() !== sent;
  if (!keptEdits) o.apply(saved);
  return { saved, keptEdits };
}
