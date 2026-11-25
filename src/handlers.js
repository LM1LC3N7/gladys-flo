// -----------------------------------------------------------------------------
// The SDK handlers, wired to the app. Shared by index.js and the end-to-end
// tests, so the tests run the exact wiring of the container.
// -----------------------------------------------------------------------------

import { ACTIONS, SCENE_ACTIONS } from './constants.js';

export function registerHandlers(gladys, app, logger) {
  // Discovery: the devices of the account.
  gladys.onScanRequest(() => app.scan());
  gladys.onDeviceCreated((device) => app.deviceCreated(device));
  gladys.onDeviceUpdated((device) => app.deviceCreated(device));
  gladys.onDeviceDeleted((device) => app.deviceDeleted(device));

  // The water buttons, the valve switch (older scenes) and the Away switch of a shutoff.
  gladys.onSetValue((device, feature, value) => app.setValueOf(device, feature, value));

  // Scene actions.
  gladys.onSceneAction(SCENE_ACTIONS.SET_MODE, (fields) => app.sceneSetMode(fields));
  gladys.onSceneAction(SCENE_ACTIONS.SET_VALVE, (fields) => app.sceneSetValve(fields));

  // Configuration screen button.
  gladys.onAction(ACTIONS.TEST_CONNECTION, () => app.testConnection());

  // Configuration changed by the user.
  gladys.onConfigUpdated((config) => app.configUpdated(config));

  // Connection lifecycle: the first connection starts, a reconnection resends.
  // The SDK (0.16.1) reads the configuration right before 'connected'.
  gladys.on('connected', async () => {
    try {
      await app.connectedWith(
        () => gladys.config,
        () => gladys.getConfig(),
      );
    } catch (err) {
      logger?.error('Start failed', err);
    }
  });
}
