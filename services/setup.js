const UsersService = require('./users');
const SettingsService = require('./settings');
const MigrationService = require('./migration');
const SettingsModel = require('../models/setting');
const {
  ErrMissingEmail,
  ErrInstallLock,
  ErrSettingsInit,
  ErrSettingsNotInit,
} = require('../errors');
const { INSTALL_LOCK } = require('../config');

/**
 * This service is used when we want to setup the application. It is consumed by
 * the dynamic setup endpoint and by the cli-setup tool.
 */
module.exports = class SetupService {
  /**
   * This returns a promise which resolves if the setup is available.
   */
  static async isAvailable() {
    // Check if we have an install lock present.
    if (INSTALL_LOCK) {
      throw new ErrInstallLock();
    }

    try {
      // Get the current settings, we are expecting an error here.
      await SettingsService.select('id');

      // We should NOT have gotten a settings object, this means that the
      // application is already setup. Error out here.
      throw new ErrSettingsInit();
    } catch (err) {
      // Allow the request to keep going here.
      if (err instanceof ErrSettingsNotInit) {
        return;
      }

      // If the error is `not init`, then we're good, otherwise, it's something
      // else.
      throw err;
    }
  }

  /**
   * This verifies that the current input for the setup is valid.
   */
  static validate({ settings, user: { email, username, password } }) {
    // Verify the email address of the user.
    if (!email) {
      throw new ErrMissingEmail();
    }

    // Create a settings model to use for validation.
    let settingsModel = new SettingsModel(settings);

    // Verify other properties of the user.
    return Promise.all([
      UsersService.isValidUsername(username, false),
      UsersService.isValidPassword(password),
      settingsModel.validate(),
    ]);
  }

  /**
   * This will perform the setup.
   */
  static async setup(ctx, { settings, user: { email, password, username } }) {
    // Validate the settings first.
    await SetupService.validate({
      settings,
      user: { email, password, username },
    });

    // Get the migrations to run.
    let migrations = await MigrationService.listPending();

    // Perform all migrations.
    await MigrationService.run(migrations);

    settings = await SettingsService.update(settings);

    // Settings are created! Create the user.

    // Create the user.
    let user = await UsersService.createLocalUser(
      ctx,
      email,
      password,
      username
    );

    // Grant them administrative privileges and confirm the email account.
    await Promise.all([
      UsersService.setRole(user.id, 'ADMIN'),
      UsersService.confirmEmail(user.id, email),
    ]);

    return {
      settings,
      user,
    };
  }
};
