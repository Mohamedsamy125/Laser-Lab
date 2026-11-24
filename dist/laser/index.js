// Public entry for the shared input system. Games receive shoot({ x, y })
// from the player; they never open a camera or run their own laser detector.
export { LaserCamera } from './camera.js';
export { LaserSpotDetector } from './laser-spot.js';
export { FrameDetector, homography, projectPoint, orderCorners } from './tracking.js';
export { DebugCameraSource, isGreenCameraFrame } from './debug-source.js';
export { VisionChannel } from './vision-channel.js';
