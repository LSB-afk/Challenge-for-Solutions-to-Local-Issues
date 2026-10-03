import {loadOfficialFloodCore} from './flood-official.js';

let running = false;

self.onmessage = async event => {
  const message = event.data ?? {};
  if (message.type !== 'load') return;
  if (running) {
    self.postMessage({type: 'error', message: '공식 침수 Worker가 이미 실행 중입니다'});
    return;
  }
  running = true;
  try {
    const collection = await loadOfficialFloodCore({
      fetcher: self.fetch.bind(self),
      onProgress: progress => self.postMessage({type: 'progress', progress})
    });
    self.postMessage({type: 'result', collection});
  } catch (error) {
    self.postMessage({type: 'error', message: error?.message || String(error)});
  } finally {
    running = false;
  }
};
