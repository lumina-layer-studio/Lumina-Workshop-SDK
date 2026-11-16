import { connectWorkshop } from '@lumina/workshop-sdk';
import manifest from '../manifest.json';

const status = document.querySelector('#status');
const pick = document.querySelector('#pick');
const send = document.querySelector('#send');
let client, unsubscribe, result, busy = false;
function show(message) { status.textContent = message; }
function controls() { pick.disabled = !client || busy; send.disabled = !client || busy || !result; }
function theme(state) { document.body.classList.toggle('dark', state.theme === 'dark'); }
async function start() {
  client = await connectWorkshop({ moduleId: manifest.id, moduleVersion: manifest.version });
  unsubscribe = client.ui.subscribeState(theme);
  theme(await client.ui.getState());
  await client.lifecycle.ready();
  show('Choose an image to begin.'); controls();
}
pick.addEventListener('click', async () => {
  busy = true; controls(); show('Choosing image…');
  try {
    const image = await client.image.pick();
    if (image) {
      const { width, height, data } = image.raster;
      const canvas = document.createElement('canvas'); canvas.width = width; canvas.height = height;
      canvas.getContext('2d').putImageData(new ImageData(new Uint8ClampedArray(data), width, height), 0, 0);
      const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (!blob) throw new Error('Could not create PNG');
      const projectId = Array.from(crypto.getRandomValues(new Uint8Array(16)), byte => byte.toString(16).padStart(2, '0')).join('');
      result = { bytes: await blob.arrayBuffer(), width, height, projectId };
      send.textContent = 'Send to converter';
      show('Image ready to send.');
    } else show(result ? 'Selection cancelled; previous image retained.' : 'Selection cancelled.');
  } catch (error) { show(`Could not choose image: ${error.message}`); }
  finally { busy = false; controls(); }
});
send.addEventListener('click', async () => {
  busy = true; controls(); show('Sending…');
  try {
    const response = await client.handoff.image({
      moduleId: manifest.id, moduleVersion: manifest.version, projectId: result.projectId,
      pngBytes: result.bytes.slice(0), pixelWidth: result.width, pixelHeight: result.height,
      recommendedWidthMm: result.width, recommendedHeightMm: result.height,
      preserveCanvasBounds: true, colorLibraryId: null,
      recipeSource: { manifestSchemaVersion: 1, moduleId: manifest.id, moduleVersion: manifest.version,
        projectSchemaVersion: 'image-handoff/v1', renderSchemaVersion: 'image-handoff/v1', payload: {} },
    });
    if (response.status === 'needs-confirmation') { show('Converter has work open. Press Send again to confirm replacement.'); send.textContent = 'Confirm replacement'; }
    else { show('Completed.'); send.textContent = 'Send to converter'; }
  } catch (error) { show(`Could not send: ${error.message}`); }
  finally { busy = false; controls(); }
});
window.addEventListener('pagehide', () => { unsubscribe?.(); client?.close(); });
start().catch(error => show(`Connection failed: ${error.message}`));
