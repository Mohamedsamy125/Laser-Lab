// Legacy classic-worker entry; processing lives in the shared laser system.
self.__laserWorkerBase = new URL('./laser/', self.location.href).href;
importScripts(new URL('./laser/frame-worker.js', self.location.href).href);
